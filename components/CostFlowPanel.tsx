"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CostFlowActionState } from "@/app/actions/costflow";
import ActionForm from "@/components/CostFlowActionForm";
import IcRequestEvidence from "./IcRequestEvidence";
import QuotationPanel from "@/components/QuotationPanel";
import InternalCostPanel from "@/components/InternalCostPanel";
import ApprovalRequestsPanel from "@/components/ApprovalRequestsPanel";
import PaymentCashPanel from "@/components/PaymentCashPanel";
import ActualCostPanel from "@/components/ActualCostPanel";
import SettlementPanel from "@/components/SettlementPanel";
import { workingIcRevision } from "@/lib/costflow/budgetRevisions";
import { icStatusProjection } from "@/lib/costflow/icEffectiveness";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, Panel, Table } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";
import { calculateCost, displayMoney, totals } from "@/lib/costflow/money";
import { completeIcLines } from "@/lib/costflow/budgetDraft";
import { currentPurchaseOrders } from "@/lib/costflow/budgetSources";
import { margin } from "@/lib/costflow/reconciliation";
import { projectQuotation } from "@/lib/costflow/quotationProjection";
import type { CashRow, FinanceData, IcLine, RequestPayload } from "@/lib/costflow/types";
import type { ApprovalStep } from "@/lib/workflow/approval";
import { ArrowRight, Check, CircleDollarSign, FilePlus2, FileText, Layers3, Paperclip, Plus, TrendingUp, Wallet, X } from "lucide-react";
import { MetricCard, ModuleTabs } from "@/components/ui/ModuleUI";

export type Request = { id: string; module: string; parentId: string | null; version: number; creatorId: string; cashAssigneeId: string; kind: string; state: string; title: string; currentStep: number; currentAttemptId: string | null; currentStepArrivedAt: string | null; steps: ApprovalStep[]; payload: RequestPayload; approvalEvents: { id?: string; action: string; attemptId: string | null; submittedVersion: number | null; stepIndex?: number; role?: string; actorId?: string; reason?: string; createdAt?: string | Date }[]; decisions: { id: string; actorId: string; action: string; reason: string; createdAt: string }[]; createdAt?: string | Date };
export type Finance = { project: { id: string; name: string; client?: { id: string; name: string } | null; members: { userId: string }[] }; clients?: { id: string; name: string }[]; fullAccess: boolean; version: number; data: FinanceData; requests: Request[]; cash: CashRow[]; users: { id: string; name: string; role: string }[]; files: { id: string; name: string }[]; evidence: { id: string; name: string; requestId: string | null; kind: string; mimeType?: string; sha256?: string }[]; supplements?: import("@/lib/costflow/types").IcEvidenceSupplement[]; history: { id: string; actorId: string; action: string; version: number; createdAt: string }[] };
const KIND: Record<string, string> = { IC: "IC", AC_REVISION: "Sửa chi phí AC", ADVANCE: "Đề nghị tạm ứng", VENDOR_PAYMENT: "Đề nghị thanh toán NCC", REIMBURSEMENT: "Đề nghị Hoàn Tạm Ứng", CLOSE: "Đóng tài chính", REOPEN: "Mở lại tài chính", CANCEL: "Hủy hồ sơ" };
const STATE: Record<string, string> = { DRAFT: "Nháp", SUBMITTED: "Chờ duyệt", APPROVED: "Đã duyệt", RETURNED: "Đã trả", REJECTED: "Từ chối", WITHDRAWN: "Đã rút", CANCELLED: "Đã hủy" };
const ROLE: Record<string, string> = { MANAGER: "Quản lý", ACCOUNTANT: "Kế toán", CEO: "CEO" };
const ACTION: Record<string, string> = { APPROVE: "Duyệt", RETURN: "Trả hồ sơ", REJECT: "Từ chối", WITHDRAW: "Rút hồ sơ", CONFIGURE: "Phân công", ADD_PO: "Thêm PO", ADD_BRIEF: "Thêm Brief", SAVE_QUOTATION: "Lưu phiên bản báo giá", SAVE_IC: "Lưu IC nháp", SUBMIT: "Gửi duyệt", BENEFICIARY: "Cập nhật người thụ hưởng", EXPENSE: "Ghi chi phí AC", EXPENSE_EVIDENCE: "Bổ sung chứng từ", REVISE_EXPENSE: "Trình bản sửa chi phí", CREATE_REQUEST: "Lập hồ sơ", DECIDE: "Ghi quyết định", TRANSFER: "Chuyển giao", CASH: "Xác nhận tiền thực tế" };
const actionLabel = (value: string) => value.startsWith("TRANSFER_CASH:") ? "Chuyển giao xác nhận tiền" : value.startsWith("TRANSFER_STEP:") ? "Chuyển giao bước duyệt" : ACTION[value] ?? "Cập nhật hồ sơ";
const requestAnchor = () => window.location.hash.startsWith("#request-") ? window.location.hash.slice(1) : "";
const subscribeRequestAnchor = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => { window.removeEventListener("hashchange", listener); window.removeEventListener("popstate", listener); };
};
const serverRequestAnchor = () => "";
export type CostFlowTabId = "overview" | "scope" | "ic" | "approvals" | "expense" | "requests" | "close" | "settings";
const COSTFLOW_TABS = new Set<CostFlowTabId>(["overview", "scope", "ic", "approvals", "expense", "requests", "close", "settings"]);

