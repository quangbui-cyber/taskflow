import Link from "next/link";
import { Alert, Badge, EmptyState, Table } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import type { PaymentLedgerRow } from "@/lib/costflow/paymentReadModel";

export type SettlementEvidenceView = {
  id: string;
  evidenceId: string;
  kind: string;
  sha256: string;
  addedById: string;
  createdAt: string | Date;
};

export type SettlementObligationView = {
  id: string;
  recipientKey: string;
  recipientType: string;
  direction: string;
  approvedAcGross: string;
  disbursedAdvance: string;
  amountDue: string;
};

export type SettlementVersionView = {
  id: string;
  version: number;
  canonicalHash: string;
  supersedesId: string | null;
  replacementReason: string | null;
  createdAt: string | Date;
  request: { id: string; state: string; version: number; currentStep: number; currentAttemptId: string | null };
  obligations: SettlementObligationView[];
  evidence: SettlementEvidenceView[];
  locks: Array<{ id: string; lockedAt: string | Date }>;
};

const DIAGNOSTICS = {
  MISSING_RELATED_IC_AC: "Thiếu liên kết IC/AC",
  MISSING_EXPENSE_EVIDENCE: "Thiếu hóa đơn/chứng từ chi phí",
  MISSING_DISBURSEMENT_PROOF: "Thiếu bằng chứng tiền đã chi",
} as const;

function hasEvidence(version: SettlementVersionView, code: keyof typeof DIAGNOSTICS) {
  const marker = code.replace("MISSING_", "");
  return version.evidence.some(item => item.kind.includes(marker));
}

function directionLabel(row: SettlementObligationView) {
  if (row.direction === "REFUND") return { label: "ĐNHTU", tone: "info" as const };
  if (row.direction === "ADDITIONAL") return { label: row.disbursedAdvance === "0" ? "ĐNTT" : "ĐNHTU", tone: "warning" as const };
  return { label: "Đã khớp 100%", tone: "success" as const };
}

function RecipientFacts({ row, payment }: { row: SettlementObligationView; payment?: PaymentLedgerRow }) {
  const paid = payment?.cashProgress === "DA_CHI_DU" ? row.amountDue : payment?.cashProgress === "DANG_CHI_MOT_PHAN"
    ? (BigInt(row.amountDue) - BigInt(payment.additionalOutBalance ?? payment.refundInBalance ?? row.amountDue)).toString()
    : "0";
  const remaining = payment?.additionalOutBalance ?? payment?.refundInBalance ?? row.amountDue;
  return <dl className="grid grid-cols-2 gap-2 text-xs">
    <div><dt className="text-[var(--text-secondary)]">AC thực tế</dt><dd className="font-mono tabular-nums">{displayMoney(row.approvedAcGross)}</dd></div>
    <div><dt className="text-[var(--text-secondary)]">Đã tạm ứng</dt><dd className="font-mono tabular-nums">{displayMoney(row.disbursedAdvance)}</dd></div>
    <div><dt className="text-[var(--text-secondary)]">Đã chi lũy kế</dt><dd className="font-mono tabular-nums">{displayMoney(paid)}</dd></div>
    <div><dt className="text-[var(--text-secondary)]">Còn phải thực hiện</dt><dd className="font-mono font-semibold tabular-nums">{displayMoney(remaining)}</dd></div>
  </dl>;
}

