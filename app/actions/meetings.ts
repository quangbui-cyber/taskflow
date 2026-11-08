"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { MEETINGS_DISABLED_MESSAGE, meetingsEnabled, crmEnabled, CRM_DISABLED_MESSAGE } from "@/lib/features";
import { ownerData, ownerRevalidatePaths, parseOwnerInput, type WorkOwner } from "@/lib/workOwner";
import { assertOwnerAccess } from "@/lib/taskAccess";
import { sendMeetingEmail, type MeetingMailKind } from "@/lib/meetingMail";
import {
  MEETING_DESCRIPTION_MAX,
  MEETING_MAX_ATTENDEES,
  MEETING_TITLE_MAX,
  formatMeetingTime,
  formatMeetingWhen,
  isMeetingTimeSlot,
  vnDateTimeToUtc,
} from "@/lib/meetings";
import { expandRecurrence, parseRecurrenceForm, recurrenceLabel } from "@/lib/meetingRecurrence";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { parseMeetCode } from "@/lib/meetLink";

export type MeetingActionState = {
  error?: string;
  success?: string;
};

type MeetingInput = {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  roomId: string | null;
  meetingUrl: string | null;
  attendeeIds: string[];
  /** Người ghi biên bản; null = người tổ chức tự ghi. */
  recorderId: string | null;
};

type Recipient = { name: string; email: string };

/** Lỗi nghiệp vụ ném ra trong transaction để rollback rồi trả về cho form */
class MeetingConflictError extends Error {}

function parseMeetingForm(
  formData: FormData,
  organizerId: string
): MeetingInput | { error: string } {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  const roomId = String(formData.get("roomId") ?? "").trim();
  const meetingUrl = String(formData.get("meetingUrl") ?? "").trim();
  const attendeeIds = [
    ...new Set(
      formData
        .getAll("attendeeIds")
        .map((value) => String(value))
        .filter((id) => id && id !== organizerId)
    ),
  ];

  if (title.length < 2) return { error: "Tiêu đề cuộc họp cần có ít nhất 2 ký tự." };
  if (title.length > MEETING_TITLE_MAX) {
    return { error: `Tiêu đề không được dài quá ${MEETING_TITLE_MAX} ký tự.` };
  }
  if (description.length > MEETING_DESCRIPTION_MAX) {
    return { error: `Nội dung không được dài quá ${MEETING_DESCRIPTION_MAX} ký tự.` };
  }

  if (!isMeetingTimeSlot(startTime) || !isMeetingTimeSlot(endTime)) {
    return { error: "Giờ họp chỉ nhận mốc tròn giờ hoặc 30 phút, ví dụ 09:00 hoặc 09:30." };
  }
  const startAt = vnDateTimeToUtc(date, startTime);
  const endAt = vnDateTimeToUtc(date, endTime);
  if (!startAt || !endAt) return { error: "Hãy chọn ngày và giờ họp hợp lệ." };
  if (endAt.getTime() <= startAt.getTime()) {
    return { error: "Giờ kết thúc phải sau giờ bắt đầu." };
  }
  if (startAt.getTime() < Date.now()) {
    return { error: "Không thể đặt lịch họp trong quá khứ." };
  }

  // Không mời ai cũng được: họp một mình với khách vẫn cần giữ phòng và ghi biên bản.
  if (attendeeIds.length > MEETING_MAX_ATTENDEES) {
    return { error: `Một cuộc họp tối đa ${MEETING_MAX_ATTENDEES} người tham dự.` };
  }

  const requestedRecorder = String(formData.get("recorderId") ?? "").trim();
  const recorderId = requestedRecorder && requestedRecorder !== organizerId ? requestedRecorder : null;
  if (recorderId && !attendeeIds.includes(recorderId)) {
    return { error: "Người ghi biên bản phải là người tham dự cuộc họp." };
  }

  if (meetingUrl) {
    let valid = false;
    try {
      valid = new URL(meetingUrl).protocol === "https:" && meetingUrl.length <= 500;
    } catch {
      valid = false;
    }
    if (!valid) return { error: "Link họp online phải là địa chỉ https:// hợp lệ." };
  }

  return {
    title,
    description: description || null,
    startAt,
    endAt,
    roomId: roomId || null,
    meetingUrl: meetingUrl || null,
    attendeeIds,
    recorderId,
  };
}

