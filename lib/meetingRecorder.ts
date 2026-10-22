/**
 * Phần thuần của chức năng ghi âm trong app (không đụng trình duyệt), để test được.
 */

/** Cứ mỗi 5 giây, trình duyệt giao một đoạn ghi và app lưu ngay xuống máy. */
export const RECORDING_CHUNK_MS = 5000;
/** 32 kbps mono: đủ rõ cho giọng nói, khoảng 14 MB mỗi giờ. */
export const RECORDING_BITS_PER_SECOND = 32_000;

/** Ưu tiên Opus/WebM (Chrome, Edge, Firefox), rồi MP4/AAC (Safari). */
export const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export function pickRecordingMimeType(isTypeSupported: (type: string) => boolean): string | null {
  for (const type of RECORDING_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Một số trình duyệt ném lỗi với chuỗi lạ — bỏ qua và thử loại tiếp theo.
    }
  }
  return null;
}

/** Loại file (bỏ phần codecs) và đuôi file mà Groq/Vercel Blob nhận. */
export function recordingFileType(mimeType: string): { type: string; extension: string } {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4" || base === "video/mp4") return { type: "audio/mp4", extension: ".m4a" };
  if (base === "audio/ogg") return { type: "audio/ogg", extension: ".ogg" };
  return { type: "audio/webm", extension: ".webm" };
}

/** Tên file dễ đọc, ví dụ "ghi-am-2026-10-22-1405.webm" (giờ Việt Nam). */
export function recordingFileName(mimeType: string, startedAt: Date): string {
  const vn = new Date(startedAt.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}-${pad(
    vn.getUTCHours()
  )}${pad(vn.getUTCMinutes())}`;
  return `ghi-am-${stamp}${recordingFileType(mimeType).extension}`;
}

/** Thông báo dễ hiểu khi trình duyệt không cho dùng micro. */
export function microphoneErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Trình duyệt chưa cho dùng micro. Bấm biểu tượng ổ khoá cạnh địa chỉ trang, cho phép Micro rồi thử lại.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Không tìm thấy micro. Kiểm tra tai nghe hoặc micro đã cắm chưa rồi thử lại.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "Micro đang bị ứng dụng khác dùng (Zoom, Meet…). Tắt ứng dụng đó hoặc chọn micro khác rồi thử lại.";
  }
  return "Không bật được micro. Tải lại trang rồi thử lại.";
}

export type RecordingSource = "mic" | "online";

/**
 * Thu âm thanh của một tab (Google Meet, Zoom web…) chỉ ổn định trên Chrome/Edge máy tính.
 * Safari, Firefox và trình duyệt điện thoại không chia sẻ được âm thanh tab.
 */
export function canRecordTabAudio(userAgent: string, hasGetDisplayMedia: boolean): boolean {
  if (!hasGetDisplayMedia) return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return false;
  if (/Firefox\//.test(userAgent)) return false;
  return /Chrome\/|Chromium\/|Edg\//.test(userAgent);
}

export const NO_TAB_AUDIO_MESSAGE =
  "Chưa lấy được âm thanh của tab họp. Bấm Bắt đầu lại, chọn tab cuộc họp và bật “Chia sẻ âm thanh của tab” trước khi bấm Chia sẻ.";

export function displayCaptureErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return "Bạn chưa chọn tab cuộc họp để chia sẻ. Bấm Bắt đầu ghi âm, chọn tab Google Meet/Zoom rồi bấm Chia sẻ.";
  }
  if (name === "NotSupportedError" || name === "TypeError") {
    return "Trình duyệt này không chia sẻ được âm thanh tab. Hãy dùng Chrome hoặc Edge trên máy tính.";
  }
  return "Không chia sẻ được tab cuộc họp. Tải lại trang rồi thử lại.";
}

/** Họp online kết thúc (tab họp đóng) thì tự tạo biên bản — trừ bản ghi quá ngắn, thường là bấm nhầm. */
export const AUTO_SUBMIT_MIN_MS = 30_000;

export function shouldAutoSubmitRecording(durationMs: number): boolean {
  return durationMs >= AUTO_SUBMIT_MIN_MS;
}
