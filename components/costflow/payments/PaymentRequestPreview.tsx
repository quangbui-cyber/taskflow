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
export function PaymentRequestPreview({ milestone, lines, serverProjection = false }:
  { milestone: string; lines: PaymentPreviewLine[]; serverProjection?: boolean }) {
  const recipientTotals = new Map<string, bigint>();
  for (const line of lines) {
    if (!/^\d+$/.test(line.amount)) continue;
    recipientTotals.set(line.recipientKey, (recipientTotals.get(line.recipientKey) ?? BigInt(0)) + BigInt(line.amount));
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="font-semibold text-[var(--foreground)]">Xem trước hồ sơ</p>
        <p className="tf-ui-help">{milestone.trim() || "Chưa nhập mốc hồ sơ"}</p>
      </div>
      <Badge tone={serverProjection ? "success" : "info"}>{serverProjection ? "Dữ liệu đã lưu trên server" : "Bản xem trước sẽ được server tính lại"}</Badge>
    </div>
    {!lines.length ? <Alert title="Chưa có khoản đề nghị">Thêm ít nhất một khoản để gửi duyệt.</Alert> : <Table caption="Các khoản trong đề nghị tạm ứng">
      <thead><tr><th>Khoản</th><th>Người nhận</th><th>IC nguồn</th><th className="text-right">Số tiền</th></tr></thead>
      <tbody>{lines.map(line => <tr key={line.stableKey}>
        <td>{line.description || "Chưa nhập nội dung"}</td>
        <td>{line.recipientLabel || line.recipientKey || "Chưa chọn"}</td>
        <td>{line.sourceLabel || "Chưa chọn"}</td>
        <td className="text-right tabular-nums">{/^\d+$/.test(line.amount) ? displayMoney(line.amount) : "Chưa hợp lệ"}</td>
      </tr>)}</tbody>
      <tfoot><tr><th colSpan={3}>Tổng đề nghị</th><th className="text-right tabular-nums">{displayMoney(total(lines))}</th></tr></tfoot>
    </Table>}
    {!!recipientTotals.size && <div className="flex flex-wrap gap-2" aria-label="Tổng theo người nhận">
      {[...recipientTotals].map(([key, amount]) => <Badge key={key} tone="neutral">{lines.find(line => line.recipientKey === key)?.recipientLabel ?? key}: {displayMoney(amount.toString())}</Badge>)}
    </div>}
  </div>;
}
