import { del, issueSignedToken, presignUrl } from "@vercel/blob";
import { formatMeetingWhen } from "@/lib/meetings";
import {
  buildRecapPrompt,
  buildTranscriptionPrompt,
  cleanTranscriptSegments,
  formatTranscript,
  RECAP_STALE_MS,
  renderRecapContent,
} from "@/lib/meetingRecap";
import { RecapServiceError, summarizeTranscript, transcribeAudioUrl } from "@/lib/meetingRecapAi";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

const SIGNED_URL_TTL_MS = 30 * 60 * 1000;

/** Xoá file ghi âm tạm; lỗi xoá không làm hỏng biên bản (cron dọn lại sau). */
export async function deleteRecapAudio(pathname: string | null | undefined): Promise<boolean> {
  if (!pathname) return true;
  try {
    await del(pathname);
    return true;
  } catch {
    console.warn("Could not delete a meeting recap audio file; the daily cron will retry.");
    return false;
  }
}

async function signedAudioUrl(pathname: string): Promise<string> {
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil: Date.now() + SIGNED_URL_TTL_MS,
  });
  const { presignedUrl } = await presignUrl(token, { operation: "get", pathname, access: "private" });
  return presignedUrl;
}

/**
 * Chạy (lại) biên bản cho một lần xử lý. `startedAt` là dấu của lần chạy:
 * mọi lần ghi đều kèm điều kiện này, nên nếu người tổ chức tải file mới
 * giữa chừng thì kết quả của lần cũ bị bỏ qua thay vì ghi đè.
 */
export async function runMeetingRecap(recapId: string, startedAt: Date): Promise<void> {
  const current = { id: recapId, status: "PROCESSING", processingStartedAt: startedAt };
  const recap = await prisma.meetingRecap.findFirst({
    where: current,
    include: {
      meeting: {
        include: {
          room: { select: { name: true } },
          organizer: { select: { id: true, name: true } },
          attendees: { select: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!recap) return;
  const { meeting } = recap;
  const attendeeNames = meeting.attendees.map((attendee) => attendee.user.name);
  const managerIds = [meeting.organizerId, recap.createdById];

  try {
    let transcript = recap.transcript ?? "";

    if (recap.audioPathname && !recap.transcript) {
      await prisma.meetingRecap.updateMany({ where: current, data: { stage: "TRANSCRIBING" } });
      const audioUrl = await signedAudioUrl(recap.audioPathname);
      const result = await transcribeAudioUrl({
        audioUrl,
        prompt: buildTranscriptionPrompt(meeting.title, [meeting.organizer.name, ...attendeeNames]),
      });
      transcript = formatTranscript(cleanTranscriptSegments(result.segments));
      const deleted = await deleteRecapAudio(recap.audioPathname);
      const saved = await prisma.meetingRecap.updateMany({
        where: current,
        data: {
          transcript,
          audioSeconds: Math.round(result.duration),
          audioPathname: deleted ? null : recap.audioPathname,
          stage: "SUMMARIZING",
        },
      });
      if (saved.count === 0) return;
    }

    if (!transcript.trim()) {
      throw new RecapServiceError("Không nghe được lời nói nào trong file ghi âm. Kiểm tra lại file rồi tải lên lần nữa.");
    }

    await prisma.meetingRecap.updateMany({ where: current, data: { stage: "SUMMARIZING" } });
    const prompt = buildRecapPrompt(
      {
        title: meeting.title,
        when: `${formatMeetingWhen(meeting.startAt, meeting.endAt)} (giờ Việt Nam)`,
        room: meeting.room?.name ?? null,
        organizer: meeting.organizer.name,
        attendees: attendeeNames,
        description: meeting.description,
      },
      transcript
    );
    const summary = await summarizeTranscript(prompt);
    const done = await prisma.meetingRecap.updateMany({
      where: current,
      data: { status: "READY", stage: null, error: null, content: renderRecapContent(summary) },
    });
    if (done.count === 0) return;

    await notify(managerIds, {
      type: "MEETING_RECAP_READY",
      message: `Biên bản họp “${meeting.title}” đã xong. Hãy đọc lại rồi gửi cho người tham dự.`,
      meetingId: meeting.id,
    });
  } catch (error) {
    const message =
      error instanceof RecapServiceError ? error.message : "Không tạo được biên bản. Thử lại sau ít phút.";
    if (!(error instanceof RecapServiceError)) console.error("Meeting recap failed", error);
    const latest = await prisma.meetingRecap.findFirst({ where: current, select: { audioPathname: true } });
    if (!latest) return;
    const deleted = await deleteRecapAudio(latest.audioPathname);
    const failed = await prisma.meetingRecap.updateMany({
      where: current,
      data: {
        status: "FAILED",
        stage: null,
        error: message,
        audioPathname: deleted ? null : latest.audioPathname,
      },
    });
    if (failed.count > 0) {
      await notify(managerIds, {
        type: "MEETING_RECAP_FAILED",
        message: `Chưa tạo được biên bản họp “${meeting.title}”: ${message}`,
        meetingId: meeting.id,
      });
    }
  }
}

/**
 * Chạy trong cron hằng ngày: lần xử lý bị treo (quá 15 phút) chuyển sang lỗi,
 * và file ghi âm còn sót trên Blob (do lần xoá trước thất bại) được xoá.
 */
export async function cleanupMeetingRecaps(now = new Date()) {
  const staleBefore = new Date(now.getTime() - RECAP_STALE_MS);
  const stuck = await prisma.meetingRecap.findMany({
    where: {
      status: "PROCESSING",
      OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleBefore } }],
    },
    select: { id: true, processingStartedAt: true, audioPathname: true },
  });
  for (const recap of stuck) {
    const deleted = await deleteRecapAudio(recap.audioPathname);
    await prisma.meetingRecap.updateMany({
      where: { id: recap.id, status: "PROCESSING", processingStartedAt: recap.processingStartedAt },
      data: {
        status: "FAILED",
        stage: null,
        error: "Xử lý bị gián đoạn. Hãy tải file ghi âm lên lại.",
        audioPathname: deleted ? null : recap.audioPathname,
      },
    });
  }

  const leftovers = await prisma.meetingRecap.findMany({
    where: { status: { not: "PROCESSING" }, audioPathname: { not: null } },
    select: { id: true, audioPathname: true },
  });
  let cleaned = 0;
  for (const recap of leftovers) {
    if (await deleteRecapAudio(recap.audioPathname)) {
      await prisma.meetingRecap.updateMany({
        where: { id: recap.id, audioPathname: recap.audioPathname },
        data: { audioPathname: null },
      });
      cleaned += 1;
    }
  }
  return { stuck: stuck.length, cleaned };
}
