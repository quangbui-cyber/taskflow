"use client";

import { Alert, Badge } from "@/components/ui/Presentation";

export default function AdvanceSettlementAllocator({ kind }: { kind: "VENDOR_PAYMENT" | "REIMBURSEMENT" }) {
  return <section className="space-y-3 rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] p-4" aria-label="Trạng thái đối soát sau AC">
    <div className="flex items-center gap-2"><h3 className="font-semibold">{kind === "REIMBURSEMENT" ? "Phân bổ nguồn tạm ứng" : "Thanh toán chi phí thực tế"}</h3><Badge tone="warning">Chưa khả dụng</Badge></div>
    <Alert tone="warning" title="Approved AC producer unavailable until Phase 8." />
    <p className="text-sm text-[var(--text-secondary)]">Phase 7 đã khóa contract chọn nguồn theo Project/người nhận và không FIFO. Form chỉ mở khi Phase 8 cung cấp phiên bản AC, approval event và dòng AC đã duyệt có thẩm quyền; hóa đơn hoặc bằng chứng chi riêng lẻ không thay thế điều kiện này.</p>
  </section>;
}