export default function ProjectSettlementTable({ projectId, version, warnings, paymentRows, recipientName }: {
  projectId: string;
  version: SettlementVersionView;
  warnings: Array<{ stableLineId: string; description: string }>;
  paymentRows: PaymentLedgerRow[];
  recipientName: (key: string) => string;
}) {
  const diagnostics = (Object.keys(DIAGNOSTICS) as Array<keyof typeof DIAGNOSTICS>).filter(code => !hasEvidence(version, code));
  return <div className="space-y-4">
    {warnings.length > 0 && <Alert tone="danger" title={`AC chưa được DD duyệt (${warnings.length})`}>
      <ul className="list-disc pl-5">{warnings.map(item => <li key={item.stableLineId}>{item.description} · {item.stableLineId}</li>)}</ul>
    </Alert>}
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <p className="font-semibold">Bộ chứng từ cố định khi trình</p>
      <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
        {(Object.keys(DIAGNOSTICS) as Array<keyof typeof DIAGNOSTICS>).map(code => <li key={code} className="flex items-center gap-2">
          <Badge tone={diagnostics.includes(code) ? "danger" : "success"}>{diagnostics.includes(code) ? "Thiếu" : "Đủ"}</Badge>{DIAGNOSTICS[code]}
        </li>)}
      </ul>
    </div>
    {version.obligations.length === 0 ? <EmptyState title="Chưa có nghĩa vụ quyết toán" description="Hồ sơ chưa có nguồn AC/tạm ứng đủ điều kiện để đối soát." /> : <>
      <div className="tf-payment-ledger-table"><Table caption="Bảng quyết toán toàn Project theo người nhận và nhà cung cấp">
        <thead><tr><th scope="col">Người nhận / NCC</th><th scope="col">Phiếu</th><th scope="col" className="text-right">AC Gross</th><th scope="col" className="text-right">Tạm ứng</th><th scope="col" className="text-right">Nghĩa vụ</th><th scope="col">Tiền thực tế</th><th scope="col">Nguồn hồ sơ</th></tr></thead>
        <tbody>{version.obligations.map(row => {
          const payment = paymentRows.find(item => item.obligationId === row.id);
          const voucher = directionLabel(row);
          return <tr key={row.id}><th scope="row" className="text-left"><strong>{recipientName(row.recipientKey)}</strong><p className="text-xs text-[var(--text-secondary)]">{row.recipientType === "VENDOR" ? "Nhà cung cấp" : "Nhân viên"}</p></th><td><Badge tone={voucher.tone}>{voucher.label}</Badge></td><td className="text-right font-mono tabular-nums">{displayMoney(row.approvedAcGross)}</td><td className="text-right font-mono tabular-nums">{displayMoney(row.disbursedAdvance)}</td><td className="text-right font-mono font-semibold tabular-nums">{displayMoney(row.amountDue)}</td><td><RecipientFacts row={row} payment={payment} /><Badge tone={payment?.cashProgress === "DA_CHI_DU" ? "success" : "warning"}>{payment?.cashProgress === "DA_CHI_DU" ? "Đã thực hiện đủ" : "Pending Disbursement"}</Badge></td><td><p className="text-xs">Dossier v{version.version}</p><p className="text-xs text-[var(--text-secondary)]">Nguồn hồ sơ: {version.request.id}</p><Link className="tf-link inline-flex min-h-11 items-center" href={`/projects/${projectId}?tab=costflow#request-${version.request.id}`}>Xem audit duyệt</Link></td></tr>;
        })}</tbody>
      </Table></div>
      <ol className="tf-payment-ledger-cards space-y-3" aria-label="Bảng quyết toán toàn Project trên màn hình hẹp">{version.obligations.map(row => {
        const payment = paymentRows.find(item => item.obligationId === row.id);
        const voucher = directionLabel(row);
        return <li key={`${row.id}:card`} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="flex items-start justify-between gap-2"><div><strong>{recipientName(row.recipientKey)}</strong><p className="text-xs text-[var(--text-secondary)]">Nguồn hồ sơ: v{version.version} · {version.request.id}</p></div><Badge tone={voucher.tone}>{voucher.label}</Badge></div>
          <RecipientFacts row={row} payment={payment} />
          <div className="flex flex-wrap items-center justify-between gap-2"><Badge tone={payment?.cashProgress === "DA_CHI_DU" ? "success" : "warning"}>{payment?.cashProgress === "DA_CHI_DU" ? "Đã thực hiện đủ" : "Pending Disbursement"}</Badge><Link className="tf-button-secondary tf-button-size-sm min-h-11" href={`/projects/${projectId}?tab=costflow#request-${version.request.id}`}>Xem audit</Link></div>
        </li>;
      })}</ol>
    </>}
    <p className="text-xs text-[var(--text-secondary)]">Customer Liquidation và AR chỉ phục vụ điều kiện đóng phía khách hàng; không tham gia nghĩa vụ nội bộ trong bảng này.</p>
  </div>;
}
