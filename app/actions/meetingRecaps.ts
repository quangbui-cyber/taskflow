"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getMembership, requireUser } from "@/lib/auth";
import { emailAppUrl } from "@/lib/email";
import { MEETING_RECAPS_DISABLED_MESSAGE, meetingRecapsEnabled } from "@/lib/features";
import {
  RECAP_ACTION_ITEMS_MAX,
  RECAP_ACTION_TITLE_MAX,
  canManageMeetingRecap,
  canReadMeetingRecap,
  isRecapStale,
  normalizeRecapContent,
} from "@/lib/meetingRecap";
import { formatMeetingWhen, vnDateTimeToUtc } from "@/lib/meetings";
import { sendGoogleChat } from "@/lib/googleChat";
import { findRecapMeeting, loadRecapUsage } from "@/lib/meetingRecapData";
import { recapLimits, summaryLimitReason } from "@/lib/meetingRecapLimits";
import { deleteRecapAudio, runMeetingRecap, saveRecapToProject } from "@/lib/meetingRecapJob";
import { sendMeetingRecapEmail } from "@/lib/meetingRecapMail";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

export type MeetingRecapActionState = { error?: string; success?: string };

async function loadManaged(meetingId: string) {
  const user = await requireUser();
  const meeting = await findRecapMeeting(meetingId);
  if (!meeting || !canManageMeetingRecap(meeting, user)) {
    return { error: "Chỉ người ghi biên bản, người tổ chức hoặc quản trị viên mới làm được việc này." } as const;
  }
  return { user, meeting } as const;
}

function refresh(meetingId: string) {
  revalidatePath(`/meetings/${meetingId}/recap`);
  revalidatePath("/meetings");
}

/** Viết lại biên bản từ bản chép lời đã có (không chép lời lại). */
export async function regenerateMeetingRecap(meetingId: string): Promise<MeetingRecapActionState> {
  if (!meetingRecapsEnabled()) return { error: MEETING_RECAPS_DISABLED_MESSAGE };
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const recap = loaded.meeting.recap;
  if (!recap?.transcript) return { error: "Chưa có bản chép lời. Hãy tải file ghi âm lên." };
  if (recap.status === "PROCESSING" && !isRecapStale(recap)) {
    return { error: "Biên bản đang được xử lý. Đợi xong rồi thử lại." };
  }
  const limited = summaryLimitReason(recapLimits(), await loadRecapUsage(meetingId), { perMeeting: true });
  if (limited) return { error: limited };

  const startedAt = new Date();
  await prisma.meetingRecap.update({
    where: { id: recap.id },
    data: {
      status: "PROCESSING",
      stage: "SUMMARIZING",
      error: null,
      processingStartedAt: startedAt,
      createdById: loaded.user.id,
    },
  });
  after(() => runMeetingRecap(recap.id, startedAt));
  refresh(meetingId);
  return { success: "Đang viết lại biên bản…" };
}

export async function saveMeetingRecapContent(
  meetingId: string,
  content: string
): Promise<MeetingRecapActionState> {
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const recap = loaded.meeting.recap;
  if (!recap || recap.status !== "READY") return { error: "Biên bản chưa sẵn sàng để sửa." };
  const value = normalizeRecapContent(content);
  if (!value) return { error: "Biên bản không được để trống." };

  await prisma.meetingRecap.update({ where: { id: recap.id }, data: { content: value } });
  refresh(meetingId);
  return { success: "Đã lưu biên bản." };
}

/** Gửi biên bản: người tham dự xem được trong app, nhận thông báo và email. */
export async function sendMeetingRecap(meetingId: string): Promise<MeetingRecapActionState> {
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const { meeting, user } = loaded;
  const recap = meeting.recap;
  if (!recap || recap.status !== "READY" || !recap.content?.trim()) {
    return { error: "Biên bản chưa sẵn sàng để gửi." };
  }

  const sentAt = new Date();
  await prisma.meetingRecap.update({ where: { id: recap.id }, data: { sentAt } });
  const savedToProject = await saveRecapToProject(meetingId, user, sentAt);
  const recipients = await prisma.meetingAttendee.findMany({
    where: { meetingId, response: { not: "DECLINED" }, user: { isActive: true } },
    select: { userId: true },
  });
  const recipientIds = [meeting.organizerId, ...recipients.map((row) => row.userId)].filter(
    (id) => id !== user.id
  );
  await notify(recipientIds, {
    type: "MEETING_RECAP_SHARED",
    message: `Đã có biên bản họp “${meeting.title}”.`,
    meetingId,
  });
  after(async () => {
    const result = await sendMeetingRecapEmail(meetingId);
    if (!result.ok && result.error !== "Chưa cấu hình email.") {
      console.warn("Meeting recap email could not be sent.");
    }
  });
  refresh(meetingId);
  if (savedToProject) revalidatePath("/projects/[id]", "page");
  const projectNote = savedToProject ? " Đã lưu vào tài liệu dự án." : "";
  return {
    success:
      (recipientIds.length
        ? `Đã gửi biên bản cho ${recipientIds.length} người.`
        : "Đã lưu biên bản. Cuộc họp không có người tham dự nào khác.") + projectNote,
  };
}

