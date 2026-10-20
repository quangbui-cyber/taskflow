import { Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import { groupIcLinesByVendor } from "@/lib/costflow/icVendorView";
import type { IcLine } from "@/lib/costflow/types";

type Props = {
  revisionNumber: number;
  lines: IcLine[];
  vendors: { id: string; name: string }[];
};

export default function InternalCostVendorView({ revisionNumber, lines, vendors }: Props) {
  const groups = groupIcLinesByVendor(lines, vendors);
  if (!groups.length) return <EmptyState title="IC chưa có hạng mục" description="Chưa có chi phí để tổng hợp theo NCC." />;

  return <div className="space-y-4">
    <div>
      <h3 className="text-lg font-semibold">Chi phí IC-R{revisionNumber} theo NCC</h3>
      <p className="text-sm text-[var(--text-secondary)]">Số tiền dưới đây là dự toán IC của revision đang xem, không phải tiền đã chi.</p>
    </div>
    {groups.map(group => (
      <Panel key={group.vendorId ?? "unassigned"} className="space-y-3">
        <details>
          <summary className="cursor-pointer space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold">{group.name}</h4>
                  <Badge tone={group.vendorId ? "neutral" : "warning"}>{group.lines.length} hạng mục</Badge>
                  {group.missingCostCount > 0 && <Badge tone="warning">{group.missingCostCount} dòng chưa đủ giá</Badge>}
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Mua: {group.lines.slice(0, 3).map(line => line.description || "Chưa đặt tên").join(" · ")}
                  {group.lines.length > 3 && ` · +${group.lines.length - 3} hạng mục`}
                </p>
              </div>
              <div className="text-right tabular-nums">
                <span className="block text-xs text-[var(--text-secondary)]">{group.missingCostCount ? "Tạm tính Gross" : "Tổng dự toán Gross"} · xem hạng mục</span>
                <strong className="text-base">{displayMoney(group.amount.gross)}</strong>
              </div>
            </div>
          </summary>
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
              <span>Net: <strong>{displayMoney(group.amount.net)}</strong></span>
              <span>VAT: <strong>{displayMoney(group.amount.vat)}</strong></span>
              <span>Gross: <strong>{displayMoney(group.amount.gross)}</strong></span>
            </div>
            {group.missingCostCount > 0 && <p className="text-xs text-[var(--text-secondary)]">Tổng đang tạm tính từ các dòng đủ giá.</p>}
            <Table caption={`Hạng mục mua từ ${group.name} trong IC-R${revisionNumber}`}>
              <thead><tr>
                <th scope="col">Hạng mục mua</th>
                <th scope="col">Khối lượng</th>
                <th scope="col" className="text-right">Đơn giá mua</th>
                <th scope="col" className="text-right">Net</th>
                <th scope="col" className="text-right">Gross</th>
              </tr></thead>
              <tbody>{group.lines.map(line => <tr key={line.id}>
                <th scope="row">{line.description}</th>
                <td>{line.quantity || "—"} {line.unit}</td>
                <td className="text-right tabular-nums">{line.unitPrice ? displayMoney(line.unitPrice) : "—"}</td>
                <td className="text-right tabular-nums">{line.cost ? displayMoney(line.cost.net) : "—"}</td>
                <td className="text-right tabular-nums">{line.cost ? displayMoney(line.cost.gross) : "Chưa đủ giá"}</td>
              </tr>)}</tbody>
            </Table>
          </div>
        </details>
      </Panel>
    ))}
  </div>;
}
