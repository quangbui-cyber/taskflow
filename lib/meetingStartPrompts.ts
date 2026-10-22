import type { Prisma } from "@prisma/client";
import { meetingRecapsEnabled } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import {
  MEETING_START_PROMPT_WINDOW_MS,
  meetingStartPromptKey,
  meetingStartPromptMessage,
} from "@/lib/meetingStartPromptText";
import { deliverPush } from "@/lib/webPush";

/**
 * Báo người ghi biên bản (mặc định là người tổ chức) khi cuộc họp vừa bắt đầu mà chưa có biên bản: bấm vào là mở trang
 * biên bản và ghi âm ngay. Mỗi cuộc họp chỉ báo một lần (khoá chống trùng).
 */
export async function sendMeetingStartPrompts(now = new Date()) {
  if (!meetingRecapsEnabled()) return { prompted: 0 };

  const meetings = await prisma.meeting.findMany({
    where: {
      status: "SCHEDULED",
      startAt: { lte: now, gte: new Date(now.getTime() - MEETING_START_PROMPT_WINDOW_MS) },
      endAt: { gt: now },
      recap: null,
    },
    select: {
      id: true,
      title: true,
      organizer: { select: { id: true, isActive: true } },
      recorder: { select: { id: true, isActive: true } },
    },
  });
  // Người ghi biên bản đã nghỉ thì báo người tổ chức; cả hai đều nghỉ thì bỏ qua.
  const targets = meetings.flatMap((meeting) => {
    const userId = [meeting.recorder, meeting.organizer].find((person) => person?.isActive)?.id;
    return userId ? [{ ...meeting, userId }] : [];
  });
  if (targets.length === 0) return { prompted: 0 };

  const rows: Prisma.NotificationCreateManyInput[] = targets.map((meeting) => ({
    dedupeKey: meetingStartPromptKey(meeting.id),
    userId: meeting.userId,
    type: "MEETING_RECAP_PROMPT",
    message: meetingStartPromptMessage(meeting.title),
    meetingId: meeting.id,
  }));
  const created = await prisma.notification.createManyAndReturn({ data: rows, skipDuplicates: true });

  const results = await Promise.allSettled(
    created.map((notification) =>
      deliverPush([notification.userId], {
        type: notification.type,
        message: notification.message,
        meetingId: notification.meetingId ?? undefined,
      })
    )
  );
  if (results.some((result) => result.status === "rejected")) {
    console.warn("Some meeting start push notifications could not be sent.");
  }
  return { prompted: created.length };
}
