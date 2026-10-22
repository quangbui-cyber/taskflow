"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { MEETINGS_DISABLED_MESSAGE, meetingsEnabled } from "@/lib/features";
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
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

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

  if (attendeeIds.length === 0) {
    return { error: "Hãy chọn ít nhất một người tham dự." };
  }
  if (attendeeIds.length > MEETING_MAX_ATTENDEES) {
    return { error: `Một cuộc họp tối đa ${MEETING_MAX_ATTENDEES} người tham dự.` };
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

  // Họp tạo từ trang dự án: gắn vào dự án (người tạo phải là thành viên hoặc admin).
  const requestedProjectId = String(formData.get("projectId") ?? "").trim();
  let projectId: string | null = null;
  if (requestedProjectId) {
    const canUseProject =
      user.role === "ADMIN" ||
      Boolean(
        await prisma.projectMember.findFirst({
          where: { projectId: requestedProjectId, userId: user.id },
          select: { id: true },
        })
      );
    const project = canUseProject
      ? await prisma.project.findUnique({ where: { id: requestedProjectId }, select: { id: true } })
      : null;
    if (!project) return { error: "Bạn không có quyền tạo cuộc họp cho dự án này." };
    projectId = project.id;
  }

  const [roomResult, attendees] = await Promise.all([
    loadActiveRoom(input.roomId),
    loadActiveUsers(input.attendeeIds),
  ]);
  if ("error" in roomResult) return { error: roomResult.error };
  if (attendees.length !== input.attendeeIds.length) {
    return { error: "Có người tham dự không còn hoạt động. Hãy chọn lại." };
  }

  let meetingId: string;
  try {
    meetingId = await prisma.$transaction(async (tx) => {
      if (input.roomId) await assertRoomFree(tx, { ...input, roomId: input.roomId });
      const meeting = await tx.meeting.create({
        data: {
          title: input.title,
          description: input.description,
          startAt: input.startAt,
          endAt: input.endAt,
          roomId: input.roomId,
          meetingUrl: input.meetingUrl,
          organizerId: user.id,
          projectId,
          attendees: {
            create: attendees.map((attendee) => ({ userId: attendee.id })),
          },
        },
        select: { id: true },
      });
      return meeting.id;
    });
  } catch (error) {
    if (error instanceof MeetingConflictError) return { error: error.message };
    throw error;
  }

  const when = formatMeetingWhen(input.startAt, input.endAt);
  const where = roomResult.room ? ` tại ${roomResult.room.name}` : "";
  await notify(
    attendees.map((attendee) => attendee.id),
    {
      type: "MEETING_INVITED",
      message: `${user.name} mời bạn họp “${input.title}” lúc ${when}${where}`,
      meetingId,
    }
  );
  queueMeetingEmail(meetingId, "INVITED");

  const busy = await busyPeopleNames(
    attendees.map((attendee) => attendee.id),
    input.startAt,
    input.endAt,
    meetingId
  );
  revalidateMeetings();
  return { success: `Đã đặt lịch họp và gửi lời mời.${busyWarning(busy)}` };
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
  await Promise.all([
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
