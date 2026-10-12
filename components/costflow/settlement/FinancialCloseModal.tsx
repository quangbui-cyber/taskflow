"use client";

import { useState } from "react";
import { LockKeyhole, RotateCcw } from "lucide-react";
import ActionForm from "@/components/CostFlowActionForm";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, Panel } from "@/components/ui/Presentation";

export default function FinancialCloseModal({ finance, blockers, hasDossier, canRequest }: {
  finance: Finance;
  blockers: string[];
  hasDossier: boolean;
  canRequest: boolean;
}) {
  const settlementView = finance as Finance & { settlementCorrection?: {
    id: string;
    baseVersionId: string;
    baseVersionNumber: number;
    baseCanonicalHash: string;
    capabilities: string[];
    obligationIds: string[];
    reason: string;
    stage: string;
    status: string;
    terminalAt: string | null;
    managerDecision: string;
    correctionVersionId: string | null;
    recoveryRemaining: string;
    correctedPaymentState: string;
    approvalState: string;
    signingState: string;
    baseObligations: Array<{ id: string; recipientKey: string; amountDue: string; paidAmount: string }>;
  } | null; settlementDossier?: { versions: Array<{ obligations: Array<{ id: string; recipientKey: string; amountDue: string }> }> } | null };
  const correction = settlementView.settlementCorrection ?? null;
  const [open, setOpen] = useState(false);
  const reopening = finance.data.closed;
  const command = reopening ? "REQUEST_REOPEN_PROJECT" : "REQUEST_CLOSE_PROJECT";
  const activeCorrection = !!correction && !correction.terminalAt;
  const closeBlocked = !reopening && (blockers.length > 0 || activeCorrection);
  const recipientOptions = [
    ...finance.users.map(person => ({ value: `USER:${person.id}`, label: person.name })),
    ...finance.data.beneficiaries.map(beneficiary => ({ value: `VENDOR:${beneficiary.id}`, label: beneficiary.name })),
  ];
  const requestableObligations = correction?.baseObligations ?? settlementView.settlementDossier?.versions[0]?.obligations.map(obligation => ({ ...obligation, paidAmount: "" })) ?? [];
  return <Panel className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2">{reopening ? <RotateCcw size={18} aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}<div><h3 className="font-bold">{reopening ? "Mở lại tài chính" : "Đóng tài chính"}</h3><p className="text-xs text-[var(--text-secondary)]">Yêu cầu và quyết định Quản lý là trục riêng; Task DONE hoặc ký không tự đóng tài chính.</p></div></div>
      <Badge tone={reopening ? "neutral" : closeBlocked ? "warning" : "success"}>{reopening ? "Tài chính đã đóng" : closeBlocked ? `${blockers.length} điều kiện chưa đạt` : "Đủ hai chiều"}</Badge>
    </div>
    {!reopening && closeBlocked && <Alert tone="danger" title="Chưa thể gửi yêu cầu đóng tài chính"><ul className="list-disc pl-5">{blockers.map(item => <li key={item}>{item}</li>)}{activeCorrection && <li>Vòng sửa quyết toán đang ở bước {correction.stage}; phải terminal trước khi đóng.</li>}</ul></Alert>}
    {correction && <div className="space-y-3 rounded-[var(--radius-panel)] border border-[var(--border)] p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>Vòng sửa quyết toán có phạm vi</strong><Badge tone={correction.terminalAt ? "neutral" : "warning"}>{correction.terminalAt ? correction.status : correction.stage}</Badge></div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="text-xs text-[var(--text-secondary)]">Phiên bản / hash nền</dt><dd className="break-all">v{correction.baseVersionNumber} · {correction.baseCanonicalHash}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Quyết định Manager</dt><dd>{correction.managerDecision}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Phạm vi được yêu cầu</dt><dd>{correction.capabilities.join(", ")}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Recovery còn lại</dt><dd>{correction.recoveryRemaining} VND</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Corrected payment</dt><dd>{correction.correctedPaymentState}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Approval mới</dt><dd>{correction.approvalState}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Signing snapshot mới</dt><dd>{correction.signingState}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Các trục không đổi ngầm</dt><dd>Cash · khóa SETTLED · TaskFlow · đóng tài chính</dd></div>
      </dl>
      {correction.stage === "APPROVED" && !correction.correctionVersionId && <ActionForm finance={finance} command="CREATE_REOPENED_SETTLEMENT_VERSION" label="Tạo phiên bản sửa trong phạm vi đã duyệt">
        <Select name="correctionObligationId" label="Nghĩa vụ nguồn cần sửa" required defaultValue="">
          <option value="" disabled>Chọn nghĩa vụ</option>
          {correction.baseObligations.map(obligation => <option key={obligation.id} value={obligation.id}>{obligation.recipientKey} · {obligation.amountDue} VND · đã chi {obligation.paidAmount}</option>)}
        </Select>
        <Select name="correctedRecipientKey" label="Người nhận đúng" defaultValue="">
          <option value="">Giữ người nhận hiện tại</option>
          {recipientOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Input name="correctedAmount" label="Số tiền đúng (VND)" inputMode="numeric" pattern="[0-9]*" hint="Để trống nếu chỉ sửa người nhận." />
      </ActionForm>}
    </div>}
    <Button className="min-h-11" disabled={!canRequest || !hasDossier || closeBlocked} onClick={() => setOpen(true)}>{reopening ? "Gửi yêu cầu mở lại tài chính" : "Gửi yêu cầu đóng tài chính"}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title={reopening ? "Gửi yêu cầu mở lại tài chính" : "Gửi yêu cầu đóng tài chính"} description="Máy chủ sẽ kiểm tra lại Project, actor, phiên bản và mọi điều kiện ngay lúc gửi.">
      {reopening && <Alert tone="warning" title="Chuẩn B02 — lịch sử không bị sửa">
        Mở lại bảo toàn 100% hồ sơ, dòng đã quyết toán, khóa, tiền, file xuất, chữ ký và mã băm cũ. Project luôn dùng một hồ sơ quyết toán ổn định. Nguồn AC mới hoặc sửa dòng cũ chỉ tạo version/attempt mới trong đúng capability được Manager duyệt; dòng đã chi dùng recovery Cash IN trước corrected OUT.
      </Alert>}
      {!reopening && <Alert tone="success" title="Đã thỏa mãn đầy đủ điều kiện đóng tài chính">Cả đối soát nội bộ và doanh thu khách hàng đã đạt điều kiện kỹ thuật tại lần tải trang này.</Alert>}
      <div className="mt-4 [&_button]:min-h-11">
        <ActionForm finance={finance} command={command} label={reopening ? "Xác nhận gửi Quản lý duyệt mở lại" : "Xác nhận gửi Quản lý duyệt đóng"} onSuccess={() => setOpen(false)}>
          <Textarea name="reason" label={reopening ? "Lý do cần mở lại tài chính" : "Lý do / Giải trình đề nghị đóng tài chính"} required />
          {reopening && <fieldset className="space-y-2"><legend className="text-sm font-semibold">Capability xin mở</legend>
            {[
              ["ADD_NEW_AC", "Thêm nguồn AC mới đã được DD duyệt"],
              ["CORRECT_RECIPIENT", "Sửa đúng người nhận"],
              ["CORRECT_AMOUNT", "Sửa đúng số tiền"],
              ["REPLACE_EVIDENCE", "Thay chứng từ của version mới"],
              ["RECOVER_CASH", "Thu hồi tiền đã chi sai trước khi chi lại"],
            ].map(([value, label], index) => <label key={value} className="flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] border border-[var(--border)] px-3"><input type="checkbox" name="correctionCapability" value={value} defaultChecked={index === 0} /> <span>{label}</span></label>)}
          </fieldset>}
          {reopening && requestableObligations.length ? <fieldset className="space-y-2"><legend className="text-sm font-semibold">Dòng cũ xin phép sửa</legend>{requestableObligations.map(obligation => <label key={obligation.id} className="flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] border border-[var(--border)] px-3"><input type="checkbox" name="correctionObligationId" value={obligation.id} /> <span>{obligation.recipientKey} · {obligation.amountDue} VND</span></label>)}</fieldset> : null}
        </ActionForm>
      </div>
    </Dialog>
  </Panel>;
}
