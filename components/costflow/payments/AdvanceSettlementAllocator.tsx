"use client";

import { Alert, Badge } from "@/components/ui/Presentation";

export default function AdvanceSettlementAllocator({ kind }: { kind: "VENDOR_PAYMENT" | "REIMBURSEMENT" }) {
  return <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4" aria-label="Trạng thái đối soát sau AC">
    <div className="flex items-center gap-2"><h3 className="font-semibold">{kind === "REIMBURSEMENT" ? "Phân bổ nguồn tạm ứng" : "Thanh toán chi phí thực tế"}</h3><Badge tone="success">AC đã duyệt</Badge></div>
    <Alert tone="info" title="Chọn nguồn AC và tạm ứng theo đúng Project/người nhận" />
    <p className="text-sm text-[var(--text-secondary)]">Mỗi dòng dùng phiên bản AC và quyết định DD đã lưu. Account chọn rõ nguồn tạm ứng; hệ thống không FIFO. Tạo hồ sơ không tạo cash và không tự đóng tài chính.</p>
    <dl className="grid gap-2 text-xs sm:grid-cols-2">
      <div><dt className="font-semibold">Nghĩa vụ sau AC</dt><dd>Hoàn IN hoặc chi thêm OUT đúng phần chênh lệch</dd></div>
      <div><dt className="font-semibold">Authority tách biệt</dt><dd>DD duyệt AC; duyệt hồ sơ và cash vẫn là các trục riêng</dd></div>
    </dl>
  </section>;
}