export async function deleteMeetingRecap(meetingId: string): Promise<MeetingRecapActionState> {
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const recap = loaded.meeting.recap;
  if (!recap) return { success: "Đã xoá biên bản." };

  await deleteRecapAudio(recap.audioPathname);
  await prisma.meetingRecap.delete({ where: { id: recap.id } });
  refresh(meetingId);
  return { success: "Đã xoá biên bản." };
}

// ---------- Việc cần làm trong biên bản ----------

function loadActionItem(itemId: string) {
  return prisma.meetingRecapActionItem.findUnique({
    where: { id: String(itemId) },
    select: {
      id: true,
      title: true,
      ownerId: true,
      dueDate: true,
      taskId: true,
      recap: {
        select: {
          id: true,
          status: true,
          sentAt: true,
          meeting: {
            select: {
              id: true,
              title: true,
              startAt: true,
              endAt: true,
              organizerId: true,
              recorderId: true,
              attendees: { select: { userId: true } },
            },
          },
        },
      },
    },
  });
}

/** Tick / bỏ tick "đã xong": người tổ chức, admin, hoặc chính người phụ trách (khi đã đọc được biên bản). */
export async function toggleRecapActionItem(itemId: string, done: boolean): Promise<MeetingRecapActionState> {
  const user = await requireUser();
  const item = await loadActionItem(itemId);
  if (!item) return { error: "Không tìm thấy việc này. Có thể biên bản vừa được viết lại." };
  const { meeting } = item.recap;
  const allowed =
    canManageMeetingRecap(meeting, user) ||
    (item.ownerId === user.id && canReadMeetingRecap(meeting, item.recap, user));
  if (!allowed) return { error: "Chỉ người phụ trách hoặc người tổ chức mới đánh dấu được việc này." };
  if (item.taskId) return { error: "Việc này đã thành task — cập nhật trạng thái ngay trong task." };

  await prisma.meetingRecapActionItem.update({
    where: { id: item.id },
    data: { doneAt: done ? new Date() : null },
  });
  refresh(meeting.id);
  return {};
}

export type RecapActionItemInput = { id?: string; title: string; ownerId: string; dueDate: string };

/** Thêm hoặc sửa một việc cần làm (người tổ chức / admin). */
export async function saveRecapActionItem(
  meetingId: string,
  input: RecapActionItemInput
): Promise<MeetingRecapActionState> {
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const recap = loaded.meeting.recap;
  if (!recap || recap.status !== "READY") return { error: "Biên bản chưa sẵn sàng để sửa." };

  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { error: "Hãy nhập việc cần làm." };
  if (title.length > RECAP_ACTION_TITLE_MAX) return { error: `Việc cần làm dài tối đa ${RECAP_ACTION_TITLE_MAX} ký tự.` };

  const ownerId = String(input.ownerId ?? "").trim() || null;
  const people = new Set([loaded.meeting.organizerId, ...loaded.meeting.attendees.map((row) => row.userId)]);
  if (ownerId && !people.has(ownerId)) return { error: "Người phụ trách phải là người tổ chức hoặc người được mời." };

  const dueRaw = String(input.dueDate ?? "").trim();
  const dueDate = dueRaw ? vnDateTimeToUtc(dueRaw, "17:00") : null;
  if (dueRaw && !dueDate) return { error: "Hạn chót không hợp lệ." };

  const data = {
    title,
    ownerId,
    dueDate,
    // Đã chọn người / ngày cụ thể thì bỏ phần AI "nghe được".
    ...(ownerId ? { ownerName: null } : {}),
    ...(dueDate ? { dueText: null } : {}),
  };

  if (input.id) {
    const item = await prisma.meetingRecapActionItem.findFirst({
      where: { id: String(input.id), recapId: recap.id },
      select: { id: true, taskId: true },
    });
    if (!item) return { error: "Không tìm thấy việc này. Có thể biên bản vừa được viết lại." };
    if (item.taskId) return { error: "Việc này đã thành task — sửa ngay trong task." };
    await prisma.meetingRecapActionItem.update({ where: { id: item.id }, data });
  } else {
    const [count, last] = await Promise.all([
      prisma.meetingRecapActionItem.count({ where: { recapId: recap.id } }),
      prisma.meetingRecapActionItem.findFirst({
        where: { recapId: recap.id },
        orderBy: { order: "desc" },
        select: { order: true },
      }),
    ]);
    if (count >= RECAP_ACTION_ITEMS_MAX) return { error: `Mỗi biên bản có tối đa ${RECAP_ACTION_ITEMS_MAX} việc.` };
    await prisma.meetingRecapActionItem.create({
      data: { ...data, recapId: recap.id, order: (last?.order ?? -1) + 1 },
    });
  }
  refresh(meetingId);
  return { success: input.id ? "Đã lưu việc cần làm." : "Đã thêm việc cần làm." };
}

