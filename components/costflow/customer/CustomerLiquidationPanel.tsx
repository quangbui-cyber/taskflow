"use client";

import ActionForm from "@/components/CostFlowActionForm";
import CustomerCashInEditor from "./CustomerCashInEditor";
import { Input } from "@/components/ui/Field";
import { Alert, Badge, Panel, Table } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import type { Finance } from "@/components/CostFlowPanel";

const revenueLabels: Record<string, string> = {
  SIGNED_LIQUIDATION_NET: "Thanh lý đã ký · net",
  FINALIZED_QUOTATION_NET: "Báo giá chốt · net fallback",
  CURRENT_PO_NET: "PO hiện hành · net fallback",
  NO_REVENUE_SOURCE: "Chưa có nguồn doanh thu",
};

export default function CustomerLiquidationPanel({ finance, canManage }: { finance: Finance; canManage: boolean }) {
  const accounting = finance.customerAccounting;
  return <section className="space-y-4" aria-labelledby="customer-accounting-heading">
    <div className="tf-section-heading"><div><h2 id="customer-accounting-heading">Thanh lý khách hàng & công nợ phải thu</h2><p>Doanh thu net, tiền khách hàng đã thu và chi phí thực tế là ba nguồn độc lập.</p></div></div>
    <div className="tf-customer-accounting-grid">
      <div className="tf-summary-item"><span className="tf-summary-label">Doanh thu Net thanh lý</span><span className="tf-summary-value">{displayMoney(accounting.margin.revenueNet)}</span><span className="tf-summary-hint">Nguồn: {revenueLabels[accounting.margin.source] ?? accounting.margin.source}</span></div>
      <div className="tf-summary-item"><span className="tf-summary-label">Đã thu từ khách</span><span className="tf-summary-value">{displayMoney(accounting.receivable.collectedGross)}</span><span className="tf-summary-hint">AR cash-in · gross, không phải tiền chi</span></div>
      <div className="tf-summary-item"><span className="tf-summary-label">Khách còn nợ</span><span className="tf-summary-value">{displayMoney(accounting.receivable.outstandingGross)}</span><span className="tf-summary-hint">AR còn phải thu · {accounting.receivable.source}</span></div>
      <div className="tf-summary-item"><span className="tf-summary-label">AC Net phát sinh</span><span className="tf-summary-value">{displayMoney(accounting.margin.incurredNet)}</span><span className="tf-summary-hint">Không phụ thuộc approval hồ sơ hoặc đã chi tiền</span></div>
      <div className="tf-summary-item tf-summary-item-accent"><span className="tf-summary-label">Margin thực tế</span><span className="tf-summary-value">{displayMoney(accounting.margin.netMargin)}</span><span className="tf-summary-hint">Net margin · {accounting.margin.percent === null ? "Không có % khi doanh thu bằng 0" : `${accounting.margin.percent}% · net`}</span></div>
    </div>
    {accounting.margin.legacyCompatibility && <Alert tone="warning" title="Margin còn gồm dòng AC legacy chưa được normalized đầy đủ">Dòng normalized thắng khi cùng stable ID; dữ liệu legacy riêng biệt chỉ được cộng một lần.</Alert>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel><h3 className="mb-3 font-semibold">Biên bản thanh lý đã ký</h3>
        {accounting.currentLiquidation ? <div className="space-y-2 text-sm"><div className="flex flex-wrap items-center gap-2"><Badge tone="success">Phiên bản {accounting.currentLiquidation.version}</Badge><strong>{accounting.currentLiquidation.documentNumber}</strong></div><p>Ngày ký: {new Date(accounting.currentLiquidation.signedAt).toLocaleDateString("vi-VN")}</p><p>Net {displayMoney(accounting.currentLiquidation.netAmount)} · VAT {displayMoney(accounting.currentLiquidation.vatAmount)} · Gross {displayMoney(accounting.currentLiquidation.grossAmount)}</p><a className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${accounting.currentLiquidation.evidence.id}`}>Tải chứng từ gốc · {accounting.currentLiquidation.evidence.name}</a></div> : <p className="text-sm text-[var(--text-secondary)]">Chưa có thanh lý; margin đang dùng fallback được ghi rõ phía trên.</p>}
        {canManage && !finance.data.closed && <div className="mt-4 border-t border-[var(--border)] pt-4"><ActionForm finance={finance} command="SAVE_CUSTOMER_LIQUIDATION" label="Lưu phiên bản thanh lý">
          <div className="grid gap-3 sm:grid-cols-2"><Input name="documentNumber" label="Số biên bản" maxLength={120} required /><Input name="signedAt" label="Ngày ký" type="date" required /><Input name="netAmount" label="Giá trị net (VND)" inputMode="numeric" pattern="[0-9]+" required /><Input name="vatAmount" label="VAT (VND)" inputMode="numeric" pattern="[0-9]+" required /><Input name="grossAmount" label="Tổng gross (VND)" inputMode="numeric" pattern="[0-9]+" required /><Input name="proof" label="Biên bản gốc" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></div>
        </ActionForm></div>}
      </Panel>
      <Panel><h3 className="mb-3 font-semibold">Tiền khách hàng đã thu</h3>{canManage && !finance.data.closed ? <CustomerCashInEditor finance={finance} /> : <Alert tone="info" title="Chế độ chỉ đọc">Bạn không có quyền ghi nhận AR cash-in hoặc tài chính đã đóng. Dữ liệu approval AC, hồ sơ chi và tiền đi ra vẫn nằm ở tab nghiệp vụ riêng.</Alert>}</Panel>
    </div>
    {accounting.liquidations.length > 0 && <Table caption="Lịch sử phiên bản thanh lý khách hàng"><thead><tr><th scope="col">Phiên bản</th><th scope="col">Số biên bản</th><th scope="col">Ngày ký</th><th scope="col">Net</th><th scope="col">Chứng từ</th></tr></thead><tbody>{accounting.liquidations.map(item => <tr key={item.id}><td>{item.version}</td><td>{item.documentNumber}</td><td>{new Date(item.signedAt).toLocaleDateString("vi-VN")}</td><td className="text-right tabular-nums">{displayMoney(item.netAmount)}</td><td><a className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${item.evidence.id}`}>{item.evidence.name}</a></td></tr>)}</tbody></Table>}
    {accounting.cashIns.length > 0 && <Table caption="Các khoản khách hàng đã thanh toán"><thead><tr><th scope="col">Mốc</th><th scope="col">Ngày thu</th><th scope="col">Tham chiếu</th><th scope="col">Số tiền</th><th scope="col">Chứng từ</th></tr></thead><tbody>{accounting.cashIns.map(item => <tr key={item.id}><td>{item.milestone}</td><td>{new Date(item.occurredAt).toLocaleDateString("vi-VN")}</td><td>{item.reference}</td><td className="text-right tabular-nums">{displayMoney(item.amount)}</td><td>{item.evidence ? <a className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${item.evidence.id}`}>{item.evidence.name}</a> : "—"}</td></tr>)}</tbody></Table>}
  </section>;
}
