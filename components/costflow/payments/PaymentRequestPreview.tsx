"use client";

import { displayMoney } from "@/lib/costflow/money";
import { Alert, Badge, Table } from "@/components/ui/Presentation";

export type PaymentPreviewLine = {
  stableKey: string;
  description: string;
  amount: string;
  sourceLabel: string;
  recipientKey: string;
  recipientLabel: string;
};

function total(lines: PaymentPreviewLine[]) {
  return lines.reduce((sum, line) => /^\d+$/.test(line.amount) ? sum + BigInt(line.amount) : sum, BigInt(0)).toString();
}
export function PaymentRequestPreview({ title, milestone, explanation, revisionLabel, lines, serverProjection = false }:
  { title?: string; milestone: string; explanation?: string; revisionLabel?: string; lines: PaymentPreviewLine[]; serverProjection?: boolean }) {
  const recipientTotals = new Map<string, bigint>();
  for (const line of lines) {
    if (!/^\d+$/.test(line.amount)) continue;
    recipientTotals.set(line.recipientKey, (recipientTotals.get(line.recipientKey) ?? BigInt(0)) + BigInt(line.amount));
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="font-semibold text-[var(--foreground)]">{title?.trim() || "Hồ sơ chưa có tên"}</p>
        <p className="tf-ui-help">{revisionLabel || "Chưa xác định revision IC"} · Một mốc chung: {milestone.trim() || "Chưa nhập"}</p>
      </div>
      <Badge tone={serverProjection ? "success" : "info"}>{serverProjection ? "Dữ liệu đã lưu trên server" : "Bản xem trước sẽ được server tính lại"}</Badge>
    </div>
    {!lines.length ? <Alert title="Chưa có khoản đề nghị">Thêm ít nhất một khoản để gửi duyệt.</Alert> : <><div className="tf-payment-preview-table"><Table caption="Các khoản trong đề nghị tạm ứng">
      <thead><tr><th scope="col">Khoản</th><th scope="col">Người nhận</th><th scope="col">IC nguồn</th><th scope="col" className="text-right">Số tiền</th></tr></thead>
      <tbody>{lines.map(line => <tr key={line.stableKey}>
        <td>{line.description || "Chưa nhập nội dung"}</td>
        <td>{line.recipientLabel || line.recipientKey || "Chưa chọn"}</td>
        <td>{line.sourceLabel || "Chưa chọn"}</td>
        <td className="text-right tabular-nums">{/^\d+$/.test(line.amount) ? displayMoney(line.amount) : "Chưa hợp lệ"}</td>
      </tr>)}</tbody>
      <tfoot><tr><th colSpan={3} scope="row">Tổng đề nghị</th><th className="text-right tabular-nums">{displayMoney(total(lines))}</th></tr></tfoot>
    </Table></div><ol className="tf-payment-preview-cards space-y-2" aria-label="Các khoản trong đề nghị tạm ứng">
      {lines.map((line, index) => <li key={line.stableKey} className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3">
        <div className="flex items-start justify-between gap-2"><strong>Khoản {index + 1}</strong><strong className="tabular-nums">{/^\d+$/.test(line.amount) ? displayMoney(line.amount) : "Chưa hợp lệ"}</strong></div>
        <p className="mt-1">{line.description || "Chưa nhập nội dung"}</p>
        <dl className="mt-2 grid gap-1 text-xs text-[var(--text-secondary)]"><div><dt className="inline font-semibold">Người nhận: </dt><dd className="inline">{line.recipientLabel || line.recipientKey || "Chưa chọn"}</dd></div><div><dt className="inline font-semibold">IC nguồn: </dt><dd className="inline">{line.sourceLabel || "Chưa chọn"}</dd></div></dl>
      </li>)}
      <li className="flex justify-between rounded-lg border border-[var(--border)] p-3 font-bold"><span>Tổng đề nghị</span><span>{displayMoney(total(lines))}</span></li>
    </ol></>}
    {!!recipientTotals.size && <div className="flex flex-wrap gap-2" aria-label="Tổng theo người nhận">
      {[...recipientTotals].map(([key, amount]) => <Badge key={key} tone="neutral">{lines.find(line => line.recipientKey === key)?.recipientLabel ?? key}: {displayMoney(amount.toString())}</Badge>)}
    </div>}
    <Alert tone="info" title="Giải trình và tài liệu trong snapshot">
      <p>{explanation?.trim() || "Chưa có giải trình chung."}</p>
      <p className="mt-1">Tài liệu được ghi theo manifest bất biến khi server nhận hồ sơ; tài liệu riêng lẻ không phải bằng chứng AC đã duyệt.</p>
    </Alert>
  </div>;
}
