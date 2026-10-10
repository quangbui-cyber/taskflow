"use client";

import { useId, useMemo, useState } from "react";
import ActionForm from "@/components/CostFlowActionForm";
import type { Finance, Request } from "@/components/CostFlowPanel";
import { Input, Select } from "@/components/ui/Field";
import { Alert, Badge } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";

type Dossier = NonNullable<Finance["paymentDossiers"]>[number];
type Recipient = Dossier["recipients"][number];

const PROGRESS = { CHUA_CHI: "Chưa chi", DANG_CHI_MOT_PHAN: "Đang chi một phần", DA_CHI_DU: "Đã chi đủ" } as const;

export default function CashConfirmationEditor({ finance, request, dossier, recipient, userId, onSuccess }: {
  finance: Finance; request: Request; dossier: Dossier; recipient: Recipient; userId: string; onSuccess?: () => void;
}) {
  const operationId = `${request.id}:${recipient.recipientKey}:v${finance.version}:${useId()}`;
  const eligibleLines = dossier.lines.filter(line => line.recipientKey === recipient.recipientKey);
  const refundDue = BigInt(request.payload.refund ?? "0");
  const direction = request.kind === "REIMBURSEMENT" && refundDue > BigInt(0) ? "IN" : "OUT";
  const paidByLine = useMemo(() => {
    const result = new Map<string, bigint>();
    for (const cash of finance.cash) for (const allocation of cash.normalizedAllocations ?? []) {
      if (cash.requestId === request.id && cash.recipientKey === recipient.recipientKey && cash.direction === direction && allocation.direction === direction) {
        result.set(allocation.requestLineId, (result.get(allocation.requestLineId) ?? BigInt(0)) + BigInt(allocation.amount));
      }
    }
    return result;
  }, [direction, finance.cash, recipient.recipientKey, request.id]);
  const [values, setValues] = useState(() => Object.fromEntries(eligibleLines.map(line => [line.id, (BigInt(line.amount) - (paidByLine.get(line.id) ?? BigInt(0))).toString()])));
  const allocations = eligibleLines.map(line => ({ requestLineId: line.id, amount: values[line.id] ?? "0" })).filter(item => /^\d+$/.test(item.amount) && BigInt(item.amount) > BigInt(0));
  const amount = allocations.reduce((sum, item) => sum + BigInt(item.amount), BigInt(0)).toString();
  const signingEvidenceState = (request as Request & { signingEvidenceState?: string | null }).signingEvidenceState;
  const signingConfirmed = ["DIGITAL_CONFIRMED", "PHYSICAL_CONFIRMED"].includes(signingEvidenceState ?? "");
  const canConfirm = request.state === "APPROVED" && ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(request.kind) && request.cashAssigneeId === userId && signingConfirmed && BigInt(amount) > BigInt(0);

  return <section className="tf-payment-cash-editor space-y-4 rounded-xl border border-[var(--border)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h4 className="font-semibold">{recipient.displayName}</h4><p className="text-xs text-[var(--text-secondary)]">{recipient.bankName ?? "Chưa có ngân hàng"}{recipient.accountLast4 ? ` · •••• ${recipient.accountLast4}` : ""}</p></div>
      <Badge tone={recipient.progress === "DA_CHI_DU" ? "success" : recipient.progress === "DANG_CHI_MOT_PHAN" ? "warning" : "neutral"}>{PROGRESS[recipient.progress]}</Badge>
    </div>
    <p className="text-sm">Đã chi <strong>{displayMoney(recipient.paidOutAmount)}</strong> / {displayMoney(recipient.totalAmount)} · Còn {displayMoney(recipient.remainingAmount)}</p>
    {!canConfirm ? <Alert tone="warning" title={!signingConfirmed ? "Cần đủ 4 chữ ký hoặc xác nhận bản ký giấy trước Cash OUT/IN." : BigInt(amount) === BigInt(0) ? "Nghĩa vụ tiền của người nhận này đã được ghi nhận đủ." : "Chỉ Account/Admin được phân công mới có thể ghi nhận tiền của hồ sơ đã duyệt."} /> : <ActionForm finance={finance} command="CASH" requestId={request.id} label={direction === "IN" ? "Xác nhận Cash IN hoàn trả" : "Xác nhận Cash OUT"} onSuccess={onSuccess}>
      <input type="hidden" name="recipientKey" value={recipient.recipientKey} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="idempotencyKey" value={operationId} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="allocations" value={JSON.stringify(allocations)} />
      <div className="space-y-3">
        {eligibleLines.map(line => {
          const remaining = BigInt(line.amount) - (paidByLine.get(line.id) ?? BigInt(0));
          return <Input key={line.id} label={`${line.description} · còn ${displayMoney(remaining.toString())}`} inputMode="numeric" value={values[line.id] ?? ""} onChange={event => setValues(current => ({ ...current, [line.id]: event.target.value.replace(/\D/g, "") }))} disabled={remaining === BigInt(0)} />;
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select name="channel" label="Hình thức" defaultValue="BANK_TRANSFER" required><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option><option value="OTHER">Khác</option></Select>
        <Input name="reference" label="Mã giao dịch / chứng từ" required />
        <Input name="occurredAt" type="datetime-local" label="Thời điểm giao dịch" required />
        <Input name="proof" type="file" label="Chứng từ bất biến" required accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" />
      </div>
      <p className="text-xs text-[var(--text-secondary)]">{request.kind === "ADVANCE" ? "Gross tạm ứng OUT" : `Giao dịch ${direction}`}: <strong>{displayMoney(amount)}</strong>. Mỗi lần xác nhận áp dụng cho một người nhận. Ký đủ chỉ cấp thẩm quyền; tiền chỉ thay đổi khi form này được xác nhận cùng chứng từ.</p>
      <Alert tone="info" title="Các trục nghiệp vụ vẫn tách biệt">Hoàn IN, chi thêm OUT, net cash, approved actual và đóng tài chính không được suy ra lẫn nhau.</Alert>
    </ActionForm>}
  </section>;
}
