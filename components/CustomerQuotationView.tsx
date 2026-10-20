import type { CustomerQuotation } from "@/lib/costflow/quotationProjection";
import { displayMoney } from "@/lib/costflow/money";

export default function CustomerQuotationView({ quotation, project }: { quotation: CustomerQuotation; project: string }) {
  return (
    <section className="tf-customer-quotation" data-customer-quotation>
      <h1 className="text-center text-2xl font-bold mb-5">BÁO GIÁ</h1>
      <h2 className="font-semibold">{quotation.title || "Chưa đặt tên báo giá"}</h2>
      <p>Dự án: {project}</p>
      <p>Khách hàng: {quotation.customer || "Chưa chọn khách hàng"}</p>
      {quotation.incomplete && (
        <div className="tf-customer-preview-warning" role="status">
          <strong>Bản xem trước nháp — chưa đủ điều kiện chốt.</strong>
          <span>{quotation.issues.length} nội dung cần hoàn tất trong màn hình làm việc.</span>
        </div>
      )}
      <div className="overflow-x-auto mt-4 border border-[var(--border)] rounded-xl">
        <table className="w-full border-collapse text-sm tf-customer-hierarchy-table">
          <caption className="sr-only">Hạng mục báo giá khách · VND</caption>
          <thead>
            <tr>
              {["STT", "Hạng mục", "ĐVT", "SL", "Số ngày", "Đơn giá (VND)", "VAT", "Trước VAT", "Sau VAT", "Ghi chú"].map(label => (
                <th key={label} scope="col" className="border p-2">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quotation.rows.map(row =>
              row.role === "GROUP" ? (
                <tr key={row.id} className="tf-customer-group-row">
                  <th colSpan={10} scope="rowgroup">
                    <span className="tf-customer-outline-number">{row.numberLabel}</span>
                    <span className="tf-customer-group-name">{row.name || "Chưa nhập tên nhóm"}</span>
                    <span className="tf-customer-group-count">{row.childCount} hạng mục</span>
                    {row.showSubtotal && <strong>{row.amount ? displayMoney(row.amount.net) : "Chưa đủ dữ liệu"}</strong>}
                  </th>
                </tr>
              ) : (
                <tr key={row.id} className={row.role === "DETAIL" ? "tf-customer-detail-row" : "tf-customer-item-row"}>
                  <th scope="row" className="border p-2 text-center text-xs font-mono">{row.numberLabel}</th>
                  <td className="border p-2">
                    <span className="tf-customer-item-name">{row.name || "Chưa nhập tên"}</span>
                    {row.description && row.description !== row.name && (
                      <p className="whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{row.description}</p>
                    )}
                  </td>
                  <td className="border p-2 text-center text-xs">{row.unit || "—"}</td>
                  <td className="border p-2 text-center font-mono tabular-nums text-xs">{row.quantity || "—"}</td>
                  <td className="border p-2 text-center font-mono tabular-nums text-xs">{row.days || "—"}</td>
                  <td className="border p-2 text-right font-mono tabular-nums text-xs">
                    {row.unitPrice ? `${row.unitPrice} (${row.basis === "NET" ? "chưa VAT" : "gồm VAT"})` : "—"}
                  </td>
                  <td className="border p-2 text-center text-xs">{row.vat || "—"}</td>
                  <td className="border p-2 text-right font-mono tabular-nums text-xs font-semibold">
                    {row.amount ? displayMoney(row.amount.net) : "—"}
                  </td>
                  <td className="border p-2 text-right font-mono tabular-nums text-xs font-semibold">
                    {row.amount ? displayMoney(row.amount.gross) : "—"}
                  </td>
                  <td className="border p-2 text-xs">{row.notes || "—"}</td>
                </tr>
              )
            )}
          </tbody>
          <tfoot>
            {quotation.totalLayout?.map(layout => {
              const custom = quotation.totalLines?.find(line => line.id === layout.id);
              const system = layout.id.startsWith("SYSTEM_");
              const before = layout.id === "SYSTEM_NET" ? quotation.amount.net : layout.id === "SYSTEM_VAT" ? quotation.amount.vat : custom?.amount?.net;
              const after = layout.id === "SYSTEM_GROSS" ? quotation.amount.gross : custom?.amount?.gross;
              const unavailable = system ? quotation.amountIncomplete : !custom?.amount;
              return (
                <tr key={layout.id}>
                  <th colSpan={7} scope="row" className="border p-2 text-right font-semibold">
                    {layout.label}
                  </th>
                  <td className="border p-2 text-right font-mono tabular-nums text-xs">
                    {unavailable || before === undefined ? "—" : displayMoney(before)}
                  </td>
                  <td className="border p-2 text-right font-mono tabular-nums text-xs font-bold">
                    {unavailable || after === undefined ? "—" : displayMoney(after)}
                  </td>
                  <td />
                </tr>
              );
            })}
          </tfoot>
        </table>
      </div>
      <p className="mt-4 text-sm">
        Tổng VAT: <strong>{quotation.amountIncomplete ? "Chưa đủ dữ liệu" : displayMoney(quotation.amount.vat)}</strong>
      </p>
      {quotation.notes && <p className="whitespace-pre-wrap text-sm">{quotation.notes}</p>}
      {quotation.number && (
        <p className="mt-6 text-xs text-[var(--text-secondary)]">
          Phiên bản BG-{quotation.number} · Mã {quotation.id} · VND. Tổng tính từ số gốc rồi làm tròn.
        </p>
      )}
    </section>
  );
}
