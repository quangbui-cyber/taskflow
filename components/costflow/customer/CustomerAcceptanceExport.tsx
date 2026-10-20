"use client";

import { useMemo, useState } from "react";
import ActionForm from "@/components/CostFlowActionForm";
import { Select } from "@/components/ui/Field";
import { Alert, Badge, Panel, Table } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import { projectQuotation } from "@/lib/costflow/quotationProjection";
import type { Finance } from "@/components/CostFlowPanel";

export default function CustomerAcceptanceExport({ finance, canManage }: { finance: Finance; canManage: boolean }) {
  const quotations = finance.data.quotations ?? [];
  const latest = quotations.at(-1);
  const [quotationId, setQuotationId] = useState(latest?.id ?? "");
  const quotation = quotations.find(item => item.id === quotationId);
  const customer = useMemo(() => quotation ? projectQuotation(quotation) : null, [quotation]);
  const contractRows = useMemo(() => customer?.rows.filter(row => !row.summary && !!row.unitPrice && !!row.quantity && !!row.days) ?? [], [customer]);
  const [actualByQuotation, setActualByQuotation] = useState<Record<string, Record<string, { quantity: string; days: string }>>>({});
  const actuals = actualByQuotation[quotationId] ?? Object.fromEntries(contractRows.map(row => [row.id, { quantity: row.quantity, days: row.days }]));
  const setActual = (rowId: string, field: "quantity" | "days", value: string) => setActualByQuotation(previous => ({
    ...previous,
    [quotationId]: { ...(previous[quotationId] ?? actuals), [rowId]: { ...(actuals[rowId] ?? { quantity: "", days: "" }), [field]: value } },
  }));
  const eligibleAdditions = (finance.actualCosts?.lines ?? []).filter(line => line.source === "normalized" && line.sourceKind === "UNBUDGETED" && line.reviewState === "approved" && line.billable && !!line.saleSnapshot && !!line.versionId);
  const snapshots = finance.customerAcceptanceSnapshots;
  const latestSnapshot = snapshots[0];
  const actualRows = contractRows.map(row => ({ rowId: row.id, quantity: actuals[row.id]?.quantity ?? "", days: actuals[row.id]?.days ?? "" }));

  return <section className="space-y-4" aria-labelledby="customer-acceptance-heading">
    <div className="tf-section-heading"><div><h2 id="customer-acceptance-heading">Nghiệm thu khách hàng</h2><p>So sánh khối lượng bán theo hợp đồng với thực tế; phát sinh thu thêm chỉ vào bản xuất khi được chọn rõ ràng.</p></div></div>
    {latestSnapshot && <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge tone="success">Snapshot v{latestSnapshot.version}</Badge><strong>{latestSnapshot.projection.document.title}</strong></div><p className="tf-ui-help">BG-{latestSnapshot.projection.document.quotationNumber} · {latestSnapshot.projection.rows.length} dòng · Gross {displayMoney(latestSnapshot.projection.totals.gross)}</p></div><div className="flex flex-wrap gap-2"><a className="tf-button-secondary tf-button-size-sm" href={`/api/projects/${finance.project.id}/costflow/customer-acceptance/pdf?snapshotId=${encodeURIComponent(latestSnapshot.id)}`}>Tải PDF</a><a className="tf-button-secondary tf-button-size-sm" href={`/api/projects/${finance.project.id}/costflow/customer-acceptance/xlsx?snapshotId=${encodeURIComponent(latestSnapshot.id)}`}>Tải Excel</a></div></div>
      <Table caption={`Xem trước snapshot nghiệm thu v${latestSnapshot.version}`} hideCaption><thead><tr><th scope="col">Hạng mục</th><th scope="col">HĐ</th><th scope="col">Thực tế</th><th scope="col">Chênh lệch</th><th scope="col">Thành tiền gross</th></tr></thead><tbody>{latestSnapshot.projection.rows.map(row => <tr key={row.id}><td><strong>{row.numberLabel} · {row.name}</strong><div className="tf-list-meta">{row.kind === "BILLABLE_ADDITION" ? "Phát sinh được chọn" : row.unit}</div></td><td>{row.contractQuantity} × {row.contractDays} ngày</td><td>{row.actualQuantity} × {row.actualDays} ngày</td><td>SL {row.quantityDelta} · ngày {row.daysDelta}</td><td className="text-right tabular-nums">{displayMoney(row.grossAmount)}</td></tr>)}</tbody></Table>
    </Panel>}
    {!canManage || finance.data.closed ? <Alert tone="warning" title="Bạn chỉ có quyền đọc hoặc tài chính đã đóng">Các snapshot đã lưu vẫn có thể tải xuống.</Alert> : quotations.length === 0 ? <Alert tone="warning" title="Chưa có báo giá đã lưu">Chốt một phiên bản báo giá trước khi lập nghiệm thu khách hàng.</Alert> : <Panel>
      <ActionForm finance={finance} command="SAVE_CUSTOMER_ACCEPTANCE" label="Lưu snapshot nghiệm thu">
        <Select name="quotationId" label="Phiên bản báo giá nguồn" value={quotationId} onChange={event => setQuotationId(event.target.value)} required>{quotations.map(item => <option key={item.id} value={item.id}>BG-{item.number} · {item.title} · {item.customer}</option>)}</Select>
        <input type="hidden" name="actualRows" value={JSON.stringify(actualRows)} />
        <Table caption="Khối lượng bán theo hợp đồng và thực tế nghiệm thu" hideCaption><thead><tr><th scope="col">Hạng mục</th><th scope="col">Hợp đồng</th><th scope="col">SL thực tế</th><th scope="col">Ngày thực tế</th><th scope="col">Đơn giá bán</th></tr></thead><tbody>{contractRows.map(row => <tr key={row.id}><td><strong>{row.numberLabel} · {row.name}</strong><div className="tf-list-meta">{row.unit}</div></td><td>{row.quantity} × {row.days} ngày</td><td><input className="tf-field min-w-24" aria-label={`Số lượng thực tế ${row.name}`} inputMode="decimal" value={actuals[row.id]?.quantity ?? ""} onChange={event => setActual(row.id, "quantity", event.target.value)} required /></td><td><input className="tf-field min-w-24" aria-label={`Số ngày thực tế ${row.name}`} inputMode="decimal" value={actuals[row.id]?.days ?? ""} onChange={event => setActual(row.id, "days", event.target.value)} required /></td><td className="text-right tabular-nums">{displayMoney(row.unitPrice)} · {row.basis}</td></tr>)}</tbody></Table>
        <div><h3 className="font-semibold">Phát sinh thu thêm từ khách</h3><p className="tf-ui-help">Mặc định không chọn. Chỉ AC phát sinh ngoài IC, được DD duyệt và có snapshot giá bán mới xuất hiện.</p>{eligibleAdditions.length ? <div className="mt-3 grid gap-2">{eligibleAdditions.map(line => <label key={line.versionId!} className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--border)] p-3"><input type="checkbox" name="selectedActualCostVersionIds" value={line.versionId!} className="mt-1" /><span><strong>{line.description}</strong><span className="block text-xs text-[var(--text-secondary)]">{line.saleSnapshot!.quantity} × {line.saleSnapshot!.days} ngày · đơn giá bán {displayMoney(line.saleSnapshot!.unitPrice)}</span></span></label>)}</div> : <p className="mt-2 text-sm text-[var(--text-secondary)]">Không có dòng phát sinh đủ điều kiện.</p>}</div>
        <Alert title="Bản khách chỉ dùng dữ liệu bán">Số lượng/đơn giá mua, NCC, người nhận, minh chứng, sự kiện DD, ghi chú nội bộ và margin không đi vào snapshot hoặc file xuất.</Alert>
      </ActionForm>
    </Panel>}
    {snapshots.length > 1 && <Table caption="Lịch sử snapshot nghiệm thu khách hàng" hideCaption><thead><tr><th scope="col">Phiên bản</th><th scope="col">Nguồn</th><th scope="col">Tạo lúc</th><th scope="col">Tổng gross</th><th scope="col">Xuất file</th></tr></thead><tbody>{snapshots.map(snapshot => <tr key={snapshot.id}><td>v{snapshot.version}</td><td>BG-{snapshot.projection.document.quotationNumber}</td><td>{new Date(snapshot.createdAt).toLocaleString("vi-VN")}</td><td className="text-right tabular-nums">{displayMoney(snapshot.projection.totals.gross)}</td><td><div className="flex gap-2"><a className="tf-link" href={`/api/projects/${finance.project.id}/costflow/customer-acceptance/pdf?snapshotId=${encodeURIComponent(snapshot.id)}`}>PDF</a><a className="tf-link" href={`/api/projects/${finance.project.id}/costflow/customer-acceptance/xlsx?snapshotId=${encodeURIComponent(snapshot.id)}`}>Excel</a></div></td></tr>)}</tbody></Table>}
  </section>;
}
