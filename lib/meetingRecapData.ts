import type { RecapUsage } from "@/lib/meetingRecapLimits";
import { vnDayRange } from "@/lib/meetings";
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

/** Lượt dùng AI hôm nay (giờ Việt Nam) của cả công ty và của riêng cuộc họp này. */
export async function loadRecapUsage(meetingId: string, now = new Date()): Promise<RecapUsage> {
  const since = vnDayRange(now).start;
  const today = { createdAt: { gte: since } };
  const [audio, summaries, meetingTranscriptions, meetingSummaries] = await Promise.all([
    prisma.meetingRecapRun.aggregate({ where: { kind: "TRANSCRIBE", ...today }, _sum: { audioSeconds: true } }),
    prisma.meetingRecapRun.count({ where: { kind: "SUMMARIZE", ...today } }),
    prisma.meetingRecapRun.count({ where: { meetingId, kind: "TRANSCRIBE", ...today } }),
    prisma.meetingRecapRun.count({ where: { meetingId, kind: "SUMMARIZE", ...today } }),
  ]);
  return {
    audioSecondsToday: audio._sum.audioSeconds ?? 0,
    summariesToday: summaries,
    meetingTranscriptionsToday: meetingTranscriptions,
    meetingSummariesToday: meetingSummaries,
  };
}