function FileSelect({ finance, name, label, required }: { finance: Finance; name: string; label: string; required?: boolean }) {
  return <Select name={name} label={label} required={required}><option value="">{required ? "Chọn chứng từ đã lưu" : "Bổ sung sau"}</option>{finance.files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</Select>;
}
function PersonSelect({ finance, name, label, accountOnly = false, defaultValue }: { finance: Finance; name: string; label: string; accountOnly?: boolean; defaultValue?: string }) {
  return <Select name={name} label={label} required defaultValue={defaultValue}><option value="">Chọn người xử lý</option>{finance.users.filter(u => !accountOnly || ["ACCOUNT", "ADMIN"].includes(u.role)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>;
}
function IcEditor({ finance, initial, requestId, sourceRequestId, onSaved, sourcePicker, initialTitle = "", initialPoIds, initialBriefIds }: { finance: Finance; initial?: Partial<IcLine>[]; requestId?: string; sourceRequestId?: string; onSaved?: (result: CostFlowActionState) => void; sourcePicker?: ReactNode; initialTitle?: string; initialPoIds?: string[]; initialBriefIds?: string[] }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(requestId ? finance.requests.find(r => r.id === requestId)?.title ?? "" : initialTitle);
  const [poIds, setPoIds] = useState(initialPoIds ?? finance.data.revisions.find(r => r.requestId === (requestId ?? sourceRequestId))?.poIds ?? []);
  const [briefIds, setBriefIds] = useState(initialBriefIds ?? finance.data.revisions.find(r => r.requestId === (requestId ?? sourceRequestId))?.briefIds ?? []);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Partial<IcLine>[]>(initial?.length ? initial : [{ description: "", unit: "", quantity: "1", unitPrice: "", basis: "NET", vatPercent: "" }]);
  const update = (index: number, field: string, value: string) => setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  const costs = rows.map(row => { try { return calculateCost({ quantity: row.quantity ?? "", unitPrice: row.unitPrice ?? "", basis: row.basis ?? "NET", vatPercent: row.vatPercent ?? "" }); } catch { return null; } });
  const complete = rows.every((row, i) => row.description?.trim() && costs[i]);
  const amounts = totals(costs.filter(cost => cost !== null));
  const navigate = (next: number) => {
    if (next > 1 && !title.trim()) { setError("Nhập tên IC trước khi tiếp tục."); return; }

    setError(""); setStep(next);
  };
  return <div>
    <nav className="tf-wizard-steps" aria-label="Các bước lập IC">{["Thông tin & nguồn", "Hạng mục chi phí", "Kiểm tra & lưu nháp"].map((label, i) => <button key={label} type="button" aria-current={step === i + 1 ? "step" : undefined} onClick={() => navigate(i + 1)}><span className="tf-process-number">{step > i + 1 ? <Check size={13} aria-hidden="true" /> : i + 1}</span>{label}</button>)}</nav>
    <div className="tf-workspace-grid tf-ic-workspace"><Panel className="min-w-0 tf-ic-editor"><ActionForm finance={finance} command="SAVE_IC" requestId={requestId} label="Lưu IC nháp" onSuccess={onSaved} showSubmit={step === 3} onSubmit={event => { if (step !== 3 || !title.trim()) { event.preventDefault(); navigate(step < 3 ? step + 1 : 2); } }}>
      {sourceRequestId && !requestId && <input type="hidden" name="parentRequestId" value={sourceRequestId} />}
      <input type="hidden" name="title" value={title} /><input type="hidden" name="lines" value={JSON.stringify(rows)} />{poIds.map(id => <input key={id} type="hidden" name="poIds" value={id} />)}{briefIds.map(id => <input key={id} type="hidden" name="briefIds" value={id} />)}
      <div hidden={step !== 1} className="space-y-5">{sourcePicker}<Input label="Tên IC" value={title} onChange={e => setTitle(e.target.value)} required={step === 1} placeholder="Ví dụ: IC sản xuất POSM" />      <fieldset className="mb-4"><legend className="tf-label mb-2">Brief / PO từ tài liệu dự án</legend><div className="grid gap-2 sm:grid-cols-2">{finance.files.map(file => <label key={file.id} className="tf-source-option"><input type="checkbox" name="sourceFileIds" value={file.id} /><span>{file.name}</span></label>)}</div>{finance.data.revisions.find(r => r.requestId === (requestId ?? sourceRequestId))?.evidenceIds?.map(id => <label key={id} className="tf-source-option"><input type="checkbox" name="evidenceIds" value={id} defaultChecked /><span>{finance.evidence.find(file => file.id === id)?.name ?? "Nguồn đã lưu"} · phiên bản trước</span></label>)}<Link className="tf-link text-sm" href={`/projects/${finance.project.id}?tab=files`}>Quản lý tài liệu dự án</Link></fieldset>{(finance.data.pos.length > 0 || (finance.data.briefs?.length ?? 0) > 0) && <fieldset><legend className="tf-label mb-3">Nguồn đã đăng ký trước đây</legend><div className="space-y-2">{(finance.data.briefs ?? []).map(brief => <label className="tf-source-option" key={brief.id}><input type="checkbox" checked={briefIds.includes(brief.id)} onChange={e => setBriefIds(ids => e.target.checked ? [...ids,brief.id] : ids.filter(id => id !== brief.id))} /><span>Brief · {brief.title}</span></label>)}{finance.data.pos.filter(po => currentPurchaseOrders(finance.data.pos).some(current => current.id === po.id) || poIds.includes(po.id)).map(po => <label className="tf-source-option" key={po.id}><input type="checkbox" checked={poIds.includes(po.id)} onChange={e => setPoIds(ids => e.target.checked ? [...ids,po.id] : ids.filter(id => id !== po.id))} /><span>PO · {po.number}</span></label>)}</div></fieldset>}<p className="tf-ui-help">{initial?.some(line => line.quotationId) ? "Hạng mục lấy từ báo giá đã lưu; nhập giá vốn và VAT riêng." : initial?.length ? "Đang dùng các dòng từ bản IC đã chọn. Bản cũ được giữ nguyên." : "Khởi tạo IC trống. Nhập các hạng mục ở bước tiếp theo."}</p></div>
      <div hidden={step !== 2}><div className="tf-module-toolbar mb-4"><div><h3 className="font-semibold">Hạng mục chi phí</h3><p className="tf-ui-help">VND · VAT phải rõ · Giữ số lượng và đơn giá gốc</p></div><Button variant="secondary" size="sm" onClick={() => setRows(current => [...current, { description: "", unit: "", quantity: "1", unitPrice: "", basis: "NET", vatPercent: "" }])}><Plus size={15} aria-hidden="true" />Thêm dòng</Button></div>
        <Table caption="Nhập các dòng IC" className="tf-ic-input-table"><thead><tr>{["Hạng mục", "ĐVT", "SL", "Đơn giá VND", "Giá nhập", "VAT %", "Gross", ""].map((label,i) => <th key={i} scope="col">{label || <span className="sr-only">Thao tác</span>}</th>)}</tr></thead><tbody>{rows.map((row,index) => <tr key={row.id ?? index}>
          <td><Input label={`Nội dung dòng ${index + 1}`} value={row.description ?? ""} onChange={e => update(index,"description",e.target.value)}  /><Textarea label={`Lý do chưa có minh chứng dòng ${index+1}`} value={row.evidenceReason ?? ""} onChange={e=>update(index,"evidenceReason",e.target.value)} /><p className="tf-ui-help">{row.evidenceIds?.length ?? 0} minh chứng đã gắn. Dùng bảng song song để gắn thêm file.</p></td><td><Input label={`Đơn vị dòng ${index + 1}`} value={row.unit ?? ""} onChange={e => update(index,"unit",e.target.value)} /></td><td><Input label={`Số lượng dòng ${index + 1}`} inputMode="decimal" value={row.quantity ?? ""} onChange={e => update(index,"quantity",e.target.value)}  /></td><td><Input label={`Đơn giá dòng ${index + 1}`} inputMode="decimal" value={row.unitPrice ?? ""} onChange={e => update(index,"unitPrice",e.target.value)}  /></td><td><Select label={`Giá nhập dòng ${index + 1}`} value={row.basis ?? "NET"} onChange={e => update(index,"basis",e.target.value)}><option value="NET">Net</option><option value="GROSS">Gross</option></Select></td><td><Input label={`VAT dòng ${index + 1}`} inputMode="decimal" value={row.vatPercent ?? ""} onChange={e => update(index,"vatPercent",e.target.value)}  /></td><td className="whitespace-nowrap text-right tabular-nums">{costs[index] ? displayMoney(costs[index]!.gross) : "—"}</td><td><Button variant="ghost" size="sm" aria-label={`Bỏ dòng ${index + 1}`} onClick={() => setRows(current => current.filter((_,i) => i !== index))}><X size={15} aria-hidden="true" /></Button></td>
        </tr>)}</tbody></Table>
      </div>
      <div hidden={step !== 3} className="space-y-4">{!complete && <Alert tone="warning" title="Nháp còn thiếu dữ liệu">{costs.filter(c => !c).length} dòng chưa đủ nội dung / giá vốn / VAT. Được lưu nháp; phải bổ sung trước khi gửi duyệt. Tạm tính các dòng đủ dữ liệu.</Alert>}<div><h3 className="text-lg font-semibold">{title}</h3><p className="tf-ui-help">{rows.length} hạng mục · {briefIds.length} Brief / {poIds.length} PO liên quan · Chưa gửi duyệt</p></div><Table caption="Kiểm tra IC trước khi lưu"><thead><tr><th scope="col">Hạng mục</th><th scope="col">SL</th><th scope="col">VAT</th><th scope="col">Tổng gồm VAT</th></tr></thead><tbody>{rows.map((row,i) => <tr key={row.id ?? i}><td>{row.description}</td><td>{row.quantity} {row.unit}</td><td>{row.vatPercent}% · {row.basis}</td><td className="text-right tabular-nums">{costs[i] ? displayMoney(costs[i]!.gross) : "—"}</td></tr>)}</tbody></Table><Alert title="Lưu nháp trước, trình duyệt riêng">IC chỉ có hiệu lực sau Quản lý duyệt. Bản nháp được lưu vào project khi thao tác thành công.</Alert></div>
      {error && <Alert tone="danger" title={error} />}
      <div className="tf-wizard-footer"><span className="tf-list-meta">Bước {step}/3</span><div className="flex gap-2">{step > 1 && <Button variant="secondary" onClick={() => navigate(step - 1)}>Quay lại</Button>}{step < 3 && <Button onClick={() => navigate(step + 1)}>Tiếp tục<ArrowRight size={15} aria-hidden="true" /></Button>}</div></div>
    </ActionForm></Panel><aside className="tf-summary-card"><h3>{complete ? "Tóm tắt IC" : "Tạm tính các dòng đủ dữ liệu"}</h3><p className="tf-ui-help">Cập nhật theo dữ liệu đang nhập</p><div className="tf-summary-row"><span>Số hạng mục</span><strong>{rows.length}</strong></div>{[["Chi phí net",amounts?.net],["VAT",amounts?.vat],["Tổng gồm VAT",amounts?.gross]].map(([label,value]) => <div key={label} className="tf-summary-row"><span>{label}</span><strong>{value ? displayMoney(value) : "Chưa đủ dữ liệu"}</strong></div>)}<p className="tf-ui-help">Chưa lưu cho tới khi bạn bấm Lưu IC nháp.</p></aside></div>
  </div>;
}

function CashForm({ finance, request }: { finance: Finance; request: Request }) {
  const lines = request.payload.lines ?? finance.data.revisions.find(r => r.id === request.payload.revisionId)?.lines ?? [];
  const [allocations, setAllocations] = useState<{ lineId: string; amount: string }[]>([{ lineId: lines[0]?.id ?? "", amount: "" }]);
  return <ActionForm finance={finance} command="CASH" requestId={request.id} label={request.payload.refund && request.payload.refund !== "0" ? "Xác nhận đã thu hoàn" : "Xác nhận đã chi"}>
    <div className="grid gap-3 sm:grid-cols-3"><Input name="amount" label="Số tiền thực tế (VND)" inputMode="decimal" required /><Input name="reference" label="Mã giao dịch / số phiếu" required /><Input name="occurredAt" label="Ngày giao dịch" type="date" required /></div>
    <input type="hidden" name="allocations" value={JSON.stringify(allocations)} />
    {allocations.map((allocation, index) => <div className="grid gap-3 sm:grid-cols-2" key={index}><Select label={`Dòng phân bổ ${index + 1}`} value={allocation.lineId} required onChange={e => setAllocations(values => values.map((a, i) => i === index ? { ...a, lineId: e.target.value } : a))}><option value="">Chọn dòng IC</option>{lines.map(line => <option key={line.id} value={line.id}>{line.description}</option>)}</Select><Input label="Số tiền phân bổ (VND)" value={allocation.amount} required inputMode="decimal" onChange={e => setAllocations(values => values.map((a, i) => i === index ? { ...a, amount: e.target.value } : a))} /></div>)}
    <Button variant="secondary" onClick={() => setAllocations(values => [...values, { lineId: "", amount: "" }])}>Thêm phân bổ</Button>
    {finance.fullAccess && <FileSelect finance={finance} label="Chứng từ đã lưu trong project" name="sourceFileId" />}
    <Input type="file" name="proof" label="Hoặc tải biên lai / phiếu thu, chi" hint="Tối đa 4 MB. Tệp chỉ được lưu sau khi xác nhận thành công." />
  </ActionForm>;
}

export function RequestCard({ finance, request, user }: { finance: Finance; request: Request; user: { id: string; role: string } }) {
  const [withdraw, setWithdraw] = useState(false);
  const [decision, setDecision] = useState("APPROVE");
  const [corrections, setCorrections] = useState([""]);
  const current = request.steps[request.currentStep];
  const samePerson = request.steps.filter(step => step.assigneeId === user.id).length > 1 || (request.creatorId === user.id && current?.assigneeId === user.id);
  const revision = request.kind === "IC" ? finance.data.revisions.find(item => item.requestId === request.id) : undefined;
  const status = revision ? icStatusProjection(revision, request, finance.data.revisions) : undefined;
  const actorName = (id?: string) => finance.users.find(item => item.id === id)?.name ?? "Chưa phân công";
  const projectedSteps = request.steps.length ? request.steps : [{ role: "MANAGER", assigneeId: finance.data.config.managerId }, { role: "ACCOUNTANT", assigneeId: finance.data.config.accountantId }, { role: "CEO", assigneeId: finance.data.config.ceoId }];
  const timeline = request.kind === "IC" ? [{ role: "ACCOUNT", label: "Account", assigneeId: request.creatorId }, ...projectedSteps.map(step => ({ ...step, label: ROLE[step.role] ?? step.role }))] : [];
  const ceoOptional = request.kind === "IC" && current?.role === "CEO";
  const managerId = request.steps.find(step => step.role === "MANAGER")?.assigneeId;
  return <Panel id={`request-${request.id}`} className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="tf-ui-help">{KIND[request.kind] ?? request.kind}</p><h3 className="font-semibold">{request.title}</h3></div><Badge tone={request.state === "APPROVED" ? "success" : request.state === "REJECTED" ? "danger" : "neutral"}>{STATE[request.state] ?? request.state}</Badge></div>
    {revision && status && <><div className="tf-ic-status-grid"><div><span>Hiệu lực ngân sách</span><Badge tone={revision.effective ? "success" : "warning"}>{status.budgetLabel}</Badge></div><div><span>Kết quả trình duyệt</span><Badge tone={request.state === "REJECTED" ? "danger" : request.state === "APPROVED" ? "success" : "neutral"}>{status.approvalLabel}</Badge></div></div><Alert tone={revision.effective ? "info" : "warning"} title={`IC-R${revision.number}`}>{status.message}{status.baselineRevisionId && status.baselineRevisionId !== revision.id && <><br /><a className="tf-link" href={`#ic-revision-${status.baselineRevisionId}`}>Mở baseline ngân sách hiện hành</a></>}</Alert><section aria-labelledby={`timeline-${request.id}`}><h4 id={`timeline-${request.id}`} className="font-semibold">Timeline trình duyệt</h4><ol className="tf-approval-timeline">{timeline.map((step,index) => { const event = index === 0 ? request.approvalEvents.find(item => item.attemptId === request.currentAttemptId && item.action === "SUBMIT") : request.approvalEvents.find(item => item.attemptId === request.currentAttemptId && item.stepIndex === index - 1 && ["APPROVE", "RETURN", "REJECT"].includes(item.action)); const pending = index > 0 && request.state === "SUBMITTED" && request.currentStep === index - 1; return <li key={`${step.role}:${index}`}><strong>{step.label}</strong><span>{actorName(step.assigneeId)}</span><span>{event ? actionLabel(event.action) : pending ? "Đang chờ xử lý" : "Chưa xử lý"}</span><span>{event?.createdAt ? new Date(event.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Chưa xử lý"}</span><p>{event?.reason?.trim() || (event ? "Không có ghi chú" : "Chưa xử lý")}</p></li>; })}</ol></section></>}
    {request.parentId && finance.requests.some(r => r.id === request.parentId) && <Link className="tf-link text-sm" href={`#request-${request.parentId}`}>Hồ sơ nguồn của bản gửi lại</Link>}
    {request.payload.amount && <p className="text-lg font-semibold tabular-nums">{displayMoney(request.payload.amount)}</p>}
    {request.payload.beneficiary && <p className="text-sm">{request.payload.beneficiary.name} · {request.payload.beneficiary.bank} · {request.payload.beneficiary.account}</p>}
    {request.payload.explanation && <p className="whitespace-pre-wrap text-sm">{request.payload.explanation}</p>}
    {request.payload.expenseRevision && <div className="text-sm"><p>Bản sửa chi phí: {request.payload.expenseRevision.proposed.description}</p><p>Tổng gồm VAT đề nghị: {displayMoney(request.payload.expenseRevision.proposed.cost.gross)}</p><p>Chi phí hiện tại chỉ đổi khi bản sửa được duyệt xong.</p></div>}
    {request.state === "SUBMITTED" && current && <p className="text-sm">Đang chờ {ROLE[current.role] ?? current.role}: {finance.users.find(u => u.id === current.assigneeId)?.name ?? "người được phân công"}</p>}
    {request.kind === "REIMBURSEMENT" && <div className="flex flex-wrap gap-4"><Link className="tf-link" href={`/api/projects/${finance.project.id}/costflow/requests/${request.id}/export`}>Tải Excel</Link><Link className="tf-link" href={`/projects/${finance.project.id}/costflow/requests/${request.id}/print`} target="_blank">In / lưu PDF</Link><span className="tf-ui-help">Chưa ký</span></div>}
    {request.kind === "IC" && <IcRequestEvidence finance={finance} request={request} canSupplement={request.creatorId===user.id && finance.fullAccess && ["ACCOUNT","ADMIN"].includes(user.role) && !finance.data.closed} />}
    {request.state === "DRAFT" && request.creatorId === user.id && <ActionForm finance={finance} command="SUBMIT" requestId={request.id} label={revision ? `Gửi IC-R${revision.number} tới Quản lý` : "Gửi duyệt"}>{revision && <Textarea name="explanation" label="Lý do / tóm tắt thay đổi" hint="Bắt buộc cho mỗi lần gửi IC; giải thích riêng từng dòng là không bắt buộc." required />}</ActionForm>}
    {request.state === "SUBMITTED" && current?.assigneeId === user.id && <>
      {samePerson && <Alert tone="warning" title="Bạn xử lý nhiều vai trò" >Mỗi bước cần một quyết định riêng.</Alert>}
      <ActionForm finance={finance} command="DECIDE" requestId={request.id} request={request} label={current.role === "MANAGER" && revision ? `Duyệt IC-R${revision.number}` : "Ghi quyết định"}><Select name="decision" label="Quyết định" value={decision} onChange={event=>setDecision(event.target.value)}><option value="APPROVE">{current.role === "ACCOUNTANT" ? "Kiểm tra đạt, xác minh người nhận và chuyển CEO" : revision ? `Duyệt IC-R${revision.number}` : "Duyệt"}</option><option value="RETURN">{ceoOptional ? "Trả để sửa" : "Trả hồ sơ để sửa"}</option><option value="REJECT">{ceoOptional ? "Từ chối IC" : "Từ chối"}</option></Select><Textarea name="reason" label={ceoOptional ? "Ghi chú của CEO (không bắt buộc)" : "Ý kiến / lý do"} hint={ceoOptional ? "Có thể để trống; actor, thời điểm và kết quả vẫn được lưu." : "Bắt buộc khi trả hoặc từ chối"} />{decision === "RETURN" && !ceoOptional && <fieldset className="space-y-3"><legend className="font-medium">Nội dung cần sửa</legend>{corrections.map((item,index)=><div className="flex items-end gap-2" key={index}><Textarea name="correctionItems" label={`Nội dung ${index+1}`} value={item} onChange={event=>setCorrections(values=>values.map((value,i)=>i===index?event.target.value:value))} required /><Button variant="ghost" disabled={corrections.length===1} onClick={()=>setCorrections(values=>values.filter((_,i)=>i!==index))}>Bỏ</Button></div>)}<Button variant="secondary" onClick={()=>setCorrections(values=>[...values,""])}>Thêm nội dung</Button></fieldset>}{current.role === "ACCOUNTANT" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="reviewConfirmed" value="yes" />Đã kiểm tra đủ thông tin, chứng từ, phiên bản, người thụ hưởng và liên kết IC.</label>}{current.role === "MANAGER" && revision && <Alert title="Hiệu lực ngay sau quyết định">Duyệt sẽ thay baseline ngân sách bằng IC-R{revision.number} và chuyển riêng sang bước Kế toán. Không cấp quyền thanh toán.</Alert>}{ceoOptional && ["RETURN", "REJECT"].includes(decision) && <Alert tone="warning" title={decision === "RETURN" ? `Trả IC-R${revision?.number} để sửa?` : `Từ chối IC-R${revision?.number}?`}>{decision === "RETURN" ? "Bản đã xét được giữ nguyên; hệ thống tạo một revision sửa liên kết và trình lại từ Quản lý. Ngân sách hiện hành không tự bị vô hiệu." : "Kết quả trình duyệt được lưu; ngân sách đã có hiệu lực không tự bị vô hiệu. Quyết định này không cấp quyền thanh toán."}</Alert>}</ActionForm>
    </>}
    {request.creatorId === user.id && request.state === "SUBMITTED" && <><Button variant="danger" onClick={() => setWithdraw(true)}>Rút hồ sơ</Button><Dialog open={withdraw} onClose={() => setWithdraw(false)} title="Rút hồ sơ" description={request.kind === "IC" ? "IC này sẽ ngừng hiệu lực ngân sách. Lịch sử và giao dịch đã ghi vẫn được giữ." : "Rút hồ sơ khỏi vòng duyệt, giữ lịch sử."}><ActionForm finance={finance} command="DECIDE" requestId={request.id} request={request} label="Xác nhận rút" danger onSuccess={() => setWithdraw(false)}><input type="hidden" name="decision" value="WITHDRAW" /><Textarea name="reason" label="Lý do rút" required /></ActionForm></Dialog></>}
    {request.state === "APPROVED" && request.cashAssigneeId === user.id && ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(request.kind) && !finance.data.closed && <details><summary className="cursor-pointer font-medium">Ghi nhận tiền thực tế</summary><div className="mt-3"><CashForm finance={finance} request={request} /></div></details>}
    {request.kind === "IC" && ["RETURNED", "REJECTED"].includes(request.state) && managerId === user.id && <details><summary className="cursor-pointer font-medium">Ghi giải trình của Quản lý</summary><div className="mt-3"><ActionForm finance={finance} command="IC_MANAGER_EXPLANATION" requestId={request.id} label="Lưu giải trình"><Textarea name="explanation" label="Giải trình của Quản lý" hint="Được lưu vào lịch sử của đúng request/revision; không thay đổi hiệu lực hoặc kết quả CEO." required /></ActionForm></div></details>}
    {(user.role === "ADMIN" || request.steps[0]?.assigneeId === user.id) && finance.fullAccess && request.currentAttemptId && <details><summary className="cursor-pointer text-sm">Chuyển giao xử lý</summary><div className="mt-3"><ActionForm finance={finance} command="TRANSFER" requestId={request.id} request={request} label="Chuyển giao"><PersonSelect finance={finance} label="Người nhận" name="assigneeId" /><Select name="transferRole" label="Phần chuyển giao"><option value="STEP">Bước duyệt hiện tại</option><option value="CASH">Xác nhận tiền thực tế</option></Select><Textarea name="reason" label="Lý do chuyển giao" required /></ActionForm></div></details>}
    {finance.evidence.filter(e => e.requestId === request.id).length > 0 && <ul className="space-y-1 text-sm">{finance.evidence.filter(e => e.requestId === request.id).map(e => <li key={e.id}><Link className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${e.id}`}>{e.name}</Link></li>)}</ul>}
    {request.decisions.length > 0 && <details><summary className="cursor-pointer text-sm">Lịch sử quyết định ({request.decisions.length})</summary><ol className="mt-2 space-y-2 text-sm">{request.decisions.map(d => <li key={d.id}>{finance.users.find(u => u.id === d.actorId)?.name ?? "Người xử lý"} · {actionLabel(d.action)} · {new Date(d.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}<p>{d.reason || "Không có ghi chú"}</p></li>)}</ol></details>}
  </Panel>;
}

export default function CostFlowPanel({ finance, user, projectHeading, initialTab }: { finance: Finance; user: { id: string; role: string }; projectHeading: ReactNode; initialTab?: string }) {
  const [tab, setTabState] = useState<CostFlowTabId | null>(initialTab && COSTFLOW_TABS.has(initialTab as CostFlowTabId) ? initialTab as CostFlowTabId : null);
  const anchor = useSyncExternalStore(subscribeRequestAnchor, requestAnchor, serverRequestAnchor);
  const [icSource, setIcSource] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [quoteSeed, setQuoteSeed] = useState<{ lines: Partial<IcLine>[]; poIds: string[]; title: string; briefIds: string[] } | null>(null);
  const [savedNotice, setSavedNotice] = useState("");
  const canCreate = finance.fullAccess && ["ADMIN", "ACCOUNT"].includes(user.role);
  const latestQuotation = finance.data.quotations?.at(-1);
  const latestQuotationGross = (() => {
    if (!latestQuotation) return undefined;
    try { return projectQuotation(latestQuotation).amount.gross; } catch { return undefined; }
  })();
  const cashTotal = finance.cash.reduce((sum, row) => sum + Number(row.amount || 0) * (row.direction === "IN" ? -1 : 1), 0);
  const missingEvidence = finance.data.expenses.filter(expense => !expense.invoiceId || !expense.paymentProofId).length;
  const effective = finance.data.revisions.find(r => r.effective);
  const metrics = margin(finance.data);
  const users = new Map(finance.users.map(u => [u.id, u.name]));
  const tabs: [CostFlowTabId, string][] = finance.fullAccess
    ? [["overview", "Tổng quan"], ["scope", "Scope & Báo giá"], ["ic", "Internal Cost"], ["approvals", "Trình duyệt"], ["expense", "Actual Cost"], ["requests", "Hồ sơ & tiền"], ["close", "Quyết toán"], ...(user.role === "ADMIN" ? [["settings", "Phân công"]] as [CostFlowTabId, string][] : [])]
    : [["approvals", "Hồ sơ được giao"]];
  const activeTab: CostFlowTabId = anchor ? "approvals" : tab && tabs.some(([id]) => id === tab) ? tab : finance.fullAccess ? "overview" : "approvals";
  const setTab = (next: string) => {
    if (!COSTFLOW_TABS.has(next as CostFlowTabId)) return;
    const resolved = next as CostFlowTabId;
    setTabState(resolved);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", resolved);
    if (resolved !== "approvals" && url.hash.startsWith("#request-")) url.hash = "";
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };
  useEffect(() => {
    const syncFromUrl = () => {
      const next = new URL(window.location.href).searchParams.get("tab");
      if (next && COSTFLOW_TABS.has(next as CostFlowTabId)) setTabState(next as CostFlowTabId);
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);
  useEffect(() => {
    if (activeTab === "approvals" && anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [activeTab, anchor]);
  let working: ReturnType<typeof workingIcRevision> = undefined; let workingError = "";
  try { working = workingIcRevision(finance.data, finance.requests); } catch (error) { workingError = error instanceof Error ? error.message : "Cần đối soát revision"; }
  const selectedIc = finance.data.revisions.find(r => r.id === icSource);
  const editableRequest = selectedIc?.createdBy === user.id && finance.requests.some(r => r.id === selectedIc.requestId && r.state === "DRAFT") ? selectedIc.requestId : undefined;
  const openIc = () => { setQuoteSeed(null); setIcSource(working?.id ?? effective?.id ?? ""); setTab("ic"); setEditorOpen(true); };
  const onIcSaved = (result: CostFlowActionState) => { if (result.revisionId) setIcSource(result.revisionId); setEditorOpen(false); setQuoteSeed(null); setSavedNotice("Đã lưu IC nháp. Mở Trình duyệt để gửi duyệt khi đã kiểm tra xong."); };
  if (editorOpen && activeTab === "ic" && canCreate && !finance.data.closed) return <div className="space-y-4">
    <div className="tf-module-breadcrumb mt-4"><button type="button" className="tf-link" onClick={() => setEditorOpen(false)}>{finance.project.name}</button><span>›</span><span>Internal Cost</span></div>
    <div className="tf-module-heading"><div><h1 className="tf-module-title">{editableRequest ? "Sửa IC nháp" : "Tạo Internal Cost"}</h1><p className="tf-module-description">{finance.project.name} · {quoteSeed ? "Từ báo giá đã lưu · nhập giá vốn riêng" : "Dự toán chi phí có phiên bản"}</p></div><Button variant="secondary" onClick={() => setEditorOpen(false)}>Thoát</Button></div>
    <IcEditor key={`${quoteSeed ? "quote" : icSource || "blank"}:${finance.requests.find(r => r.id === editableRequest)?.version ?? "new"}`} finance={finance} initial={quoteSeed?.lines ?? selectedIc?.lines} initialTitle={quoteSeed?.title ?? finance.requests.find(q => q.id === selectedIc?.requestId)?.title} initialPoIds={quoteSeed?.poIds} initialBriefIds={quoteSeed?.briefIds} requestId={editableRequest} sourceRequestId={selectedIc?.requestId} onSaved={onIcSaved} sourcePicker={<div>{quoteSeed ? <Alert title="Đã chọn hạng mục từ báo giá">Giá bán vẫn được giữ trong báo giá. Nhập giá vốn và VAT của chi phí ở bước tiếp theo.</Alert> : <Select label="Bắt đầu từ" value={icSource} onChange={e => setIcSource(e.target.value)}><option value="">IC trống</option>{finance.data.revisions.map(r => <option key={r.id} value={r.id}>IC revision {r.number} {r.createdBy === user.id && finance.requests.some(q => q.id === r.requestId && q.state === "DRAFT") ? "— sửa nháp" : "— copy thành revision mới"}</option>)}</Select>}<Button className="mt-3" variant="secondary" onClick={() => { setEditorOpen(false); setTab("scope"); }}>Chọn hạng mục từ Scope & Báo giá</Button></div>} />
  </div>;
  return <div className="space-y-4">
    <section className="tf-costflow-hero"><div className="tf-costflow-hero-heading">{projectHeading}<div className="flex flex-wrap items-center gap-2"><Link className="tf-button-secondary" href="/workflow">Hồ sơ của tôi</Link>{canCreate && !finance.data.closed && <><Button variant="secondary" size="sm" onClick={openIc}><Plus size={15} aria-hidden="true" />Tạo IC</Button><Button size="sm" onClick={() => setTab("requests")}><FilePlus2 size={15} aria-hidden="true" />Lập hồ sơ chi</Button></>}</div></div>
      <ModuleTabs label="CostFlow" tabs={tabs.map(([id,label]) => ({ id,label,...(id === "approvals" ? {count:finance.requests.filter(r => r.state === "SUBMITTED").length} : {}) }))} active={activeTab} onChange={setTab} />
    </section>
    {finance.fullAccess && activeTab === "overview" && <div className="tf-metric-grid">
      <MetricCard label="Báo giá hiện hành" value={latestQuotationGross ? displayMoney(latestQuotationGross) : "Chưa có"} hint={latestQuotation ? `BG-${latestQuotation.number} · gồm VAT` : "Tạo từ Scope & Báo giá"} icon={CircleDollarSign} />
      <MetricCard label="IC hiệu lực" value={effective ? displayMoney(totals(completeIcLines(effective.lines).map(l => l.cost)).net) : "Chưa có"} hint={effective ? `Revision ${effective.number} · net` : "Cần Quản lý duyệt"} icon={Layers3} />
      <MetricCard label="AC phát sinh" value={displayMoney(metrics.incurred)} hint={`${finance.data.expenses.length} khoản chi · net`} icon={Wallet} />
      <MetricCard label="Tiền thực tế" value={displayMoney(String(cashTotal))} hint={`${finance.cash.length} giao dịch · chi trừ thu hoàn`} icon={TrendingUp} accent />
      <MetricCard label="Hồ sơ chờ xử lý" value={String(finance.requests.filter(request => request.state === "SUBMITTED").length)} hint="Mở tab Trình duyệt để xử lý" icon={FileText} />
      <MetricCard label="Chứng từ còn thiếu" value={String(missingEvidence)} hint="AC thiếu hóa đơn hoặc bằng chứng chi" icon={Paperclip} />
    </div>}
    {savedNotice && <Alert tone="success" title={savedNotice} />}
    {activeTab === "overview" && <>
      <div className="tf-workspace-grid"><Panel><div className="tf-section-heading"><div><h2>{finance.data.revisions.length ? "Hồ sơ gần đây" : "Bắt đầu ngân sách dự án"}</h2><p>Theo dõi dự toán, hồ sơ chi và tiền thực tế trong cùng project.</p></div><FileText size={20} className="text-[var(--text-secondary)]" aria-hidden="true" /></div>{finance.requests.length ? <Table caption="Các hồ sơ cập nhật gần đây"><thead><tr><th scope="col">Hồ sơ</th><th scope="col">Loại</th><th scope="col">Trạng thái</th></tr></thead><tbody>{finance.requests.slice(0,5).map(r => <tr key={r.id}><td><a href={`#request-${r.id}`} className="tf-inbox-row-title text-left" onClick={() => setTab("approvals")}>{r.title}</a></td><td>{KIND[r.kind]}</td><td><Badge tone={r.state === "APPROVED" ? "success" : "neutral"}>{STATE[r.state]}</Badge></td></tr>)}</tbody></Table> : <div className="py-8"><p className="mb-2 text-lg font-semibold">Project chưa có IC</p><p className="mb-6 max-w-lg text-sm text-[var(--text-secondary)]">Tạo dự toán đầu tiên, chọn PO liên quan và nhập chi phí theo từng hạng mục. Bạn có thể lưu nháp trước khi gửi duyệt.</p>{canCreate && !finance.data.closed && <Button onClick={() => {openIc();}}><Plus size={16} aria-hidden="true" />Tạo IC đầu tiên</Button>}</div>}</Panel><aside className="tf-summary-card"><h3>Thiết lập project</h3><div className="mt-4 space-y-4">{[["Kế toán",finance.data.config.accountantId],["CEO",finance.data.config.ceoId],["Quản lý đóng/mở",finance.data.config.managerId]].map(([label,id]) => <div key={label}><p className="tf-list-meta">{label}</p><p className={`mt-1 text-sm font-medium${!id ? " text-[var(--warning)]" : ""}`}>{users.get(id) ?? "Chưa phân công"}</p></div>)}{user.role === "ADMIN" && <Button variant="secondary" size="sm" onClick={() => setTab("settings")}>Cập nhật phân công<ArrowRight size={14} aria-hidden="true" /></Button>}<div className="border-t border-[var(--border)] pt-4"><Link className="tf-link inline-flex items-center gap-2 text-sm" href={`/projects/${finance.project.id}?tab=files`}><FileText size={15} aria-hidden="true" />Tài liệu project</Link><p className="tf-ui-help">Chứng từ đã lưu được dùng cho hồ sơ chi.</p></div></div></aside></div>
    </>}
    {activeTab === "scope" && <>
      <QuotationPanel userId={user.id} finance={finance} canCreate={canCreate && !finance.data.closed} onCreateIc={(lines,poIds,title,briefIds) => { if (working) { setSavedNotice("Project đang có revision xử lý. Dùng cập nhật báo giá trong bản đó; bản đã gửi cần rút trước."); setTab("ic"); return; } setIcSource(""); setQuoteSeed({lines,poIds,title,briefIds}); setTab("ic"); setEditorOpen(true); }} />
    </>}
    {activeTab === "settings" && <Panel><h2 className="mb-4 font-semibold">Phân công tài chính</h2><ActionForm finance={finance} command="CONFIGURE" label="Lưu phân công"><PersonSelect finance={finance} label="Kế toán" name="accountantId" defaultValue={finance.data.config.accountantId} /><PersonSelect finance={finance} label="CEO" name="ceoId" defaultValue={finance.data.config.ceoId} /><PersonSelect finance={finance} label="Quản lý phụ trách project (đóng/mở tài chính)" name="managerId" defaultValue={finance.data.config.managerId} /><p className="tf-ui-help">Bước Quản lý khi trình IC/hồ sơ chi lấy theo quản lý trực tiếp của người lập.</p></ActionForm></Panel>}
    {activeTab === "ic" && (
      <InternalCostPanel
        finance={finance}
        user={user}
        canCreate={canCreate && !finance.data.closed}
        working={working}
        workingError={workingError}
        onOpenWizard={(sourceId, seed) => {
          setQuoteSeed(seed ?? null);
          setIcSource(sourceId ?? working?.id ?? effective?.id ?? "");
          setEditorOpen(true);
        }}
        onSelectTab={setTab}
      />
    )}
    {activeTab === "approvals" && <ApprovalRequestsPanel finance={finance} user={user} canCreate={canCreate} />}
    {activeTab === "expense" && <ActualCostPanel finance={finance} user={user} canCreate={canCreate} />}
    {activeTab === "requests" && <PaymentCashPanel finance={finance} user={user} canCreate={canCreate} onSelectTab={setTab} setSavedNotice={setSavedNotice} />}
    {activeTab === "close" && <SettlementPanel finance={finance} user={user} canCreate={canCreate} />}
    </div>;
}