export async function deleteRecapActionItem(itemId: string): Promise<MeetingRecapActionState> {
  const user = await requireUser();
  const item = await loadActionItem(itemId);
  if (!item) return { success: "Đã xoá việc cần làm." };
  if (!canManageMeetingRecap(item.recap.meeting, user)) {
    return { error: "Chỉ người ghi biên bản, người tổ chức hoặc quản trị viên mới làm được việc này." };
  }
  await prisma.meetingRecapActionItem.delete({ where: { id: item.id } });
  refresh(item.recap.meeting.id);
  return { success: item.taskId ? "Đã xoá khỏi biên bản. Task đã tạo vẫn giữ nguyên." : "Đã xoá việc cần làm." };
}

/**
 * Biến một việc cần làm thành task trong dự án: giao cho người phụ trách (nếu thuộc dự án),
 * mang theo hạn chót, rồi gắn task vào việc đó để trạng thái hai bên khớp nhau.
 */
export async function createTaskFromRecapActionItem(
  itemId: string,
  projectId: string
): Promise<MeetingRecapActionState> {
  const user = await requireUser();
  const item = await loadActionItem(itemId);
  if (!item) return { error: "Không tìm thấy việc này. Có thể biên bản vừa được viết lại." };
  const { meeting } = item.recap;
  if (!canManageMeetingRecap(meeting, user)) {
    return { error: "Chỉ người tổ chức hoặc quản trị viên mới tạo task được." };
  }
  if (item.recap.status !== "READY") return { error: "Biên bản chưa sẵn sàng." };
  if (item.taskId) return { error: "Việc này đã có task rồi." };

  const project = await prisma.project.findUnique({
    where: { id: String(projectId ?? "") },
    select: { id: true, name: true, googleChatWebhookUrl: true },
  });
  if (!project) return { error: "Hãy chọn dự án để tạo task." };
  if (user.role !== "ADMIN" && !(await getMembership(project.id, user.id))) {
    return { error: "Bạn không thuộc dự án này nên không tạo task ở đây được." };
  }
  const assigneeId =
    item.ownerId && (await getMembership(project.id, item.ownerId)) ? item.ownerId : null;

  const last = await prisma.task.findFirst({
    where: { projectId: project.id, status: "TODO" },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  let task: { id: string; assignee: { name: string } | null };
  try {
    task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: item.title,
          description: `Việc giao trong cuộc họp “${meeting.title}” (${formatMeetingWhen(meeting.startAt, meeting.endAt)}).`,
          projectId: project.id,
          status: "TODO",
          priority: "MEDIUM",
          dueDate: item.dueDate,
          assigneeId,
          creatorId: user.id,
          order: (last?.order ?? 0) + 1,
        },
        select: { id: true, assignee: { select: { name: true } } },
      });
      // Chỉ gắn khi việc vẫn chưa có task (hai người bấm cùng lúc thì một người bị huỷ).
      const linked = await tx.meetingRecapActionItem.updateMany({
        where: { id: item.id, taskId: null },
        data: { taskId: created.id },
      });
      if (linked.count === 0) throw new Error("ALREADY_LINKED");
      return created;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_LINKED") return { error: "Việc này đã có task rồi." };
    throw error;
  }

  if (assigneeId && assigneeId !== user.id) {
    await notify([assigneeId], {
      type: "TASK_ASSIGNED",
      message: `${user.name} đã giao cho bạn task “${item.title}” (từ biên bản họp “${meeting.title}”)`,
      taskId: task.id,
      projectId: project.id,
    });
  }
  if (project.googleChatWebhookUrl) {
    const base = emailAppUrl();
    await sendGoogleChat(
      project.googleChatWebhookUrl,
      [
        `*${project.name}*`,
        `Công việc mới từ biên bản họp “${meeting.title}”: *${item.title}*`,
        `Người được giao: ${task.assignee?.name ?? "Chưa giao"}`,
        `Người tạo: ${user.name}`,
        ...(base ? [`<${base}/projects/${project.id}?task=${task.id}|Mở job>`] : []),
      ].join("\n")
    );
  }

  refresh(meeting.id);
  revalidatePath(`/projects/${project.id}`);
  revalidatePath("/");
  return {
    success:
      item.ownerId && !assigneeId
        ? `Đã tạo task trong “${project.name}”. Người phụ trách không thuộc dự án nên task chưa giao cho ai.`
        : `Đã tạo task trong “${project.name}”.`,
  };
}
