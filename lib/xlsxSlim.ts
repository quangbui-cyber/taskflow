import JSZip from "jszip";

/**
 * Làm gọn file .xlsx ngay trên trình duyệt trước khi gửi lên: thay mọi ảnh dán trong file
 * (ảnh chụp chuyển khoản, hoá đơn…) bằng một ảnh trắng 1×1 cùng định dạng. Sheet, ô, công thức
 * và mọi tham chiếu giữ nguyên, nên app đọc bảng IC y như file gốc và Excel vẫn mở được file,
 * chỉ là nhẹ đi nhiều (file thật 3,3 MB còn khoảng 0,1 MB).
 */
export type SlimResult = { file: File; originalSize: number; slimSize: number; removedImages: number };

// Ảnh trắng 1×1 hợp lệ cho từng định dạng (để Excel không báo file hỏng).
const PLACEHOLDER_BASE64: Record<string, string> = {
  png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  gif: "R0lGODdhAQABAIEAAP///wAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==",
  jpeg: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0CiiigD//2Q==",
};
const EXTENSION_FORMAT: Record<string, keyof typeof PLACEHOLDER_BASE64> = {
  png: "png",
  gif: "gif",
  jpg: "jpeg",
  jpeg: "jpeg",
};
// Ảnh nhỏ hơn mức này để nguyên: thay cũng không nhẹ đi đáng kể.
const MIN_IMAGE_BYTES = 2 * 1024;

export async function slimXlsx(file: File): Promise<SlimResult> {
  const unchanged = { file, originalSize: file.size, slimSize: file.size, removedImages: 0 };
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  let removedImages = 0;
  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    const match = /^xl\/media\/[^/]+\.([a-z0-9]+)$/i.exec(path);
    const format = match ? EXTENSION_FORMAT[match[1].toLowerCase()] : undefined;
    if (entry.dir || !format) continue;
    const bytes = await entry.async("uint8array");
    if (bytes.length < MIN_IMAGE_BYTES) continue;
    zip.file(path, PLACEHOLDER_BASE64[format], { base64: true });
    removedImages += 1;
  }
  if (removedImages === 0) return unchanged;

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // Hiếm khi file gọn lại to hơn (nén khác): khi đó gửi file gốc.
  if (blob.size >= file.size) return unchanged;
  const slim = new File([blob], file.name, { type: blob.type, lastModified: file.lastModified });
  return { file: slim, originalSize: file.size, slimSize: slim.size, removedImages };
}
