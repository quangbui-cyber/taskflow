import type { DocumentPayload } from "./documents";

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
