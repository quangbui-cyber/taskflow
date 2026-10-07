"use client";
import { useState } from "react";
import { Select } from "@/components/ui/Field";
import { Alert, Table } from "@/components/ui/Presentation";
import { readableIcRevisionDiff } from "@/lib/costflow/budgetRevisions";
import type { IcRevision } from "@/lib/costflow/types";
import type { Finance } from "@/components/CostFlowPanel";
import ActionForm from "@/components/CostFlowActionForm";
import { quotationUpdates, quotationLineAncestors } from "@/lib/costflow/budgetQuotation";

export function IcQuotationUpdates({ finance, revision, editable }: { finance: Finance; revision: IcRevision; editable: boolean }) {
  const updates = quotationUpdates(revision, finance.data.quotations ?? []);
  return <>{updates.map(quote => <section key={quote.id} className="mt-4"><Alert tone="warning" title={`BG-${quote.number} mới hơn nguồn IC hiện tại`}>IC không tự thay đổi. Mở phần đối chiếu để chọn từng hạng mục cần cập nhật; giá vốn và VAT mua vẫn được giữ.</Alert><details className="mt-3"><summary>Xem {quote.lines.length} hạng mục thay đổi từ BG-{quote.number}</summary><p>IC vẫn giữ bản nguồn cũ cho tới khi bạn xác nhận. Dòng mới cần nhập giá vốn/VAT riêng.</p>{editable ? <ActionForm finance={finance} requestId={revision.requestId} command="APPLY_QUOTATION_LINES" label="Cập nhật hạng mục đã chọn"><input type="hidden" name="quotationId" value={quote.id} /><Table caption={`Xem thay đổi từ BG-${quote.number}`}><thead><tr><th scope="col">Chọn</th><th scope="col">Nội dung mới</th><th scope="col">Số lượng / đơn vị trong IC</th><th scope="col">Nguồn mới</th><th scope="col">Trường được cập nhật</th></tr></thead><tbody>{quote.lines.map(row => {
    const ancestors = quotationLineAncestors(finance.data.quotations ?? [], quote.id, row.id);
    const old = revision.lines.find(l => ancestors.some(ref => ref.quotationId === l.quotationId && ref.lineId === l.quotationLineId));
    return <tr key={row.id}><td><label><input type="checkbox" name="quotationLineIds" value={row.id} />{old ? "Cập nhật" : "Thêm dòng mới"}</label></td><td>{row.description}</td><td>{old ? `${old.quantity} ${old.unit}` : "Chưa có"}</td><td>{row.quantity} {row.unit}</td><td><label><input type="checkbox" name="updateQuantityIds" value={row.id} />Cập nhật số lượng</label><label><input type="checkbox" name="updateUnitIds" value={row.id} />Cập nhật đơn vị</label></td></tr>;
  })}</tbody></Table></ActionForm> : <Alert title="Bản đã gửi giữ nguyên">Rút revision đang chờ duyệt tại tab Trình duyệt trước khi cập nhật nguồn.</Alert>}</details></section>)}</>;
}

export default function IcRevisionDiff({ revision, revisions }: { revision: IcRevision; revisions: IcRevision[] }) {
  const [baselineId, setBaselineId] = useState(revisions.find(r => r.effective)?.id ?? "");
  const baseline = revisions.find(r => r.id === baselineId);
  const effective = revisions.find(r => r.effective);
  const diff = readableIcRevisionDiff(revision, baseline);
  const historical = !!baseline && baseline.id !== effective?.id;
  return <details className="mt-4"><summary>So sánh revision IC</summary><Select label="So sánh với" value={baselineId} onChange={e => setBaselineId(e.target.value)}><option value="">Chưa có baseline hiệu lực để đối chiếu</option>{revisions.filter(r => r.id !== revision.id).map(r => <option key={r.id} value={r.id}>IC-R{r.number}{r.effective ? " · Baseline hiệu lực" : " · Lịch sử"}</option>)}</Select><Alert tone={diff.material ? "warning" : "info"} title={!baseline ? "Chưa có baseline hiệu lực để đối chiếu" : diff.material ? "Có thay đổi nghiệp vụ — cần trình lại từ Quản lý" : "Dự toán không đổi"}>{historical ? "Đây là so sánh lịch sử, không phải baseline ngân sách đang hiệu lực. " : ""}Thêm {diff.added.length} · Bỏ {diff.removed.length} · Sửa {diff.changed.length}{diff.sourceChanged ? " · Đổi nguồn PO / Brief / minh chứng" : ""}</Alert>{baseline && <Table caption={`Chi tiết thay đổi giữa IC-R${baseline.number} và IC-R${revision.number}`}><thead><tr><th scope="col">Nhóm</th><th scope="col">Dòng</th><th scope="col">Trường nghiệp vụ</th><th scope="col">IC-R{baseline.number}</th><th scope="col">IC-R{revision.number}</th></tr></thead><tbody>{diff.rows.length ? diff.rows.map((row,index) => <tr key={`${row.group}:${row.lineId}:${row.fieldLabel}:${index}`}><td>{row.group === "added" ? "Thêm" : row.group === "removed" ? "Bỏ" : "Sửa"}</td><td>{row.lineLabel}</td><td>{row.fieldLabel}</td><td>{row.oldValue}</td><td>{row.newValue}</td></tr>) : <tr><td colSpan={5}>Không có thay đổi nghiệp vụ.</td></tr>}</tbody></Table>}</details>;
}
