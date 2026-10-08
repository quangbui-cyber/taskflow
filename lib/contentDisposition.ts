/**
 * Header Content-Disposition cho file tải về.
 *
 * Giá trị header HTTP chỉ được chứa ký tự Latin-1; tên file tiếng Việt (nhất là
 * tên từ macOS, lưu dấu ở dạng tổ hợp) làm `new Response` ném lỗi và trả về 500.
 * Vì vậy `filename=` chỉ dùng ASCII, còn tên đầy đủ nằm ở `filename*=` (RFC 5987).
 */
export function attachmentDisposition(fileName: string) {
  const name = fileName.normalize("NFC");
  const asciiName =
    name
      // Bỏ dấu tiếng Việt để tên dự phòng vẫn đọc được: "BÁO GIÁ" → "BAO GIA"
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/[^\x20-\x7e]|["\\]/g, "_")
      .trim() || "download";
  const encodedName = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
