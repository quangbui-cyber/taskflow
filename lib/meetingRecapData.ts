import { prisma } from "@/lib/prisma";

/** Thông tin cuộc họp cần để kiểm tra quyền và trạng thái biên bản. */
export function findRecapMeeting(meetingId: string) {
  return prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      title: true,
      status: true,
      startAt: true,
      endAt: true,
      organizerId: true,
      attendees: { select: { userId: true } },
      recap: {
        select: {
          id: true,
          status: true,
          processingStartedAt: true,
          audioPathname: true,
          transcript: true,
          content: true,
          sentAt: true,
        },
      },
    },
  });
}
