import { MEETING_RECAPS_DISABLED_MESSAGE, meetingRecapsEnabled } from "@/lib/features";
import { recapStartBlockReason } from "@/lib/meetingRecap";
import { findRecapMeeting, loadRecapUsage } from "@/lib/meetingRecapData";
import { estimateAudioSeconds, recapLimits, transcriptionLimitReason } from "@/lib/meetingRecapLimits";

/**
 * Kiểm tra trước khi cho tải file ghi âm: tính năng đang bật, quyền, trạng thái
 * cuộc họp và hạn mức. Trả câu báo lỗi tiếng Việt, hoặc null nếu được phép.
 */
export async function recapUploadBlockReason(
  meetingId: string,
  user: { id: string; role: string } | null,
  audio: { durationSeconds?: unknown; size?: unknown }
): Promise<string | null> {
  if (!meetingRecapsEnabled()) return MEETING_RECAPS_DISABLED_MESSAGE;
  if (!user) return "Phiên đăng nhập đã hết hạn.";
  const meeting = await findRecapMeeting(meetingId);
  const blocked = recapStartBlockReason(meeting, user);
  if (blocked) return blocked;
  const audioSeconds = estimateAudioSeconds(Number(audio.size) || 0, audio.durationSeconds);
  return transcriptionLimitReason(recapLimits(), await loadRecapUsage(meetingId), audioSeconds);
}
