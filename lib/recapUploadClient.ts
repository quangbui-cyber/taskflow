import { upload } from "@vercel/blob/client";
import { RECAP_MAX_AUDIO_BYTES, recapAudioContentType, recapAudioPathname } from "@/lib/meetingRecap";

/**
 * Luồng tải ghi âm lên để tạo biên bản, dùng chung cho file chọn từ máy và bản ghi trong app:
 * hỏi server còn hạn mức không → tải thẳng lên Vercel Blob → báo server bắt đầu xử lý.
 */

const MULTIPART_FROM_BYTES = 20 * 1024 * 1024;

export const formatLimit = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} giờ` : `${minutes} phút`;

/** Đọc độ dài file ghi âm ngay trên trình duyệt; null nếu không đọc được. */
export function readAudioDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const finish = (value: number | null) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

/** Câu báo lỗi dễ hiểu (thư viện Blob hay trả câu tiếng Anh chung chung). */
export function friendlyUploadError(error: unknown): string {
  const raw = error instanceof Error && error.message ? error.message : "";
  if (!raw) return "Không tải được file lên.";
  if (/client token/i.test(raw)) return "Chưa tải được file lên lúc này. Tải lại trang rồi thử lại.";
  if (raw.length > 260) return "Không tải được file lên. Kiểm tra mạng rồi thử lại.";
  return raw;
}

export async function uploadRecapAudio({
  meetingId,
  file,
  durationSeconds,
  maxAudioMinutes,
  onProgress,
}: {
  meetingId: string;
  file: File;
  /** Độ dài đã biết (bản ghi trong app); null thì đọc từ file. */
  durationSeconds: number | null;
  maxAudioMinutes: number;
  onProgress: (percentage: number) => void;
}): Promise<void> {
  const pathname = recapAudioPathname(meetingId, file.name);
  const contentType = recapAudioContentType(file.name);
  if (!pathname || !contentType) {
    throw new Error("Định dạng chưa hỗ trợ. Dùng mp3, m4a, wav, webm, ogg, flac hoặc mp4.");
  }
  if (file.size > RECAP_MAX_AUDIO_BYTES) throw new Error("File ghi âm vượt quá 100 MB.");

  // Chặn file quá dài trước khi tải lên (server kiểm tra lại lần nữa).
  const seconds = durationSeconds ?? (await readAudioDuration(file));
  if (seconds && seconds > maxAudioMinutes * 60) {
    throw new Error(
      `File ghi âm dài khoảng ${Math.ceil(seconds / 60)} phút, vượt giới hạn ${formatLimit(maxAudioMinutes)} mỗi file. Hãy cắt bớt rồi tải lại.`
    );
  }

  const check = await fetch(`/api/meetings/${meetingId}/recap/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ durationSeconds: seconds, size: file.size }),
  });
  if (!check.ok) {
    const data = (await check.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Chưa tải được file lên lúc này. Tải lại trang rồi thử lại.");
  }

  const blob = await upload(pathname, file, {
    access: "private",
    handleUploadUrl: `/api/meetings/${meetingId}/recap/upload`,
    clientPayload: JSON.stringify({ durationSeconds: seconds, size: file.size }),
    contentType,
    multipart: file.size > MULTIPART_FROM_BYTES,
    onUploadProgress: ({ percentage }) => onProgress(Math.round(percentage)),
  });

  const res = await fetch(`/api/meetings/${meetingId}/recap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathname: blob.pathname, fileName: file.name, durationSeconds: seconds }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Không bắt đầu xử lý được. Thử lại.");
}
