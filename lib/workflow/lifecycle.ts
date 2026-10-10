import type { DocumentPayload } from "./documents";
import type { ProjectUpload } from "@/lib/projectFiles";

const MAX_PHYSICAL_FILES = 10;
const MAX_PHYSICAL_TOTAL_BYTES = 20 * 1024 * 1024;

function hasMagic(upload: ProjectUpload) {
  const bytes = Buffer.from(upload.data);
  if (upload.mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (upload.mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (upload.mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

export function validatePhysicalScanBatch(uploads: readonly ProjectUpload[]) {
  if (!uploads.length) throw new Error("Cần tải ít nhất một bản scan PDF/JPG/PNG.");
  if (uploads.length > MAX_PHYSICAL_FILES) throw new Error("Mỗi batch tối đa 10 file scan.");
  const total = uploads.reduce((sum, upload) => sum + upload.size, 0);
  if (total > MAX_PHYSICAL_TOTAL_BYTES) throw new Error("Tổng dung lượng batch scan không được vượt 20 MiB.");
  for (const upload of uploads) {
    if (upload.size > 4 * 1024 * 1024) throw new Error("Mỗi file scan không được vượt 4 MiB.");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(upload.mimeType) || !hasMagic(upload)) throw new Error("Bản scan phải là PDF/JPG/PNG đúng định dạng nội dung.");
  }
  return { totalBytes: total, fileCount: uploads.length };
}

export function normalizeArchiveText(value: unknown, label: string) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 180);
  if (!normalized) throw new Error(`Thiếu ${label}.`);
  return normalized;
}

export function assertWorkflowLifecycleAllows(
  request: { state: string; payload: unknown },
  action: "SIGN" | "START" | "REQUEST_CANCEL",
) {
  const body = request.payload as DocumentPayload;
  if (request.state === "CANCELLED") throw new Error("Hồ sơ đã hủy.");
  if (body.cancellation?.status === "PENDING") throw new Error("Hồ sơ đang chờ Quản lý quyết định yêu cầu hủy.");
  if (action === "REQUEST_CANCEL" && body.signature) throw new Error("Hồ sơ đã có bằng chứng bản ký; liên hệ Quản lý để xử lý ngoại lệ.");
  if (action === "REQUEST_CANCEL" && body.execution?.startedAt) throw new Error("Hồ sơ đã bắt đầu thực hiện; liên hệ Quản lý để xử lý ngoại lệ.");
  if (action === "START" && request.state !== "APPROVED") throw new Error("Chỉ bắt đầu thực hiện hồ sơ đang được duyệt hiệu lực.");
}
