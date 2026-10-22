/** Phần thuần của thông báo "cuộc họp đã bắt đầu" (test được, không đụng server). */

/** Cron chạy mỗi phút; cửa sổ 10 phút để vẫn báo kịp nếu một lần chạy bị trễ. */
export const MEETING_START_PROMPT_WINDOW_MS = 10 * 60 * 1000;

export function meetingStartPromptKey(meetingId: string) {
  return `meeting-start:${meetingId}`;
}

export function meetingStartPromptMessage(title: string) {
  return `Cuộc họp “${title}” đã bắt đầu. Bấm để ghi âm và tạo biên bản.`;
}
