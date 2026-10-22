import { del, issueSignedToken, presignUrl } from "@vercel/blob";
import { formatMeetingWhen } from "@/lib/meetings";
import {
  buildRecapPrompt,
  badTranscriptWindows,
  buildTranscriptionPrompt,
  cleanStoredTranscript,
  cleanTranscriptSegments,
  formatTranscript,
  mergeRecoveredSegments,
  totalWindowSeconds,
  transcriptionHintWords,
  type TranscriptSegment,
  limitTranscriptForSummary,
  RECAP_STALE_MS,
  recapActionItemRows,
  recapExportContent,
  renderRecapContent,
} from "@/lib/meetingRecap";
import {
  RECAP_SUMMARY_TIMEOUT_MS,
  RecapServiceError,
  summarizeTranscript,
  transcribeAudioUrl,
} from "@/lib/meetingRecapAi";
import { loadRecapUsage } from "@/lib/meetingRecapData";
import { recapLimits, retranscribeAllowed, summaryLimitReason } from "@/lib/meetingRecapLimits";
import { notify } from "@/lib/notify";
import { DOCX_MIME_TYPE, buildRecapDocx, recapDocxFileName } from "@/lib/recapDocx";
import { prisma } from "@/lib/prisma";
import { recapActionExportSelect, recapActionOrder, toRecapActionExport } from "@/lib/meetingRecapData";

const SIGNED_URL_TTL_MS = 30 * 60 * 1000;
// Lượt chạy nền có 300 giây (maxDuration); chừa lại một chút để kịp ghi lỗi nếu hết giờ.
const RUN_BUDGET_MS = 280_000;
const MIN_SUMMARY_TIMEOUT_MS = 45_000;
// Chừa cho phần viết biên bản khi quyết định có chép lại lần hai hay không.
const SUMMARY_RESERVE_MS = 90_000;

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
 * Lần chép đầu có đoạn hỏng (Whisper chép lại gợi ý hoặc bị kẹt rơi dấu, thường mất cả khung 30 giây
 * lời nói thật): chép lại cả file một lần nữa, không kèm gợi ý, để lấy lại lời nói ở các đoạn đó.
 * Chỉ làm khi đủ hạn mức phút trong ngày và đủ thời gian; lỗi ở bước này không làm hỏng biên bản.
 */
async function retranscribeBadParts({
  audioUrl,
  meetingId,
  userId,
  primary,
  hintWords,
  billedSeconds,
  hasTime,
}: {
  audioUrl: string;
  meetingId: string;
  userId: string | null;
  primary: TranscriptSegment[];
  hintWords: Set<string>;
  billedSeconds: number;
  hasTime: boolean;
}): Promise<TranscriptSegment[]> {
  const badSeconds = totalWindowSeconds(badTranscriptWindows(primary, hintWords));
  if (!hasTime) return [];
  if (!retranscribeAllowed(recapLimits(), await loadRecapUsage(meetingId), { badSeconds, audioSeconds: billedSeconds })) {
    return [];
  }
  try {
    await prisma.meetingRecapRun.create({
      data: { meetingId, userId, kind: "RETRANSCRIBE", audioSeconds: billedSeconds },
    });
    const retry = await transcribeAudioUrl({ audioUrl, prompt: "" });
    console.info(`Meeting recap: re-transcribed ${Math.round(badSeconds)}s of unclear audio without the hint.`);
    return cleanTranscriptSegments(retry.segments);
  } catch (error) {
    console.warn("Meeting recap re-transcription failed; keeping the first pass.", error);
    return [];
  }
}

/**
 * Chạy (lại) biên bản cho một lần xử lý. `startedAt` là dấu của lần chạy:
 * mọi lần ghi đều kèm điều kiện này, nên nếu người tổ chức tải file mới
 * giữa chừng thì kết quả của lần cũ bị bỏ qua thay vì ghi đè.
 */
