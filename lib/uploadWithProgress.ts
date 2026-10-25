/**
 * Gửi FormData lên máy chủ, báo % đã tải lên và tự dừng khi quá thời gian chờ
 * (fetch() không báo được tiến độ tải lên nên dùng XMLHttpRequest).
 */
export async function postFormWithProgress<T>(
  url: string,
  body: FormData,
  {
    onProgress,
    onUploaded,
    timeoutMs,
  }: {
    /** 0–100, phần trăm dữ liệu đã gửi đi. */
    onProgress?: (percentage: number) => void;
    /** Gửi xong, đang chờ máy chủ xử lý. */
    onUploaded?: () => void;
    timeoutMs: number;
  },
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = timeoutMs;
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.upload.onload = () => {
      onProgress?.(100);
      onUploaded?.();
    };
    xhr.onload = () => {
      let data = {} as T & { error?: string };
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        // Máy chủ trả trang lỗi (vd quá thời gian) thay vì JSON.
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
    };
    xhr.ontimeout = () =>
      reject(
        new Error(
          `Quá ${Math.round(timeoutMs / 1000)} giây chưa xong. Mạng có thể đang chậm — thử lại, hoặc bỏ bớt ảnh/sheet không cần trong file.`,
        ),
      );
    xhr.onerror = () => reject(new Error("Mất kết nối khi gửi file. Kiểm tra mạng rồi thử lại."));
    xhr.send(body);
  });
}

/** "3,3 MB", "104 KB" */
export function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
