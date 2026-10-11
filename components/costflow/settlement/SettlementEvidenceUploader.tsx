"use client";

import ActionForm from "@/components/CostFlowActionForm";
import { Input, Select } from "@/components/ui/Field";
import { Badge, EmptyState } from "@/components/ui/Presentation";
import type { Finance } from "@/components/CostFlowPanel";
import type { SettlementEvidenceView, SettlementObligationView } from "./ProjectSettlementTable";

const EVIDENCE_KINDS = [
  ["RELATED_IC_AC", "Liên kết IC/AC"],
  ["EXPENSE_EVIDENCE", "Hóa đơn/chứng từ chi phí"],
  ["DISBURSEMENT_PROOF", "Bằng chứng tiền đã chi"],
] as const;

export default function SettlementEvidenceUploader({ finance, requestId, settlementVersion, obligations, evidence, canEdit, recipientName }: {
  finance: Finance;
  requestId: string;
  settlementVersion: number;
  obligations: SettlementObligationView[];
  evidence: SettlementEvidenceView[];
  canEdit: boolean;
  recipientName: (key: string) => string;
}) {
  return <div className="space-y-4">
    <div>
      <h3 className="font-bold">Kho chứng từ quyết toán</h3>
      <p className="text-xs text-[var(--text-secondary)]">Mỗi file giữ nguồn Kế thừa hoặc Bổ sung, loại yêu cầu và sha256 theo đúng phiên bản hồ sơ.</p>
    </div>
    {evidence.length ? <ul className="space-y-2">{evidence.map(item => {
      const supplemental = item.kind.includes(":");
      return <li key={item.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{item.kind.split(":", 1)[0]}</strong><Badge tone={supplemental ? "info" : "neutral"}>{supplemental ? "Bổ sung" : "Kế thừa"}</Badge></div>
        <p className="mt-1 break-all font-mono text-xs text-[var(--text-secondary)]">sha256 · {item.sha256}</p>
      </li>;
    })}</ul> : <EmptyState title="Chưa có chứng từ liên kết" description="Hồ sơ phải đủ liên kết IC/AC, chứng từ chi phí và bằng chứng tiền đã chi trước khi trình." />}
    {canEdit && <div className="[&_button]:min-h-11"><ActionForm finance={finance} command="ADD_SETTLEMENT_EVIDENCE" requestId={requestId} label="Tải chứng từ bổ sung">
      <input type="hidden" name="settlementVersion" value={settlementVersion} />
      <Select name="recipientKey" label="Người nhận / NCC" required><option value="">Chọn đối tượng</option>{obligations.map(item => <option key={item.id} value={item.recipientKey}>{recipientName(item.recipientKey)}</option>)}</Select>
      <Select name="evidenceKind" label="Loại chứng từ bổ sung" required><option value="">Chọn loại</option>{EVIDENCE_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      <Input className="min-h-11" type="file" name="proof" label="Tệp PDF/XLSX/JPG/PNG" accept=".pdf,.xlsx,.jpg,.jpeg,.png" required />
    </ActionForm></div>}
  </div>;
}