export async function runMeetingRecap(recapId: string, startedAt: Date): Promise<void> {
  const runStartedAt = Date.now();
  const current = { id: recapId, status: "PROCESSING", processingStartedAt: startedAt };
  const recap = await prisma.meetingRecap.findFirst({
    where: current,
    include: {
      meeting: {
        include: {
          room: { select: { name: true } },
          organizer: { select: { id: true, name: true } },
          attendees: { select: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!recap) return;
  const { meeting } = recap;
  const attendeeNames = meeting.attendees.map((attendee) => attendee.user.name);
  const managerIds = [meeting.organizerId, recap.createdById];
  const personNames = [meeting.organizer.name, ...attendeeNames];
  const hintWords = transcriptionHintWords(meeting.title, personNames);

  try {
    let transcript = recap.transcript ?? "";

    if (recap.audioPathname && !recap.transcript) {
      await prisma.meetingRecap.updateMany({ where: current, data: { stage: "TRANSCRIBING" } });
      const audioUrl = await signedAudioUrl(recap.audioPathname);
      const firstStartedAt = Date.now();
      const result = await transcribeAudioUrl({
        audioUrl,
        prompt: buildTranscriptionPrompt(meeting.title, personNames),
      });
      const firstPassMs = Date.now() - firstStartedAt;
      const billedSeconds = Math.max(1, Math.ceil(result.duration));
      // Thay số phút ước tính bằng số phút Groq thật sự tính tiền.
      await prisma.meetingRecapRun.updateMany({
        where: { meetingId: meeting.id, kind: "TRANSCRIBE", createdAt: { gte: startedAt } },
        data: { audioSeconds: billedSeconds },
      });
      const primary = cleanTranscriptSegments(result.segments);
      const recovered = await retranscribeBadParts({
        audioUrl,
        meetingId: meeting.id,
        userId: recap.createdById,
        primary,
        hintWords,
        billedSeconds,
        // Lần hai mất khoảng bằng lần đầu; vẫn phải chừa thời gian cho phần viết biên bản.
        hasTime: Date.now() - runStartedAt + firstPassMs + SUMMARY_RESERVE_MS <= RUN_BUDGET_MS,
      });
      transcript = formatTranscript(mergeRecoveredSegments(primary, hintWords, recovered));
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
    } else if (transcript) {
      // Viết lại từ bản chép lời cũ: đổi các dòng chép lại gợi ý / rơi dấu thành "(không nghe rõ)".
      const cleaned = cleanStoredTranscript(transcript, hintWords);
      if (cleaned !== transcript) {
        transcript = cleaned;
        await prisma.meetingRecap.updateMany({ where: current, data: { transcript } });
      }
    }

    if (!transcript.trim()) {
      throw new RecapServiceError("Không nghe được lời nói nào trong file ghi âm. Kiểm tra lại file rồi tải lên lần nữa.");
    }

    // Không đủ thời gian thì dừng trước khi tính lượt; bản chép lời đã lưu để viết lại ở lượt mới.
    const timeLeft = RUN_BUDGET_MS - (Date.now() - runStartedAt);
    if (timeLeft < MIN_SUMMARY_TIMEOUT_MS) {
      throw new RecapServiceError("Chép lời mất nhiều thời gian nên chưa kịp viết biên bản. Bấm Thử viết lại.");
    }
    // Hạn mức cả công ty: kiểm tra và ghi nhận ngay trước khi gọi Gemini.
    const limited = summaryLimitReason(recapLimits(), await loadRecapUsage(meeting.id), { perMeeting: false });
    if (limited) throw new RecapServiceError(limited);
    await prisma.meetingRecapRun.create({
      data: { meetingId: meeting.id, userId: recap.createdById, kind: "SUMMARIZE" },
    });

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
      limitTranscriptForSummary(transcript)
    );
    // Chép lời lâu thì phần viết biên bản chỉ còn thời gian còn lại; không kịp thì báo lỗi
    // (bản chép lời đã lưu) để người tổ chức bấm "Thử viết lại" ở một lượt mới.
    const summary = await summarizeTranscript({
      ...prompt,
      timeoutMs: Math.min(RECAP_SUMMARY_TIMEOUT_MS, RUN_BUDGET_MS - (Date.now() - runStartedAt)),
    });
    const people = [meeting.organizer, ...meeting.attendees.map((attendee) => attendee.user)];
    const actionRows = recapActionItemRows(summary.actionItems, people, meeting.startAt);
    // Biên bản và danh sách việc cần làm thay cùng lúc; lần chạy cũ (đã bị thay) không ghi gì.
    const done = await prisma.$transaction(async (tx) => {
      const saved = await tx.meetingRecap.updateMany({
        where: current,
        data: { status: "READY", stage: null, error: null, content: renderRecapContent(summary) },
      });
      if (saved.count === 0) return false;
      await tx.meetingRecapActionItem.deleteMany({ where: { recapId } });
      if (actionRows.length) {
        await tx.meetingRecapActionItem.createMany({ data: actionRows.map((row) => ({ ...row, recapId })) });
      }
      return true;
    });
    if (!done) return;

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
  // Nhật ký lượt dùng chỉ cần cho hạn mức ngày và đối chiếu chi phí gần đây.
  await prisma.meetingRecapRun.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
  });
  return { stuck: stuck.length, cleaned };
}

/**
 * Họp thuộc dự án: lưu (hoặc thay) biên bản dạng Word vào tài liệu dự án.
 * Trả về true nếu đã lưu; lỗi lưu không làm hỏng việc gửi biên bản.
 */
export async function saveRecapToProject(
  meetingId: string,
  uploader: { id: string; role: string },
  sentAt: Date
): Promise<boolean> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      room: { select: { name: true } },
      organizer: { select: { name: true } },
      attendees: { select: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      recap: {
        select: { id: true, content: true, projectFileId: true, actionItems: { select: recapActionExportSelect, orderBy: recapActionOrder } },
      },
    },
  });
  if (!meeting?.projectId || !meeting.recap?.content?.trim()) return false;

  // Người gửi phải vẫn là thành viên dự án (hoặc admin) mới được ghi vào tài liệu dự án.
  if (uploader.role !== "ADMIN") {
    const member = await prisma.projectMember.findFirst({
      where: { projectId: meeting.projectId, userId: uploader.id },
      select: { id: true },
    });
    if (!member) return false;
  }

  try {
    const data = buildRecapDocx({
      title: meeting.title,
      when: formatMeetingWhen(meeting.startAt, meeting.endAt),
      room: meeting.room?.name ?? null,
      organizer: meeting.organizer.name,
      attendees: meeting.attendees.map((attendee) => attendee.user.name),
      content: recapExportContent(meeting.recap.content, meeting.recap.actionItems.map(toRecapActionExport)),
      sentAt,
    });
    const file = {
      name: recapDocxFileName(meeting.title, meeting.startAt),
      mimeType: DOCX_MIME_TYPE,
      size: data.length,
      data,
    };
    // Gửi lại: thay file cũ (nếu vẫn còn trong đúng dự án) thay vì tạo bản trùng.
    const existing = meeting.recap.projectFileId
      ? await prisma.projectFile.findFirst({
          where: { id: meeting.recap.projectFileId, projectId: meeting.projectId },
          select: { id: true },
        })
      : null;
    const saved = existing
      ? await prisma.projectFile.update({ where: { id: existing.id }, data: file, select: { id: true } })
      : await prisma.projectFile.create({
          data: { ...file, projectId: meeting.projectId, uploaderId: uploader.id },
          select: { id: true },
        });
    await prisma.meetingRecap.update({ where: { id: meeting.recap.id }, data: { projectFileId: saved.id } });
    return true;
  } catch (error) {
    console.error("Could not save the meeting recap to project documents", error);
    return false;
  }
}
