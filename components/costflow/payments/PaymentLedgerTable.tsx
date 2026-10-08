"use client";

import Link from "next/link";
import type { PaymentLedgerRow } from "@/lib/costflow/paymentReadModel";
import { displayMoney } from "@/lib/costflow/money";
import { Badge, EmptyState, Table } from "@/components/ui/Presentation";

const PROGRESS = { CHUA_CHI: "Chưa chi", DANG_CHI_MOT_PHAN: "Đang chi một phần", DA_CHI_DU: "Đã chi đủ", UNKNOWN: "Cần kiểm tra" } as const;

function money(value: string | null) {
  return value === null ? "Chưa khả dụng" : displayMoney(value);
}

export default function PaymentLedgerTable({ projectId, rows }: { projectId: string; rows: PaymentLedgerRow[] }) {
  if (!rows.length) return <EmptyState title="Chưa có dữ liệu sổ thanh toán" description="Sổ sẽ hiển thị sau khi có hồ sơ thanh toán hoặc dữ liệu legacy được nhận diện." />;
  return <Table caption="Sổ đối soát hồ sơ, người nhận và luồng tiền">
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
      <td><strong>{row.title}</strong><p className="text-xs text-[var(--text-secondary)]">{row.recipientLabel} · {row.milestone || "Không có milestone"}</p>{row.needsReview && <Badge tone="warning">Legacy · cần kiểm tra nguồn</Badge>}</td>
      <td><p>Duyệt: {row.approvalState}</p><p>Tiền: {PROGRESS[row.cashProgress]}</p><p>Xác minh NCC: {row.beneficiaryVerification}</p><p>Đóng tài chính: {row.financialCloseState}</p></td>
      <td className="text-right tabular-nums">{money(row.approvedAmount)}</td>
      <td className="text-right tabular-nums">{money(row.grossStandardOut)}</td>
      <td className="text-right tabular-nums">{money(row.remainingStandardOut)}</td>
      <td className="text-right"><p>Hoàn IN: {money(row.refundInBalance)}</p><p>Chi thêm OUT: {money(row.additionalOutBalance)}</p><p className="text-xs text-[var(--text-secondary)]">Nguồn AC: {row.approvedAcSourceStatus}</p></td>
      <td>{row.evidenceLinks.length ? row.evidenceLinks.map(link => <p key={link.id}><Link className="tf-link" href={`/api/projects/${projectId}/costflow/evidence/${link.id}`}>{link.label}</Link></p>) : <span className="text-xs text-[var(--text-secondary)]">Chưa có link được phép</span>}</td>
    </tr>)}</tbody>
  </Table>;
}
