"use client";

import Link from "next/link";
import type { PaymentLedgerRow } from "@/lib/costflow/paymentReadModel";
import { displayMoney } from "@/lib/costflow/money";
import { Badge, EmptyState, Table } from "@/components/ui/Presentation";

const PROGRESS = { CHUA_CHI: "Chưa chi", DANG_CHI_MOT_PHAN: "Đang chi một phần", DA_CHI_DU: "Đã chi đủ", UNKNOWN: "Cần kiểm tra" } as const;

const APPROVAL_STATE_LABELS: Record<string, string> = {
  DRAFT: "Nháp",
  SUBMITTED: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  RETURNED: "Đã trả lại",
  REJECTED: "Từ chối",
};

const BENEFICIARY_VERIFICATION_LABELS: Record<string, string> = {
  VERIFIED: "Đã xác minh đúng phiên bản",
  UNVERIFIED: "Cần xác minh phiên bản",
  NOT_APPLICABLE: "Không áp dụng (Nội bộ)",
  UNKNOWN: "Chưa rõ",
};

const FINANCIAL_CLOSE_LABELS: Record<string, string> = {
  OPEN: "Đang mở",
  CLOSED: "Đã đóng",
};

const AC_SOURCE_STATUS_LABELS: Record<string, string> = {
  UNAVAILABLE: "Chưa khả dụng (Chờ AC Phase 8)",
};

function money(value: string | null) {
  return value === null ? "Chưa khả dụng" : displayMoney(value);
}

function EvidenceLinks({ projectId, row }: { projectId: string; row: PaymentLedgerRow }) {
  return row.evidenceLinks.length ? <ul className="space-y-1">{row.evidenceLinks.map(link => <li key={link.id} className="flex flex-wrap gap-2">
    <Link className="tf-link" href={`/api/projects/${projectId}/costflow/evidence/${link.id}`}>{link.label}</Link>
    <Link className="tf-link" href={`/api/projects/${projectId}/costflow/evidence/${link.id}/preview`} target="_blank" rel="noreferrer">Xem trước</Link>
  </li>)}</ul> : <span className="text-xs text-[var(--text-secondary)]">Chưa có link được phép</span>;
}

function StateFacts({ row }: { row: PaymentLedgerRow }) {
  return <><p>Duyệt: {APPROVAL_STATE_LABELS[row.approvalState] ?? row.approvalState}</p><p>Tiền: {PROGRESS[row.cashProgress] ?? row.cashProgress}</p><p>Xác minh NCC: {BENEFICIARY_VERIFICATION_LABELS[row.beneficiaryVerification] ?? row.beneficiaryVerification}</p><p>Đóng tài chính: {FINANCIAL_CLOSE_LABELS[row.financialCloseState] ?? row.financialCloseState}</p></>;
}

export default function PaymentLedgerTable({ projectId, rows }: { projectId: string; rows: PaymentLedgerRow[] }) {
  if (!rows.length) return <EmptyState title="Chưa có dữ liệu sổ thanh toán" description="Sổ sẽ hiển thị sau khi có hồ sơ thanh toán hoặc dữ liệu legacy được nhận diện." />;
  return <><div className="tf-payment-ledger-table"><Table caption="Sổ đối soát hồ sơ, người nhận và luồng tiền">
    <thead><tr>
      <th scope="col">Hồ sơ / người nhận</th>
      <th scope="col">Trạng thái độc lập</th>
      <th scope="col" className="text-right">Đề nghị</th>
      <th scope="col" className="text-right">Tạm ứng đã chi</th>
      <th scope="col" className="text-right">Còn lại</th>
      <th scope="col" className="text-right">Sau AC</th>
      <th scope="col">Chứng từ</th>
    </tr></thead>
    <tbody>{rows.map(row => <tr key={`${row.projectId}:${row.requestId}:${row.recipientKey}`}>
      <td><strong>{row.title}</strong><p className="text-xs text-[var(--text-secondary)]">{row.recipientLabel} · {row.milestone || "Không có mốc chung"}</p>{row.needsReview && <Badge tone="warning">Legacy · cần kiểm tra nguồn</Badge>}</td>
      <td><StateFacts row={row} /></td>
      <td className="text-right tabular-nums">{money(row.approvedAmount)}</td>
      <td className="text-right tabular-nums">{money(row.grossStandardOut)}</td>
      <td className="text-right tabular-nums">{money(row.remainingStandardOut)}</td>
      <td className="text-right"><p>Hoàn IN: {money(row.refundInBalance)}</p><p>Chi thêm OUT: {money(row.additionalOutBalance)}</p><p className="text-xs text-[var(--text-secondary)]">Nguồn AC: {AC_SOURCE_STATUS_LABELS[row.approvedAcSourceStatus] ?? row.approvedAcSourceStatus}</p></td>
      <td><EvidenceLinks projectId={projectId} row={row} /></td>
    </tr>)}</tbody>
  </Table></div><ol className="tf-payment-ledger-cards space-y-3" aria-label="Sổ đối soát hồ sơ, người nhận và luồng tiền">
    {rows.map(row => <li key={`${row.projectId}:${row.requestId}:${row.recipientKey}:card`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-3">
      <div><strong>{row.title}</strong><p className="text-xs text-[var(--text-secondary)]">{row.recipientLabel} · {row.milestone || "Không có mốc chung"}</p>{row.needsReview && <Badge tone="warning">Legacy · cần kiểm tra nguồn</Badge>}</div>
      <div className="rounded-lg bg-[var(--surface-soft)] p-2 text-xs"><StateFacts row={row} /></div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-[var(--text-secondary)]">Đề nghị</dt><dd className="font-semibold tabular-nums">{money(row.approvedAmount)}</dd></div>
        <div><dt className="text-[var(--text-secondary)]">Gross tạm ứng OUT</dt><dd className="font-semibold tabular-nums">{money(row.grossStandardOut)}</dd></div>
        <div><dt className="text-[var(--text-secondary)]">Còn lại</dt><dd className="font-semibold tabular-nums">{money(row.remainingStandardOut)}</dd></div>
        <div><dt className="text-[var(--text-secondary)]">Hoàn IN</dt><dd className="font-semibold tabular-nums">{money(row.refundInBalance)}</dd></div>
        <div><dt className="text-[var(--text-secondary)]">Chi thêm OUT</dt><dd className="font-semibold tabular-nums">{money(row.additionalOutBalance)}</dd></div>
        <div><dt className="text-[var(--text-secondary)]">Nguồn AC</dt><dd className="font-semibold">{AC_SOURCE_STATUS_LABELS[row.approvedAcSourceStatus] ?? row.approvedAcSourceStatus}</dd></div>
      </dl>
      <div className="text-xs"><p className="mb-1 font-semibold">Chứng từ giao dịch</p><EvidenceLinks projectId={projectId} row={row} /></div>
    </li>)}
  </ol></>;
}
