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
import { taskGoogleChatMessage } from "@/lib/taskGoogleChat";
import { findRecapMeeting, loadRecapUsage } from "@/lib/meetingRecapData";
import { recapLimits, summaryLimitReason } from "@/lib/meetingRecapLimits";
import { deleteRecapAudio, runMeetingRecap, saveRecapToProject } from "@/lib/meetingRecapJob";
import { sendMeetingRecapEmail } from "@/lib/meetingRecapMail";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { createLinkedRecapTask, lockRecap, publishRecap, resolveRecapSuggestion } from "@/lib/recapWorkflow";
import { readPublishedRecap } from "@/lib/recapPublication";
import { attachMeetingProject } from "@/lib/recapProject";

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

export async function attachProjectToMeeting(meetingId: string, projectId: string): Promise<MeetingRecapActionState> {
  const user = await requireUser();
  if (typeof meetingId !== "string" || typeof projectId !== "string" || !meetingId || !projectId) {
    return { error: "Hãy chọn dự án để lưu trữ biên bản." };
  }
  const result = await attachMeetingProject(prisma, meetingId, projectId, user);
  if ("error" in result) return { error: result.error };
  refresh(meetingId);
  revalidatePath(`/projects/${result.projectId}`);
  return { success: result.archived
    ? `Đã gắn vào “${result.projectName}” và lưu biên bản vào tài liệu dự án.`
    : `Đã gắn vào “${result.projectName}”. Biên bản sẽ được lưu khi bạn bấm gửi.` };
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
  const claimed = await prisma.meetingRecap.updateMany({
    where: { id: recap.id, status: recap.status, processingStartedAt: recap.processingStartedAt },
    data: {
      status: "PROCESSING",
      stage: "SUMMARIZING",
      error: null,
      processingStartedAt: startedAt,
      createdById: loaded.user.id,
    },
  });
  if (claimed.count === 0) return { error: "Biên bản vừa được cập nhật. Hãy tải lại trang." };
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

  const saved = await prisma.meetingRecap.updateMany({ where: { id: recap.id, status: "READY" }, data: { content: value } });
  if (!saved.count) return { error: "Biên bản đang được xử lý. Hãy tải lại trang." };
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
  const publication = await publishRecap(prisma, recap.id, sentAt);
  if (!publication) return { error: "Biên bản đang được xử lý. Hãy tải lại trang." };
  const savedToProject = await saveRecapToProject(meetingId, user, sentAt, publication);
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
    const result = await sendMeetingRecapEmail(meetingId, publication);
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
          publishedSnapshot: true,
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
  const publishedItem = readPublishedRecap(item.recap.publishedSnapshot)?.actionItems.find((row) => row.id === item.id);
  const allowed =
    canManageMeetingRecap(meeting, user) ||
    (item.ownerId === user.id && publishedItem?.owner?.id === user.id && canReadMeetingRecap(meeting, item.recap, user));
  if (!allowed) return { error: "Chỉ người phụ trách hoặc người tổ chức mới đánh dấu được việc này." };
  if (item.taskId) return { error: "Việc này đã thành task — cập nhật trạng thái ngay trong task." };

  const toggled = await prisma.$transaction(async (tx) => {
    await lockRecap(tx, item.recap.id);
    return tx.meetingRecapActionItem.updateMany({
      where: { id: item.id, taskId: null, ...(canManageMeetingRecap(meeting, user) ? {} : { ownerId: user.id }) },
      data: { doneAt: done ? new Date() : null },
    });
  });
  if (!toggled.count) return { error: "Việc vừa được cập nhật. Hãy tải lại trang." };
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

  const saved = await prisma.$transaction(async (tx) => {
    await lockRecap(tx, recap.id);
    const current = await tx.meetingRecap.findUnique({ where: { id: recap.id }, select: { status: true } });
    if (current?.status !== "READY") return { error: "Biên bản đang được xử lý. Hãy tải lại trang." };
    if (input.id) {
      const item = await tx.meetingRecapActionItem.findFirst({
        where: { id: String(input.id), recapId: recap.id },
        select: { id: true, taskId: true },
      });
      if (!item) return { error: "Không tìm thấy việc này. Có thể biên bản vừa được viết lại." };
      if (item.taskId) return { error: "Việc này đã thành task — sửa ngay trong task." };
      await tx.meetingRecapActionItem.update({ where: { id: item.id }, data });
    } else {
      const [count, last] = await Promise.all([
        tx.meetingRecapActionItem.count({ where: { recapId: recap.id } }),
        tx.meetingRecapActionItem.findFirst({
          where: { recapId: recap.id },
          orderBy: { order: "desc" },
          select: { order: true },
        }),
      ]);
      if (count >= RECAP_ACTION_ITEMS_MAX) return { error: `Mỗi biên bản có tối đa ${RECAP_ACTION_ITEMS_MAX} việc.` };
      await tx.meetingRecapActionItem.create({
        data: { ...data, recapId: recap.id, order: (last?.order ?? -1) + 1 },
      });
    }
    return {};
  });
  if ("error" in saved) return { error: saved.error };
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
  await prisma.$transaction(async (tx) => {
    await lockRecap(tx, item.recap.id);
    await tx.meetingRecapActionItem.deleteMany({ where: { id: item.id } });
  });
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
  let task: Awaited<ReturnType<typeof createLinkedRecapTask>>;
  try {
    task = await createLinkedRecapTask(
      prisma, item.recap.id, item.id, project.id, user.id,
      `Việc giao trong cuộc họp “${meeting.title}” (${formatMeetingWhen(meeting.startAt, meeting.endAt)}).`,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "RECAP_BUSY") return { error: "Biên bản đang được xử lý. Hãy tải lại trang." };
    if (error instanceof Error && error.message === "ALREADY_LINKED") return { error: "Việc này đã có task rồi." };
    throw error;
  }

  const assigneeId = task.assigneeId;
  if (assigneeId && assigneeId !== user.id) {
    await notify([assigneeId], {
      type: "TASK_ASSIGNED",
      message: `${user.name} đã giao cho bạn task “${task.title}” (từ biên bản họp “${meeting.title}”)`,
      taskId: task.id,
      projectId: project.id,
    });
  }
  if (project.googleChatWebhookUrl) {
    const base = emailAppUrl();
    await sendGoogleChat(
      project.googleChatWebhookUrl,
      taskGoogleChatMessage({
        event: "created", taskId: task.id, projectName: project.name,
        title: task.title, status: task.status,
        assigneeName: task.assignee?.name ?? null, actorName: user.name,
        dueDate: task.dueDate, meetingTitle: meeting.title,
        url: base ? `${base}/projects/${project.id}?task=${task.id}` : null,
      })
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

/** AI suggestions become action items only after an explicit choice by a recap manager. */
export async function reviewRecapSuggestion(meetingId: string, suggestionId: string, accept: boolean): Promise<MeetingRecapActionState> {
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const recap = loaded.meeting.recap;
  if (!recap) return { error: "Không tìm thấy biên bản." };
  const result = await resolveRecapSuggestion(prisma, recap.id, String(suggestionId), accept === true);
  refresh(meetingId);
  return result;
}
