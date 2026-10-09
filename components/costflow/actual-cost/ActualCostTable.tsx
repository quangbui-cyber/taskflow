"use client";

import type { Finance } from "@/components/CostFlowPanel";
import { Badge } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";

type ActualCosts = NonNullable<Finance["actualCosts"]>;

function signedMoney(value: string) {
  if (value === "0") return displayMoney(value);
  return `${value.startsWith("-") ? "" : "+"}${displayMoney(value)}`;
}

function statusLabel(status: ActualCosts["comparisons"][number]["status"]) {
  if (status === "OVER_BUDGET") return "Vượt ngân sách";
  if (status === "SAVING") return "Tiết kiệm";
  return "Đúng ngân sách";
}

export default function ActualCostTable({ actualCosts }: { actualCosts: ActualCosts }) {
  const normalized = actualCosts.lines.filter(line => line.source === "normalized");
  if (!normalized.length) return null;

  return (
    <div className="overflow-x-auto border-t border-[var(--border)] pt-4">
      <table className="min-w-[1120px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
            <th rowSpan={2} className="px-2 py-2">Nội dung / đơn vị</th>
            <th colSpan={4} className="px-2 py-2 text-center">IC hiệu lực</th>
            <th colSpan={4} className="px-2 py-2 text-center">AC thực tế</th>
            <th rowSpan={2} className="px-2 py-2 text-right">Chênh lệch</th>
          </tr>
          <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
            {["SL", "Ngày", "Đơn giá", "Thành tiền", "SL", "Ngày", "Đơn giá", "Thành tiền"].map((label, index) => (
              <th key={`${label}-${index}`} className="px-2 py-2 text-right">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {normalized.map(line => {
            const comparison = actualCosts.comparisons.find(item => item.actualLineIds.includes(line.id));
            const firstOccurrence = comparison?.actualLineIds[0] === line.id;
            return (
              <tr key={line.id} className="border-b border-[var(--border)] align-top">
                <td className="px-2 py-3">
                  <div className="font-medium text-[var(--foreground)]">{line.description}</div>
                  <div className="mt-1 text-[var(--text-secondary)]">{line.unit}</div>
                  {line.sourceKind === "UNBUDGETED" && <Badge tone="warning">[Phát sinh ngoài IC]</Badge>}
                  {line.billable && <div className="mt-1 text-[var(--info)]">Thu thêm từ khách</div>}
                </td>
                <td className="px-2 py-3 text-right">{firstOccurrence ? comparison?.ic?.quantity ?? "—" : "↳"}</td>
                <td className="px-2 py-3 text-right">{firstOccurrence ? comparison?.ic?.days ?? "—" : "↳"}</td>
                <td className="px-2 py-3 text-right">{firstOccurrence && comparison?.ic ? displayMoney(comparison.ic.unitPrice) : firstOccurrence ? "—" : "↳"}</td>
                <td className="px-2 py-3 text-right font-mono">{firstOccurrence && comparison?.ic ? displayMoney(comparison.ic.cost.gross) : firstOccurrence ? "—" : "↳"}</td>
                <td className="px-2 py-3 text-right">{line.quantity}</td>
                <td className="px-2 py-3 text-right">{line.days}</td>
                <td className="px-2 py-3 text-right">{line.unitPrice ? displayMoney(line.unitPrice) : "—"}</td>
                <td className="px-2 py-3 text-right font-mono">{displayMoney(line.amount)}</td>
                <td className={`px-2 py-3 text-right font-medium ${comparison?.status === "OVER_BUDGET" ? "text-[var(--danger)]" : comparison?.status === "SAVING" ? "text-[var(--success)]" : ""}`}>
                  {firstOccurrence && comparison ? <><div>{signedMoney(comparison.variance.gross)}</div><div>{statusLabel(comparison.status)}</div></> : "↳ cùng dòng IC"}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="font-medium">
          <tr><td colSpan={8} className="px-2 pt-3 text-right">Tổng NET</td><td className="px-2 pt-3 text-right font-mono">{displayMoney(actualCosts.summary.actual.net)}</td><td className="px-2 pt-3 text-right font-mono">{signedMoney(actualCosts.summary.variance.net)}</td></tr>
          <tr><td colSpan={8} className="px-2 py-1 text-right">Tổng VAT</td><td className="px-2 py-1 text-right font-mono">{displayMoney(actualCosts.summary.actual.vat)}</td><td className="px-2 py-1 text-right font-mono">{signedMoney(actualCosts.summary.variance.vat)}</td></tr>
          <tr><td colSpan={8} className="px-2 pb-3 text-right">Tổng GROSS</td><td className="px-2 pb-3 text-right font-mono">{displayMoney(actualCosts.summary.actual.gross)}</td><td className="px-2 pb-3 text-right font-mono">{signedMoney(actualCosts.summary.variance.gross)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}
