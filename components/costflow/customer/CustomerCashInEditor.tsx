"use client";

import ActionForm from "@/components/CostFlowActionForm";
import { Input } from "@/components/ui/Field";
import type { Finance } from "@/components/CostFlowPanel";

export default function CustomerCashInEditor({ finance }: { finance: Finance }) {
  return <ActionForm finance={finance} command="ADD_CUSTOMER_CASH_IN" label="Ghi nhận tiền khách hàng">
    <div className="grid gap-3 sm:grid-cols-2">
      <Input name="milestone" label="Mốc thu tiền" placeholder="Cọc, Đợt 2, Thanh lý…" maxLength={120} required />
      <Input name="occurredAt" label="Ngày nhận tiền" type="date" required />
      <Input name="amount" label="Số tiền đã thu (VND)" inputMode="numeric" pattern="[0-9]+" required />
      <Input name="reference" label="Mã tham chiếu" maxLength={160} required />
      <Input name="proof" label="Chứng từ thu tiền" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="sm:col-span-2" />
    </div>
    <input type="hidden" name="idempotencyKey" value={`${finance.project.id}:${finance.version}:CUSTOMER_CASH_IN`} />
    <p className="tf-ui-help">Khoản thu khách hàng chỉ cập nhật AR; không tạo cash OUT, hồ sơ chi hoặc quyền thanh toán.</p>
  </ActionForm>;
}
