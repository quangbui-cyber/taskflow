/**
 * Phần thuần của chức năng ghi âm trong app (không đụng trình duyệt), để test được.
 */

/** Cứ mỗi 5 giây, trình duyệt giao một đoạn ghi và app lưu ngay xuống máy. */
export const RECORDING_CHUNK_MS = 5000;
/** 48 kbps mono: giọng nói rõ hơn, khoảng 22 MB mỗi giờ (3 giờ 45 phút ≈ 81 MB, dưới mức 100 MB của Groq). */
export const RECORDING_BITS_PER_SECOND = 48_000;

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

// ---------- Chọn micro ----------

export type MicOption = { deviceId: string; label: string };

/** Micro ảo của phần mềm họp/ghi màn hình: thường không có giọng mình, đừng tự chọn. */
const VIRTUAL_MIC = /zoom|teams|blackhole|loopback|soundflower|virtual|\bobs\b|\bndi\b|aggregate|ecamm|camo/i;

export function isVirtualMic(label: string): boolean {
  return VIRTUAL_MIC.test(label);
}

/** Danh sách micro để chọn. Trước khi cho phép micro, trình duyệt giấu tên nên đặt tên tạm "Micro 1, 2…". */
export function micOptions(
  devices: readonly { kind: string; deviceId: string; label: string }[]
): MicOption[] {
  return devices
    .filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "communications")
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label.trim() || `Micro ${index + 1}` }));
}

/**
 * Micro sẽ dùng: micro đã chọn lần trước nếu còn cắm; nếu không thì micro mặc định,
 * trừ khi micro mặc định là micro ảo (Zoom, Teams, BlackHole…) thì lấy micro thật đầu tiên.
 * Trả về "" nghĩa là để trình duyệt dùng micro mặc định.
 */
export function preferredMicId(options: readonly MicOption[], savedId: string | null): string {
  if (savedId && options.some((option) => option.deviceId === savedId)) return savedId;
  const fallback = options.find((option) => option.deviceId === "default") ?? options[0];
  if (!fallback || !isVirtualMic(fallback.label)) return "";
  const real = options.find((option) => option.deviceId !== "default" && !isVirtualMic(option.label));
  return real?.deviceId ?? "";
}

/** Họp online kết thúc (tab họp đóng) thì tự tạo biên bản — trừ bản ghi quá ngắn, thường là bấm nhầm. */
export const AUTO_SUBMIT_MIN_MS = 30_000;

export function shouldAutoSubmitRecording(durationMs: number): boolean {
  return durationMs >= AUTO_SUBMIT_MIN_MS;
}

// ---------- Tự dừng khi người ghi quên bấm "Dừng ghi" (họp trực tiếp và online) ----------

/** Quá giờ kết thúc theo lịch bao lâu thì tự dừng. */
export const OVERTIME_GRACE_MS = 10 * 60 * 1000;
/** Không nghe tiếng nói bao lâu thì tự dừng, và bao lâu thì bắt đầu cảnh báo. */
export const SILENCE_STOP_MS = 10 * 60 * 1000;
export const SILENCE_WARN_MS = 7 * 60 * 1000;
/** Bấm "Vẫn đang họp" lúc đã quá giờ thì lùi giờ tự dừng thêm bấy nhiêu. */
export const OVERTIME_EXTEND_MS = 30 * 60 * 1000;
/** Ngưỡng âm lượng (RMS) coi là có tiếng nói; phòng yên tĩnh sau khi lọc ồn thường dưới mức này. */
export const SPEECH_RMS_THRESHOLD = 0.012;

export type AutoStopReason = "overtime" | "silence";

export type AutoStopState = {
  /** Lý do cần dừng ngay; null nếu chưa. */
  stop: AutoStopReason | null;
  /** Đã quá giờ kết thúc: còn bao lâu nữa thì tự dừng (để hiện đếm ngược). */
  overtimeLeftMs: number | null;
  /** Im lặng đủ lâu để cảnh báo: còn bao lâu nữa thì tự dừng. */
  silenceLeftMs: number | null;
};

export function autoStopState({
  nowMs,
  endsAtMs,
  lastSoundAtMs,
  paused,
}: {
  nowMs: number;
  /** Giờ kết thúc theo lịch (đã cộng phần "Vẫn đang họp" nếu có). */
  endsAtMs: number | null;
  lastSoundAtMs: number;
  paused: boolean;
}): AutoStopState {
  let overtimeLeftMs: number | null = null;
  if (endsAtMs !== null && nowMs >= endsAtMs) {
    overtimeLeftMs = Math.max(0, endsAtMs + OVERTIME_GRACE_MS - nowMs);
    if (overtimeLeftMs === 0) return { stop: "overtime", overtimeLeftMs: 0, silenceLeftMs: null };
  }

  let silenceLeftMs: number | null = null;
  if (!paused) {
    const silentFor = nowMs - lastSoundAtMs;
    if (silentFor >= SILENCE_STOP_MS) return { stop: "silence", overtimeLeftMs, silenceLeftMs: 0 };
    if (silentFor >= SILENCE_WARN_MS) silenceLeftMs = SILENCE_STOP_MS - silentFor;
  }
  return { stop: null, overtimeLeftMs, silenceLeftMs };
}

/** Tự dừng vì im lặng: giữ thêm bấy nhiêu sau lần cuối có tiếng nói rồi bỏ phần im lặng phía sau. */
export const SILENCE_TRIM_KEEP_MS = 30 * 1000;

/**
 * Cắt bản ghi khi tự dừng vì im lặng. `chunkEndsMs[i]` là thời lượng đã ghi lúc nhận đoạn thứ i
 * (trình duyệt có thể gom đoạn dài hơn 5 giây, nhất là khi tab bị ẩn, nên phải dùng mốc thật).
 * Giữ các đoạn tới đoạn đầu tiên phủ được mốc `keepUntilMs`, luôn giữ đoạn đầu (chứa phần đầu file).
 * Trả về số đoạn giữ lại và thời lượng thật của phần giữ lại.
 */
export function trimChunks(
  chunkEndsMs: readonly number[],
  keepUntilMs: number
): { keep: number; durationMs: number } {
  if (chunkEndsMs.length === 0) return { keep: 0, durationMs: 0 };
  let keep = chunkEndsMs.findIndex((end) => end >= keepUntilMs) + 1;
  if (keep === 0) keep = chunkEndsMs.length;
  keep = Math.max(1, keep);
  return { keep, durationMs: chunkEndsMs[keep - 1] };
}

export function autoStopMessage(reason: AutoStopReason): string {
  return reason === "overtime"
    ? "Đã quá giờ kết thúc cuộc họp 10 phút nên app tự dừng ghi và đang tạo biên bản…"
    : "Không nghe thấy tiếng nói trong 10 phút nên app tự dừng ghi, bỏ đoạn im lặng ở cuối và đang tạo biên bản…";
}

/** Độ lớn âm thanh (RMS) của một khung mẫu, từ -1..1. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * Mốc "giờ kết thúc" dùng cho việc tự dừng khi bắt đầu ghi. Bắt đầu ghi lúc đã quá giờ
 * (họp kéo dài) thì tính lại từ lúc bắt đầu, cộng thêm 30 phút — không dừng ngay lập tức.
 */
export function initialAutoStopEndsAt(endsAtMs: number | null, nowMs: number): number | null {
  if (endsAtMs === null || !Number.isFinite(endsAtMs)) return null;
  return nowMs >= endsAtMs ? nowMs + OVERTIME_EXTEND_MS : endsAtMs;
}
