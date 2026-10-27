/**
 * Hạn mức chống "cháy tiền" cho biên bản họp. Mọi lần gọi AI đều bị đếm theo ngày
 * (giờ Việt Nam) và bị chặn trước khi gọi nếu vượt mức — không có lần chạy nào tự lặp lại.
 *
 * Đổi mức bằng biến môi trường (số nguyên dương), không cần sửa code:
 * - RECAP_MAX_AUDIO_MINUTES:   độ dài tối đa một file ghi âm (mặc định 225 phút = 3 giờ 45, đủ cho họp 2–3 giờ)
 * - RECAP_DAILY_AUDIO_MINUTES: tổng phút chép lời mỗi ngày của cả công ty (mặc định 900 = 15 giờ)
 * - RECAP_DAILY_SUMMARIES:     tổng lượt viết biên bản mỗi ngày của cả công ty (mặc định 60)
 */

export type RecapLimits = {
  maxAudioMinutes: number;
  dailyAudioMinutes: number;
  dailySummaries: number;
  perMeetingTranscriptions: number;
  perMeetingSummaries: number;
};

export type RecapUsage = {
  audioSecondsToday: number;
  summariesToday: number;
  meetingTranscriptionsToday: number;
  meetingSummariesToday: number;
};

/** Mỗi cuộc họp mỗi ngày: chép lời tối đa 3 lần, viết biên bản tối đa 6 lần. */
export const RECAP_PER_MEETING_TRANSCRIPTIONS = 3;
export const RECAP_PER_MEETING_SUMMARIES = 6;
/** Khi trình duyệt không đọc được độ dài file: ước tính theo 128 kbps (mp3/m4a thường gặp). */
const FALLBACK_BYTES_PER_SECOND = 16_000;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function recapLimits(env: NodeJS.ProcessEnv = process.env): RecapLimits {
  return {
    maxAudioMinutes: positiveInt(env.RECAP_MAX_AUDIO_MINUTES, 225),
    dailyAudioMinutes: positiveInt(env.RECAP_DAILY_AUDIO_MINUTES, 900),
    dailySummaries: positiveInt(env.RECAP_DAILY_SUMMARIES, 60),
    perMeetingTranscriptions: RECAP_PER_MEETING_TRANSCRIPTIONS,
    perMeetingSummaries: RECAP_PER_MEETING_SUMMARIES,
  };
}

/** Độ dài dùng để tính hạn mức: số trình duyệt đọc được, hoặc ước tính theo dung lượng. */
export function estimateAudioSeconds(sizeBytes: number, claimedSeconds: unknown): number {
  const claimed = Number(claimedSeconds);
  if (Number.isFinite(claimed) && claimed > 0) return Math.ceil(claimed);
  return Math.max(1, Math.ceil(Math.max(0, sizeBytes) / FALLBACK_BYTES_PER_SECOND));
}

const minutes = (seconds: number) => Math.ceil(seconds / 60);

/** Lý do chặn một lần chép lời mới; null nếu còn hạn mức. */
export function transcriptionLimitReason(
  limits: RecapLimits,
  usage: RecapUsage,
  audioSeconds: number
): string | null {
  if (audioSeconds > limits.maxAudioMinutes * 60) {
    return `File ghi âm dài khoảng ${minutes(audioSeconds)} phút, vượt giới hạn ${limits.maxAudioMinutes} phút mỗi file. Hãy cắt bớt rồi tải lại.`;
  }
  if (usage.meetingTranscriptionsToday >= limits.perMeetingTranscriptions) {
    return `Cuộc họp này đã được chép lời ${limits.perMeetingTranscriptions} lần hôm nay. Thử lại vào ngày mai.`;
  }
  if (usage.audioSecondsToday + audioSeconds > limits.dailyAudioMinutes * 60) {
    const left = Math.max(0, limits.dailyAudioMinutes - minutes(usage.audioSecondsToday));
    return `Hôm nay cả công ty còn ${left} phút chép lời (hạn mức ${limits.dailyAudioMinutes} phút/ngày), không đủ cho file này. Thử lại vào ngày mai hoặc nhờ quản trị viên tăng hạn mức.`;
  }
  return null;
}

/** Lý do chặn một lần viết biên bản mới; `perMeeting` = false cho lượt đi kèm lần tải file. */
export function summaryLimitReason(
  limits: RecapLimits,
  usage: RecapUsage,
  { perMeeting }: { perMeeting: boolean }
): string | null {
  if (perMeeting && usage.meetingSummariesToday >= limits.perMeetingSummaries) {
    return `Biên bản cuộc họp này đã được viết ${limits.perMeetingSummaries} lần hôm nay. Hãy sửa tay hoặc thử lại vào ngày mai.`;
  }
  if (usage.summariesToday >= limits.dailySummaries) {
    return `Hôm nay cả công ty đã dùng hết ${limits.dailySummaries} lượt viết biên bản. Thử lại vào ngày mai hoặc nhờ quản trị viên tăng hạn mức.`;
  }
  return null;
}

/** Chép lại lần hai (cứu đoạn hỏng) chỉ được làm nếu đủ phút chép lời trong ngày; không tính vào số lần của cuộc họp. */
export const RECAP_RETRY_MIN_BAD_SECONDS = 10;

export function retranscribeAllowed(
  limits: RecapLimits,
  usage: RecapUsage,
  { badSeconds, audioSeconds }: { badSeconds: number; audioSeconds: number }
): boolean {
  if (badSeconds < RECAP_RETRY_MIN_BAD_SECONDS) return false;
  return usage.audioSecondsToday + audioSeconds <= limits.dailyAudioMinutes * 60;
}