/**
 * Khoá theo phòng rồi kiểm tra trùng giờ trong cùng transaction, để hai người
 * bấm đặt cùng lúc không thể cùng giữ một phòng. Chỉ xét cuộc họp chưa huỷ.
 */
async function assertRoomFree(
  tx: Pick<typeof prisma, "$executeRaw" | "meeting">,
  input: Pick<MeetingInput, "startAt" | "endAt"> & { roomId: string },
  ignoreMeetingId?: string
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.roomId}))`;
  const clash = await tx.meeting.findFirst({
    where: {
      roomId: input.roomId,
      status: "SCHEDULED",
      ...(ignoreMeetingId ? { id: { not: ignoreMeetingId } } : {}),
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
    },
    select: {
      title: true,
      startAt: true,
      endAt: true,
      organizer: { select: { name: true } },
    },
    orderBy: { startAt: "asc" },
  });
  if (clash) {
    throw new MeetingConflictError(
      `Phòng đã có lịch “${clash.title}” của ${clash.organizer.name} lúc ${formatMeetingTime(
        clash.startAt,
        clash.endAt
      )}. Hãy chọn phòng hoặc giờ khác.`
    );
  }
}

async function loadActiveRoom(roomId: string | null) {
  if (!roomId) return { room: null };
  const room = await prisma.meetingRoom.findFirst({
    where: { id: roomId, isActive: true },
    select: { id: true, name: true },
  });
  return room ? { room } : { error: "Phòng họp không tồn tại hoặc đã ngừng dùng." };
}

async function loadActiveUsers(userIds: string[]) {
  return prisma.user.findMany({
    where: { id: { in: userIds }, isActive: true },
    select: { id: true, name: true, email: true },
  });
}

/** Tên những người (trong danh sách) đang có cuộc họp khác trùng giờ — chỉ để cảnh báo, không chặn */
async function busyPeopleNames(
  userIds: string[],
  startAt: Date,
  endAt: Date,
  ignoreMeetingId?: string
) {
  const overlapping = await prisma.meeting.findMany({
    where: {
      status: "SCHEDULED",
      ...(ignoreMeetingId ? { id: { not: ignoreMeetingId } } : {}),
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      OR: [
        { organizerId: { in: userIds } },
        { attendees: { some: { userId: { in: userIds }, response: { not: "DECLINED" } } } },
      ],
    },
    select: {
      organizer: { select: { id: true, name: true } },
      attendees: {
        where: { userId: { in: userIds }, response: { not: "DECLINED" } },
        select: { user: { select: { id: true, name: true } } },
      },
    },
  });

  const wanted = new Set(userIds);
  const busy = new Map<string, string>();
  for (const meeting of overlapping) {
    if (wanted.has(meeting.organizer.id)) {
      busy.set(meeting.organizer.id, meeting.organizer.name);
    }
    for (const attendee of meeting.attendees) {
      busy.set(attendee.user.id, attendee.user.name);
    }
  }
  return [...busy.values()];
}

function busyWarning(names: string[]) {
  if (names.length === 0) return "";
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` và ${names.length - 3} người khác` : "";
  return ` Lưu ý: ${shown}${more} đang có lịch họp khác trùng giờ.`;
}

/** Gửi mail sau khi đã trả kết quả cho người dùng — SMTP chậm hay lỗi không ảnh hưởng thao tác đặt lịch */
function queueMeetingEmail(
  meetingId: string,
  kind: MeetingMailKind,
  recipients?: Recipient[]
) {
  after(async () => {
    try {
      const result = await sendMeetingEmail({ meetingId, kind, recipients });
      if (!result.ok) console.warn("Meeting email delivery could not be completed.");
    } catch {
      console.warn("Meeting email delivery could not be completed.");
    }
  });
}

function revalidateMeetings() {
  revalidatePath("/meetings");
  revalidatePath("/notifications");
}

export async function createMeeting(
  _previousState: MeetingActionState,
  formData: FormData
): Promise<MeetingActionState> {
  if (!meetingsEnabled()) return { error: MEETINGS_DISABLED_MESSAGE };
  const user = await requireUser();
  const input = parseMeetingForm(formData, user.id);
  if ("error" in input) return input;

  const rule = parseRecurrenceForm(
    (name) => String(formData.get(name) ?? ""),
    (name) => formData.getAll(name).map(String)
  );
  let occurrences = [{ startAt: input.startAt, endAt: input.endAt }];
  if (rule && "error" in rule) return { error: rule.error };
  if (rule) {
    const expanded = expandRecurrence(String(formData.get("date") ?? ""), rule);
    if ("error" in expanded) return { error: expanded.error };
    const startTime = String(formData.get("startTime") ?? "");
    const endTime = String(formData.get("endTime") ?? "");
    occurrences = expanded.dates.flatMap((date) => {
      const startAt = vnDateTimeToUtc(date, startTime);
      const endAt = vnDateTimeToUtc(date, endTime);
      return startAt && endAt ? [{ startAt, endAt }] : [];
    });
    if (occurrences[0].startAt.getTime() < Date.now()) {
      return { error: "Không thể đặt lịch họp trong quá khứ." };
    }
  }
  const seriesId = rule ? randomUUID() : null;

  // Explicit owner fields take precedence; legacy Project forms remain supported.
  const requestedProjectId = String(formData.get("projectId") ?? "").trim();
  let owner: WorkOwner | null = null;
  if (formData.has("ownerKind") || formData.has("ownerId")) {
    owner = parseOwnerInput(formData.get("ownerKind"), formData.get("ownerId"));
    if (!owner) return { error: "Chọn nơi gắn cuộc họp hợp lệ." };
  } else if (requestedProjectId) {
    owner = parseOwnerInput("PROJECT", requestedProjectId);
    if (!owner) return { error: "Chọn dự án hợp lệ." };
  }
  if (owner) {
    if (owner.kind !== "PROJECT" && !crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
    const access = await assertOwnerAccess(prisma, user, owner, "CREATE_TASK");
    if ("error" in access) return access;
  }

  const [roomResult, attendees] = await Promise.all([
    loadActiveRoom(input.roomId),
    loadActiveUsers(input.attendeeIds),
  ]);
  if ("error" in roomResult) return { error: roomResult.error };
  if (attendees.length !== input.attendeeIds.length) {
    return { error: "Có người tham dự không còn hoạt động. Hãy chọn lại." };
  }

  const createdIds: string[] = [];
  const skippedStarts: Date[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        if (owner) {
          const access = await assertOwnerAccess(tx, user, owner, "CREATE_TASK");
          if ("error" in access) throw new MeetingConflictError(access.error);
        }
        for (const occurrence of occurrences) {
          if (input.roomId) {
            try {
              await assertRoomFree(tx, { ...occurrence, roomId: input.roomId });
            } catch (error) {
              // Lịch lặp lại: buổi nào phòng đã bận thì bỏ qua, các buổi còn lại vẫn đặt.
              if (error instanceof MeetingConflictError && rule) {
                skippedStarts.push(occurrence.startAt);
                continue;
              }
              throw error;
            }
          }
          const meeting = await tx.meeting.create({
            data: {
              title: input.title,
              description: input.description,
              startAt: occurrence.startAt,
              endAt: occurrence.endAt,
              roomId: input.roomId,
              meetingUrl: input.meetingUrl,
              meetCode: parseMeetCode(input.meetingUrl),
              organizerId: user.id,
              recorderId: input.recorderId,
              ...(owner ? ownerData(owner) : {}),
              seriesId,
              seriesFrequency: rule?.frequency ?? null,
              attendees: {
                create: attendees.map((attendee) => ({ userId: attendee.id })),
              },
            },
            select: { id: true },
          });
          createdIds.push(meeting.id);
        }
        if (createdIds.length === 0) {
          throw new MeetingConflictError(
            "Phòng đã có lịch ở mọi buổi trong chuỗi. Hãy chọn phòng hoặc giờ khác."
          );
        }
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
  } catch (error) {
    if (error instanceof MeetingConflictError) return { error: error.message };
    throw error;
  }
  const meetingId = createdIds[0];
  const firstStart = occurrences.find(
    (occurrence) => !skippedStarts.some((skipped) => skipped.getTime() === occurrence.startAt.getTime())
  )!;

  const when = formatMeetingWhen(firstStart.startAt, firstStart.endAt);
  const where = roomResult.room ? ` tại ${roomResult.room.name}` : "";
  const seriesNote = rule
    ? ` (họp ${recurrenceLabel(rule.frequency)?.toLowerCase()}, ${createdIds.length} buổi, buổi đầu)`
    : "";
  await notify(
    attendees.map((attendee) => attendee.id),
    {
      type: "MEETING_INVITED",
      message: `${user.name} mời bạn họp “${input.title}”${seriesNote} lúc ${when}${where}`,
      meetingId,
    }
  );
  if (input.recorderId) {
    await notify([input.recorderId], {
      type: "MEETING_UPDATED",
      message: `${user.name} giao bạn ghi biên bản cuộc họp “${input.title}”`,
      meetingId,
    });
  }
  // Chuỗi lặp lại chỉ gửi một email mời (buổi đầu) để không làm ngập hộp thư.
  queueMeetingEmail(meetingId, "INVITED");
  if (owner) for (const path of ownerRevalidatePaths(owner)) revalidatePath(path);

  const busy = await busyPeopleNames(
    attendees.map((attendee) => attendee.id),
    firstStart.startAt,
    firstStart.endAt,
    meetingId
  );
  revalidateMeetings();
  if (rule) {
    const skippedNote = skippedStarts.length
      ? ` Bỏ qua ${skippedStarts.length} buổi vì phòng đã bận.`
      : "";
    return {
      success: `Đã đặt ${createdIds.length} buổi họp${attendees.length ? " và gửi lời mời" : ""}.${skippedNote}${busyWarning(busy)}`,
    };
  }
  return {
    success: attendees.length
      ? `Đã đặt lịch họp và gửi lời mời.${busyWarning(busy)}`
      : `Đã đặt lịch họp.${busyWarning(busy)}`,
  };
}

export async function updateMeeting(
  meetingId: string,
  _previousState: MeetingActionState,
  formData: FormData
): Promise<MeetingActionState> {
  if (!meetingsEnabled()) return { error: MEETINGS_DISABLED_MESSAGE };
  const user = await requireUser();
  const existing = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      status: true,
      organizerId: true,
      recorderId: true,
      startAt: true,
      endAt: true,
      roomId: true,
      attendees: {
        select: { userId: true, user: { select: { name: true, email: true, isActive: true } } },
      },
    },
  });
  if (!existing) return { error: "Không tìm thấy cuộc họp." };
  if (existing.organizerId !== user.id && user.role !== "ADMIN") {
    return { error: "Chỉ người tổ chức mới được sửa cuộc họp này." };
  }
  if (existing.status !== "SCHEDULED") return { error: "Cuộc họp này đã bị huỷ." };
  if (existing.endAt.getTime() < Date.now()) {
    return { error: "Cuộc họp đã kết thúc nên không thể sửa." };
  }

  const input = parseMeetingForm(formData, existing.organizerId);
  if ("error" in input) return input;

  const [roomResult, attendees] = await Promise.all([
    // Phòng đang giữ sẵn vẫn được giữ kể cả khi admin vừa cho ngừng dùng.
    input.roomId === existing.roomId
      ? Promise.resolve({ room: null as { id: string; name: string } | null })
      : loadActiveRoom(input.roomId),
    loadActiveUsers(input.attendeeIds),
  ]);
  if ("error" in roomResult) return { error: roomResult.error };
  if (attendees.length !== input.attendeeIds.length) {
    return { error: "Có người tham dự không còn hoạt động. Hãy chọn lại." };
  }

  const previousIds = new Set(existing.attendees.map((attendee) => attendee.userId));
  const nextIds = new Set(attendees.map((attendee) => attendee.id));
  const added = attendees.filter((attendee) => !previousIds.has(attendee.id));
  const kept = attendees.filter((attendee) => previousIds.has(attendee.id));
  const removed = existing.attendees.filter((attendee) => !nextIds.has(attendee.userId));
  const timeChanged =
    existing.startAt.getTime() !== input.startAt.getTime() ||
    existing.endAt.getTime() !== input.endAt.getTime();

  try {
    await prisma.$transaction(async (tx) => {
      if (input.roomId) {
        await assertRoomFree(tx, { ...input, roomId: input.roomId }, meetingId);
      }
      await tx.meetingAttendee.deleteMany({
        where: { meetingId, userId: { in: removed.map((attendee) => attendee.userId) } },
      });
      // Đổi giờ thì mọi người phải xác nhận lại — câu trả lời cũ không còn ý nghĩa.
      if (timeChanged) {
        await tx.meetingAttendee.updateMany({
          where: { meetingId },
          data: { response: "PENDING" },
        });
      }
      await tx.meeting.update({
        where: { id: meetingId },
        data: {
          title: input.title,
          description: input.description,
          startAt: input.startAt,
          endAt: input.endAt,
          roomId: input.roomId,
          meetingUrl: input.meetingUrl,
          meetCode: parseMeetCode(input.meetingUrl),
          recorderId: input.recorderId,
          sequence: { increment: 1 },
          attendees: {
            create: added.map((attendee) => ({ userId: attendee.id })),
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof MeetingConflictError) return { error: error.message };
    throw error;
  }

  const when = formatMeetingWhen(input.startAt, input.endAt);
  const newRecorderId =
    input.recorderId && input.recorderId !== existing.recorderId && input.recorderId !== user.id
      ? input.recorderId
      : null;
  await Promise.all([
    newRecorderId
      ? notify([newRecorderId], {
          type: "MEETING_UPDATED",
          message: `${user.name} giao bạn ghi biên bản cuộc họp “${input.title}”`,
          meetingId,
        })
      : Promise.resolve(),
    notify(
      added.map((attendee) => attendee.id),
      {
        type: "MEETING_INVITED",
        message: `${user.name} mời bạn họp “${input.title}” lúc ${when}`,
        meetingId,
      }
    ),
    notify(
      // Admin sửa hộ thì người tổ chức cũng cần biết.
      [existing.organizerId, ...kept.map((attendee) => attendee.id)].filter(
        (id) => id !== user.id
      ),
      {
        type: "MEETING_UPDATED",
        message: `${user.name} đã cập nhật lịch họp “${input.title}”: ${when}`,
        meetingId,
      }
    ),
    notify(
      removed.map((attendee) => attendee.userId),
      {
        type: "MEETING_CANCELLED",
        message: `Bạn không còn trong danh sách tham dự cuộc họp “${input.title}”`,
        meetingId,
      }
    ),
  ]);

  queueMeetingEmail(meetingId, "UPDATED");
  const removedRecipients = removed
    .filter((attendee) => attendee.user.isActive)
    .map((attendee) => ({ name: attendee.user.name, email: attendee.user.email }));
  if (removedRecipients.length > 0) {
    queueMeetingEmail(meetingId, "REMOVED", removedRecipients);
  }

  const busy = await busyPeopleNames(
    attendees.map((attendee) => attendee.id),
    input.startAt,
    input.endAt,
    meetingId
  );
  revalidateMeetings();
  return { success: `Đã cập nhật lịch họp.${busyWarning(busy)}` };
}

export async function cancelMeeting(meetingId: string): Promise<MeetingActionState> {
  if (!meetingsEnabled()) return { error: MEETINGS_DISABLED_MESSAGE };
  const user = await requireUser();
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      title: true,
      status: true,
      organizerId: true,
      startAt: true,
      endAt: true,
      room: { select: { name: true } },
      attendees: { select: { userId: true } },
    },
  });
  if (!meeting) return { error: "Không tìm thấy cuộc họp." };
  if (meeting.organizerId !== user.id && user.role !== "ADMIN") {
    return { error: "Chỉ người tổ chức mới được huỷ cuộc họp này." };
  }
  if (meeting.status !== "SCHEDULED") return { success: "Cuộc họp đã được huỷ trước đó." };
  if (meeting.endAt.getTime() < Date.now()) {
    return { error: "Cuộc họp đã kết thúc nên không thể huỷ." };
  }

  // Điều kiện status trong where để hai lần bấm huỷ liên tiếp không gửi mail hai lần.
  const cancelled = await prisma.meeting.updateMany({
    where: { id: meetingId, status: "SCHEDULED" },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      sequence: { increment: 1 },
    },
  });
  if (cancelled.count === 0) return { success: "Cuộc họp đã được huỷ trước đó." };

  await notify(
    [meeting.organizerId, ...meeting.attendees.map((attendee) => attendee.userId)].filter(
      (id) => id !== user.id
    ),
    {
      type: "MEETING_CANCELLED",
      message: `${user.name} đã huỷ cuộc họp “${meeting.title}” (${formatMeetingWhen(
        meeting.startAt,
        meeting.endAt
      )})`,
      meetingId,
    }
  );
  queueMeetingEmail(meetingId, "CANCELLED");

  revalidateMeetings();
  return {
    success: meeting.room
      ? `Đã huỷ cuộc họp. ${meeting.room.name} đã trống trở lại.`
      : "Đã huỷ cuộc họp.",
  };
}

export async function cancelMeetingSeries(
  meetingId: string,
  scope: "following" | "all"
): Promise<MeetingActionState> {
  if (!meetingsEnabled()) return { error: MEETINGS_DISABLED_MESSAGE };
  const user = await requireUser();
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { title: true, seriesId: true, organizerId: true, startAt: true },
  });
  if (!meeting) return { error: "Không tìm thấy cuộc họp." };
  if (meeting.organizerId !== user.id && user.role !== "ADMIN") {
    return { error: "Chỉ người tổ chức mới được huỷ cuộc họp này." };
  }
  if (!meeting.seriesId) return cancelMeeting(meetingId);

  const now = new Date();
  // Chỉ huỷ các buổi chưa diễn ra; buổi đã họp giữ nguyên.
  const targets = await prisma.meeting.findMany({
    where: {
      seriesId: meeting.seriesId,
      status: "SCHEDULED",
      endAt: { gte: now },
      ...(scope === "following" ? { startAt: { gte: meeting.startAt } } : {}),
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      attendees: { select: { userId: true } },
      room: { select: { name: true } },
    },
  });
  if (targets.length === 0) return { success: "Các buổi này đã được huỷ trước đó." };

  const cancelled = await prisma.meeting.updateMany({
    where: { id: { in: targets.map((target) => target.id) }, status: "SCHEDULED" },
    data: { status: "CANCELLED", cancelledAt: now, sequence: { increment: 1 } },
  });
  if (cancelled.count === 0) return { success: "Các buổi này đã được huỷ trước đó." };

  const recipientIds = new Set<string>([meeting.organizerId]);
  for (const target of targets) {
    for (const attendee of target.attendees) recipientIds.add(attendee.userId);
  }
  recipientIds.delete(user.id);
  await notify([...recipientIds], {
    type: "MEETING_CANCELLED",
    message: `${user.name} đã huỷ ${cancelled.count} buổi của cuộc họp định kỳ “${meeting.title}”`,
    meetingId: targets[0].id,
  });

  // Email mời chỉ gửi cho buổi đầu của chuỗi, nên chỉ buổi đó cần email huỷ.
  const firstOfSeries = await prisma.meeting.findFirst({
    where: { seriesId: meeting.seriesId },
    orderBy: { startAt: "asc" },
    select: { id: true },
  });
  if (firstOfSeries && targets.some((target) => target.id === firstOfSeries.id)) {
    queueMeetingEmail(firstOfSeries.id, "CANCELLED");
  }

  revalidateMeetings();
  const roomName = targets.find((target) => target.room)?.room?.name;
  return {
    success: roomName
      ? `Đã huỷ ${cancelled.count} buổi họp. ${roomName} đã trống trở lại.`
      : `Đã huỷ ${cancelled.count} buổi họp.`,
  };
}

export async function respondToMeeting(
  meetingId: string,
  response: "ACCEPTED" | "DECLINED"
): Promise<MeetingActionState> {
  if (!meetingsEnabled()) return { error: MEETINGS_DISABLED_MESSAGE };
  const user = await requireUser();
  if (response !== "ACCEPTED" && response !== "DECLINED") {
    return { error: "Phản hồi không hợp lệ." };
  }

  const invite = await prisma.meetingAttendee.findUnique({
    where: { meetingId_userId: { meetingId, userId: user.id } },
    select: {
      id: true,
      response: true,
      meeting: {
        select: { title: true, status: true, endAt: true, organizerId: true },
      },
    },
  });
  if (!invite) return { error: "Bạn không có trong danh sách tham dự cuộc họp này." };
  if (invite.meeting.status !== "SCHEDULED") return { error: "Cuộc họp này đã bị huỷ." };
  if (invite.meeting.endAt.getTime() < Date.now()) {
    return { error: "Cuộc họp đã kết thúc." };
  }

  if (invite.response !== response) {
    await prisma.meetingAttendee.update({
      where: { id: invite.id },
      data: { response },
    });
    await notify([invite.meeting.organizerId], {
      type: "MEETING_RESPONSE",
      message:
        response === "ACCEPTED"
          ? `${user.name} sẽ tham dự cuộc họp “${invite.meeting.title}”`
          : `${user.name} từ chối tham dự cuộc họp “${invite.meeting.title}”`,
      meetingId,
    });
  }

  revalidateMeetings();
  return {
    success:
      response === "ACCEPTED" ? "Đã xác nhận tham dự." : "Đã báo không tham dự.",
  };
}

export async function createMeetingRoom(
  _previousState: MeetingActionState,
  formData: FormData
): Promise<MeetingActionState> {
  if (!meetingsEnabled()) return { error: MEETINGS_DISABLED_MESSAGE };
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  if (!name) return { error: "Tên phòng họp không được để trống." };
  if (name.length > 60) return { error: "Tên phòng họp không được dài quá 60 ký tự." };

  let capacity: number | null = null;
  if (capacityRaw) {
    capacity = Number(capacityRaw);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) {
      return { error: "Sức chứa phải là số nguyên từ 1 đến 1000." };
    }
  }

  const existing = await prisma.meetingRoom.findUnique({ where: { name } });
  if (existing) return { error: "Phòng họp này đã tồn tại." };

  await prisma.meetingRoom.create({ data: { name, capacity } });
  revalidatePath("/admin");
  revalidatePath("/meetings");
  return { success: `Đã thêm phòng họp "${name}".` };
}

export async function setMeetingRoomActive(
  roomId: string,
  isActive: boolean
): Promise<MeetingActionState> {
  if (!meetingsEnabled()) return { error: MEETINGS_DISABLED_MESSAGE };
  await requireAdmin();
  const room = await prisma.meetingRoom.findUnique({
    where: { id: roomId },
    select: { name: true },
  });
  if (!room) return { error: "Phòng họp không tồn tại." };

  await prisma.meetingRoom.update({ where: { id: roomId }, data: { isActive } });
  revalidatePath("/admin");
  revalidatePath("/meetings");
  return {
    success: isActive
      ? `Đã mở lại ${room.name}.`
      : `Đã ngừng dùng ${room.name}. Các cuộc họp đã đặt vẫn giữ nguyên.`,
  };
}

export async function deleteMeetingRoom(roomId: string): Promise<MeetingActionState> {
  if (!meetingsEnabled()) return { error: MEETINGS_DISABLED_MESSAGE };
  await requireAdmin();
  const upcoming = await prisma.meeting.count({
    where: { roomId, status: "SCHEDULED", endAt: { gte: new Date() } },
  });
  if (upcoming > 0) {
    return {
      error: `Phòng đang có ${upcoming} cuộc họp sắp tới. Hãy ngừng dùng phòng thay vì xoá.`,
    };
  }

  // onDelete: SetNull ở Meeting.roomId → các cuộc họp cũ chỉ mất tên phòng, không bị xoá
  await prisma.meetingRoom.delete({ where: { id: roomId } });
  revalidatePath("/admin");
  revalidatePath("/meetings");
  return { success: "Đã xoá phòng họp." };
}
