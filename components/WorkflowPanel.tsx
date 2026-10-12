"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { workflowAction, type WorkflowActionState } from "@/app/actions/workflow";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import { ChevronRight, FileCheck2, FilePlus2, Plus, PenTool, Printer, ShieldCheck } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleUI";
import { TEMPLATE_KINDS, type DocumentPayload } from "@/lib/workflow/documents";
import { FIELD_LABELS, effectiveRequirements, evaluateDocumentCompleteness, type Requirements, type RequiredField } from "@/lib/workflow/requirements";
import type { ApprovalStep } from "@/lib/workflow/approval";
import { WORKFLOW_HUB_HREF, workflowDocumentHref, workflowPrintHref, workflowRequestHref as requestHref } from "@/lib/workflow/routes";
import WorkflowDecisionDialog from "@/components/WorkflowDecisionDialog";
import { SignaturePad } from "@/components/SignaturePad";
import PaperSigningSection from "@/components/workflow/PaperSigningSection";

type Person = { id: string; name: string };
type Template = { requirements: Requirements | null; familyId: string; category: string; purpose: string; changeNote: string; id: string; kind: string; name: string; version: number; parentId: string | null; ownerId: string; accountantId: string; ceoId: string; signerNames: string; instructions: string; requiresExecutionTracking: boolean; fileId: string | null; ownerConfirmedAt: string | null; publishedAt: string | null; revision: number };
type Summary = { id: string; code: string; projectId: string | null; module: string; kind: string; title: string; creatorId: string; parentId: string | null; state: string; version: number; financeVersion: number | null; signingMode: string | null; signingEvidenceState?: string | null; replacesRequestId: string | null; replacedByRequestId: string | null; pendingReplacementRequestId: string | null; supersededAt: string | null; steps: ApprovalStep[]; currentStep: number; currentAttemptId: string | null; submittedVersion: number | null; currentRole: string | null; currentAssigneeId: string | null; currentStepArrivedAt: string | null; createdAt: string; attemptNumber: number; resubmission: boolean; processedAt: string | null; project: { name: string } | null; approvalEvents: { id: string; actorId: string; action: string; attemptId: string | null; submittedVersion: number | null; createdAt: string }[] };
type ListData = { admin: boolean; templates: Template[]; managedTemplates: Template[]; projects: Person[]; requests: Summary[]; views: { pending: Summary[]; processed: Summary[]; mine: Summary[] }; users: Person[] };
type Document = Summary & { templateId: string | null; template: Template | null; version: number; parentId: string | null; payload: DocumentPayload; files: { id: string; kind: string; name: string; size: number; sha256: string; createdAt: string }[]; decisions: { id: string; actorId: string; action: string; reason: string; createdAt: string }[]; history: { id: string; actorId: string; action: string; version: number; createdAt: string }[]; physicalScanBatches: { id: string; version: number; status: string; keeperDeclared: string; locationDeclared: string; keeperNormalized: string | null; locationNormalized: string | null; returnedReason: string | null; createdAt: string; files: { id: string; name: string; size: number; sha256: string }[]; transitions: { id: string; action: string; reason: string; createdAt: string }[] }[] };
type Submission = {attempts:{id:string;requestId:string;number:number;createdAt:string}[];historical:boolean;selection:string;currentRequestId:string;legacyMissingManifest:boolean};
type Detail = { request: Document; users: Person[]; canTransfer: boolean; linked: { id: string; module: string; projectId: string | null; title: string } | null };
const STATES: Record<string, string> = { DRAFT: "Nháp", SUBMITTED: "Chờ duyệt", APPROVED: "Đã duyệt", REPLACED: "Đã thay thế", RETURNED: "Đã trả", REJECTED: "Từ chối", WITHDRAWN: "Đã rút", CANCELLED: "Đã hủy" };
const ROLES: Record<string, string> = { MANAGER: "Quản lý", ACCOUNTANT: "Kế toán", CEO: "CEO" };
const ACTIONS: Record<string, string> = { APPROVE: "Duyệt", RETURN: "Trả hồ sơ", REJECT: "Từ chối", WITHDRAW: "Rút hồ sơ", TRANSFER: "Chuyển giao", SAVE_DOCUMENT: "Lưu nháp", SUBMIT_DOCUMENT: "Gửi duyệt", DECIDE_DOCUMENT: "Quyết định", TRANSFER_DOCUMENT: "Chuyển giao", ADD_REFERENCE: "Bổ sung tham khảo", UPLOAD_SIGNED: "Tải bản ký", CONFIRM_SIGNED: "Xác nhận đủ bản ký" };
const fileHref = (id: string) => `/api/workflow/files/${id}`;

function Form({ command, version = 0, requestId, request, templateId, children, label, redirectAfterSave = false, confirmMessage }: { command: string; version?: number; requestId?: string; request?: Pick<Summary,"module"|"currentAttemptId"|"currentStep"|"submittedVersion">; templateId?: string; children?: ReactNode; label: string; redirectAfterSave?: boolean; confirmMessage?: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (previous: WorkflowActionState, form: FormData) => {
    const result = await workflowAction(previous, form);
    if (result.success) { if (redirectAfterSave && result.requestId) router.push(workflowDocumentHref(result.requestId)); router.refresh(); }
    return result;
  }, {});
  return <form action={action} onSubmit={(e) => { if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault(); }} className="space-y-4"><input type="hidden" name="command" value={command} /><input type="hidden" name="version" value={version} />{requestId && <input type="hidden" name="requestId" value={requestId} />}{request && <><input type="hidden" name="module" value={request.module} /><input type="hidden" name="attemptId" value={request.currentAttemptId ?? ""} /><input type="hidden" name="stepIndex" value={request.currentStep} /><input type="hidden" name="submittedVersion" value={request.submittedVersion ?? ""} /></>}{templateId && <input type="hidden" name="templateId" value={templateId} />}{children}{state.error && <Alert tone="danger" title={state.error} />}{state.success && <Alert tone="success" title={state.success} />}<div className="flex justify-end border-t border-zinc-100 pt-4"><Button type="submit" loading={pending} loadingLabel="Đang lưu…">{label}</Button></div></form>;
}
function PersonField({ users, name, label, value }: { users: Person[]; name: string; label: string; value?: string }) {
  return <Select name={name} label={label} defaultValue={value ?? ""}><option value="">Chưa phân công</option>{users.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>;
}
function DecisionFields({ role }: { role: string }) {
  const [decision,setDecision] = useState("APPROVE");
  const [items,setItems] = useState([""]);
  return <><Select name="decision" label="Quyết định" value={decision} onChange={event=>setDecision(event.target.value)}><option value="APPROVE">{role === "ACCOUNTANT" ? "Xác nhận đạt, chuyển CEO" : "Duyệt"}</option><option value="RETURN">Trả bổ sung</option><option value="REJECT">Từ chối</option></Select><Textarea name="reason" label="Nhận xét / lý do" hint="Bắt buộc khi trả hoặc từ chối." />{decision === "RETURN" && <fieldset className="space-y-3"><legend className="font-medium">Nội dung cần sửa</legend>{items.map((item,index)=><div className="flex items-end gap-2" key={index}><Textarea name="correctionItems" label={`Nội dung ${index+1}`} value={item} onChange={event=>setItems(values=>values.map((value,i)=>i===index?event.target.value:value))} required /><Button variant="ghost" disabled={items.length===1} onClick={()=>setItems(values=>values.filter((_,i)=>i!==index))}>Bỏ</Button></div>)}<Button variant="secondary" onClick={()=>setItems(values=>[...values,""])}>Thêm nội dung</Button></fieldset>}{role === "ACCOUNTANT" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="reviewConfirmed" value="yes" />Đã kiểm tra đủ thông tin/tài liệu, đúng phiên bản; đối tác, số tiền và IC liên quan nếu có.</label>}</>;
}
function UploadField({ label = "Tài liệu chính", required = false, id }: { label?: string; required?: boolean; id?: string }) {
  const [chosen,setChosen] = useState(false);
  return <Input id={id} onChange={e=>setChosen(!!e.target.files?.length)} type="file" name="document" label={label} required={required} accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png" hint={chosen ? "Đã chọn, chưa lưu · tối đa 4 MiB" : "PDF/DOCX/XLSX/JPG/PNG, tối đa 4 MiB. Chỉ lưu sau khi thao tác thành công."} />;
}
function SubmitDocumentForm({ request }: { request: Document }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (previous: WorkflowActionState, form: FormData) => {
    const result = await workflowAction(previous, form);
    if (result.success) router.refresh();
    return result;
  }, {});
  const requiresSignature = ["PROPOSAL", "PROPOSAL_ADVANCE", "PROPOSAL_ADVANCE_SETTLEMENT", "SERVICE_CONTRACT"].includes(request.kind);
  const [signingMode, setSigningMode] = useState<"DIGITAL" | "PHYSICAL">("DIGITAL");
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureData, setSignatureData] = useState("");
  const [signaturePin, setSignaturePin] = useState("");
  return <>
    <form action={action} className="space-y-4">
      <input type="hidden" name="command" value="SUBMIT_DOCUMENT" />
      <input type="hidden" name="requestId" value={request.id} />
      <input type="hidden" name="version" value={request.version} />
      <input type="hidden" name="signatureData" value={signatureData} />
      <input type="hidden" name="signaturePin" value={signaturePin} />
      <input type="hidden" name="signingMode" value={signingMode} />
      <p className="tf-ui-help">Cần đủ thông tin và tài liệu theo checklist của mẫu, cùng người duyệt được phân công. Nháp dùng mẫu cũ vẫn lưu được; cần tạo nháp riêng theo mẫu hiện tại để gửi.</p>
      {requiresSignature && <Select label="Hình thức ký" value={signingMode} onChange={event => setSigningMode(event.target.value as "DIGITAL" | "PHYSICAL")}><option value="DIGITAL">Ký điện tử nội bộ + PIN</option><option value="PHYSICAL">Ký giấy và tải batch scan sau duyệt</option></Select>}
      {requiresSignature && signingMode === "DIGITAL" && <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <p className="text-sm font-medium">Chữ ký nội bộ của người lập</p>
        <p className="tf-ui-help">Chữ ký PNG và PIN chỉ được gửi khi bạn xác nhận; máy chủ kiểm tra lại trước khi ghi sự kiện.</p>
        <Button type="button" variant="secondary" onClick={() => setSignatureOpen(true)}>{signatureData ? "Ký lại" : "Ký và xác nhận PIN"}</Button>
      </div>}
      {state.error && <Alert tone="danger" title={state.error} />}
      {state.success && <Alert tone="success" title={state.success} />}
      <div className="flex justify-end border-t border-zinc-100 pt-4"><Button type="submit" loading={pending} loadingLabel="Đang gửi…" disabled={requiresSignature && signingMode === "DIGITAL" && !signatureData}>Gửi duyệt</Button></div>
    </form>
    {signatureOpen && <SignaturePad open={signatureOpen} onClose={() => setSignatureOpen(false)} onConfirm={(dataUrl, pin) => { setSignatureData(dataUrl); setSignaturePin(pin); setSignatureOpen(false); }} userName="Người lập hồ sơ" userRoleTitle="Người lập" title={`Ký gửi — ${request.title}`} />}
  </>;
}
function TemplateEditor({ template, users, parent }: { template?: Template; users: Person[]; parent?: Template }) {
  const source = template ?? parent;
  const [requirements,setRequirements] = useState(effectiveRequirements(source?.requirements));
  return <Form command="SAVE_TEMPLATE" templateId={template?.id} version={template?.revision} label="Lưu mẫu nháp"><input type="hidden" name="requirements" value={JSON.stringify(requirements)} /><fieldset><legend className="font-semibold">Thông tin bắt buộc khi gửi</legend>{Object.entries(FIELD_LABELS).map(([key,label])=><label className="block my-2 text-sm" key={key}><input type="checkbox" checked={requirements.requiredFields.includes(key as RequiredField)} onChange={e=>setRequirements({...requirements,requiredFields:e.target.checked ? [...requirements.requiredFields,key as RequiredField] : requirements.requiredFields.filter(k=>k!==key)})} /> {label}</label>)}</fieldset><fieldset><legend className="font-semibold">Tài liệu bổ sung bắt buộc</legend>{requirements.requiredDocuments.map((slot,index)=><div className="flex gap-2 items-end my-3" key={slot.key}><Input label="Tên tài liệu" value={slot.label} onChange={e=>setRequirements({...requirements,requiredDocuments:requirements.requiredDocuments.map((v,i)=>i===index ? {...v,label:e.target.value} : v)})} /><Button type="button" variant="ghost" onClick={()=>setRequirements({...requirements,requiredDocuments:requirements.requiredDocuments.filter((_,i)=>i!==index)})}>Bỏ vị trí</Button></div>)}<Button type="button" variant="secondary" disabled={requirements.requiredDocuments.length>=20} onClick={()=>setRequirements({...requirements,requiredDocuments:[...requirements.requiredDocuments,{key:`slot_${Date.now()}`,label:""}]})}>Thêm tài liệu bắt buộc</Button></fieldset><input type="hidden" name="parentTemplateId" value={parent?.id ?? ""} />
    <Select name="kind" label="Loại mẫu" defaultValue={source?.kind ?? "PROPOSAL"}>{Object.entries(TEMPLATE_KINDS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select><Input label="Tên mẫu" name="name" defaultValue={source?.name} required />
    <Input label="Danh mục nghiệp vụ" name="category" defaultValue={source?.category} /><Input label="Mục đích sử dụng" name="purpose" defaultValue={source?.purpose} /><Textarea label="Ghi chú thay đổi" name="changeNote" defaultValue={template?.changeNote} hint="Bắt buộc trước khi công bố phiên bản mới." /><div className="grid gap-3 sm:grid-cols-3"><PersonField users={users} name="ownerId" label="Owner nội dung" value={source?.ownerId} /><PersonField users={users} name="accountantId" label="Kế toán rà soát" value={source?.accountantId} /><PersonField users={users} name="ceoId" label="CEO duyệt cuối" value={source?.ceoId} /></div>
    <Input label="Người / bên ký theo mẫu" name="signerNames" defaultValue={source?.signerNames} /><Textarea label="Hướng dẫn / trường và tài liệu bắt buộc" name="instructions" defaultValue={source?.instructions} /><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="requiresExecutionTracking" value="yes" defaultChecked={source?.requiresExecutionTracking ?? false} />Sau khi đủ bằng chứng ký, Quản lý bắt đầu theo dõi thực hiện ngoài đời thực.</label><UploadField label="File mẫu công ty" />{source?.fileId && <Link className="tf-link" href={fileHref(source.fileId)}>Tải file mẫu đã lưu</Link>}<p className="tf-ui-help">Sửa nháp bỏ xác nhận nội dung cũ. Cần file thật, owner xác nhận, người duyệt và người ký trước khi công bố.</p>
  </Form>;
}
function DocumentEditor({ templates, projects, document, parent, initialTemplateId }: { templates: Template[]; projects: Person[]; document?: Document; parent?: Document; initialTemplateId?: string }) {
  const editorId = useId();
  const prefix = document ? `wf-${document.id}` : `wf-${editorId}`;
  const source = document ?? parent;
  const [templateId, setTemplateId] = useState(source?.templateId ?? initialTemplateId ?? "");
  const selected = templates.find(t => t.id === templateId) ?? document?.template;
  const config = effectiveRequirements(selected?.requirements);
  const [values,setValues] = useState({content:source?.payload.content ?? "",counterparty:source?.payload.counterparty ?? "",amount:source?.payload.amount ?? "",linkedRequestId:source?.payload.linkedRequestId ?? ""});
  const missing = selected ? evaluateDocumentCompleteness(config,{...values,mainFileId:document?.payload.mainFileId,supportingFiles:document?.payload.supportingFiles}) : [];
  const mark = (key:RequiredField) => config.requiredFields.includes(key) ? "Bắt buộc khi gửi" : undefined;
  return <Form command="SAVE_DOCUMENT" requestId={document?.id} version={document?.version} label="Lưu nháp" redirectAfterSave>{selected && <Alert tone={missing.length ? "warning" : "success"} title={missing.length ? "Cần bổ sung trước khi gửi" : "Đã đủ dữ liệu được lưu để gửi"}>{selected.requirements == null && <p>Chính sách mẫu cũ: nội dung và tài liệu chính.</p>}<ul>{missing.map(m=><li key={m.key}>{!document && effectiveRequirements(selected.requirements).requiredDocuments.some(slot=>slot.key===m.key) ? <span>{m.label} · Lưu nháp trước để tải tài liệu</span> : <a className="tf-link" href={`#${prefix}-${m.key}`} onClick={e=>{e.preventDefault();window.document.getElementById(`${prefix}-${m.key}`)?.focus();}}>{m.label}</a>}</li>)}</ul></Alert>}<input type="hidden" name="parentRequestId" value={parent?.id ?? ""} />
    <Select label="Mẫu đã công bố" name="templateId" required value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">Chọn mẫu</option>{(document?.template ? [document.template] : templates.filter(t => t.publishedAt)).map(t => <option key={t.id} value={t.id}>{t.name} · v{t.version}</option>)}</Select>{selected && <Alert title={`${selected.name} · v${selected.version}`}><p>{selected.purpose || "Chưa có mô tả mục đích"}</p><p className="whitespace-pre-wrap my-2">{selected.instructions}</p>{selected.fileId && <Link className="tf-link" href={fileHref(selected.fileId)}>Tải mẫu</Link>}</Alert>}<Input name="title" label="Tên hồ sơ" defaultValue={source?.title} required /><Textarea name="content" label="Nội dung đề nghị" hint={mark("content")} id={`${prefix}-content`} value={values.content} onChange={e=>setValues({...values,content:e.target.value})} aria-invalid={missing.some(m=>m.key==="content")} />
    <Select label="Project (không bắt buộc)" name="projectId" defaultValue={source?.projectId ?? ""}><option value="">Hồ sơ nội bộ độc lập</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
    <div className="grid gap-3 sm:grid-cols-2"><Input label="Đối tác / đơn vị liên quan" hint={mark("counterparty")} name="counterparty" id={`${prefix}-counterparty`} value={values.counterparty} onChange={e=>setValues({...values,counterparty:e.target.value})} aria-invalid={missing.some(m=>m.key==="counterparty")} /><Input label="Giá trị VND (nếu có)" name="amount" id={`${prefix}-amount`} value={values.amount} onChange={e=>setValues({...values,amount:e.target.value})} aria-invalid={missing.some(m=>m.key==="amount")} inputMode="decimal" hint={`${mark("amount") ?? ""} · Không nhập dấu phân cách hàng nghìn.`} /></div>
    <Input label="Mã hồ sơ liên quan (nếu có)" name="linkedRequestId" id={`${prefix}-linkedRequestId`} value={values.linkedRequestId} onChange={e=>setValues({...values,linkedRequestId:e.target.value})} aria-invalid={missing.some(m=>m.key==="linkedRequestId")} hint={`${mark("linkedRequestId") ?? ""} · Chỉ liên kết hồ sơ bạn được đọc.`} />{parent && <Textarea name="resubmissionResponse" label="Phản hồi chung cho lần gửi lại" defaultValue={document?.payload.resubmission?.response} hint="Có thể lưu nháp khi chưa điền; bắt buộc trước khi gửi lại." />}<UploadField id={`${prefix}-main`} />{document?.payload.mainFileId && <Link className="tf-link" href={fileHref(document.payload.mainFileId)}>Tài liệu chính đã lưu</Link>}{parent && <p className="tf-ui-help">Bản mới liên kết hồ sơ cũ; tải lại tài liệu chính cần trình. Quyết định và bản ký cũ được giữ.</p>}
  </Form>;
}
export function WorkflowPanel({ data, user }: { data: ListData; user: { id: string; role: string } }) {
  const [tab, setTab] = useState("requests");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [filter, setFilter] = useState<"pending" | "processed" | "mine">("pending");
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const names = (id: string) => data.users.find(p => p.id === id)?.name ?? "Chưa phân công";
  const filtered = [...data.views[filter]].filter(r => `${r.title} ${r.code} ${r.project?.name ?? ""}`.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi"))).sort((a,b) => {
    const left = a.currentStepArrivedAt ? new Date(a.currentStepArrivedAt).getTime() : Number.MAX_SAFE_INTEGER;
    const right = b.currentStepArrivedAt ? new Date(b.currentStepArrivedAt).getTime() : Number.MAX_SAFE_INTEGER;
    return (sort === "oldest" ? left-right : right-left) || a.id.localeCompare(b.id);
  });
  const safePage = Math.min(page,Math.max(0,Math.ceil(filtered.length / 12) - 1));
  return <div><header className="tf-module-header"><div className="tf-module-breadcrumb"><Link href="/">Không gian làm việc</Link><ChevronRight size={12} aria-hidden="true" /><span>Workflow</span></div><div className="tf-module-heading"><div className="tf-module-identity"><span className="tf-module-mark"><FileCheck2 size={24} aria-hidden="true" /></span><div><h1 className="tf-module-title">Hồ sơ & phê duyệt</h1><p className="tf-module-description">Tờ trình, hợp đồng và hồ sơ tài chính trong một hàng chờ.</p></div></div><Button onClick={() => setTab("new")}><Plus size={16} aria-hidden="true" />Lập hồ sơ</Button></div><ModuleTabs label="Workflow" tabs={[{id:"requests",label:"Hồ sơ"},{id:"new",label:"Lập hồ sơ"},{id:"catalog",label:"Danh mục mẫu"},{id:"templates",label:"Mẫu & phân công"}]} active={tab} onChange={setTab} /></header><div className="tf-module-page space-y-6">
    {tab === "requests" && <><Panel><div className="tf-section-heading"><div><h2>Danh sách hồ sơ</h2><p>Hồ sơ được lọc ở server theo quyền đọc và hành động của bạn.</p></div></div><div className="tf-module-toolbar mb-5"><div className="flex flex-wrap gap-1">{[["pending","Chờ tôi xử lý"],["processed","Tôi đã xử lý"],["mine","Hồ sơ tôi lập"]].map(([id,label]) => <Button key={id} size="sm" variant={filter === id ? "secondary" : "ghost"} aria-pressed={filter === id} onClick={() => {setFilter(id as typeof filter);setPage(0);}}>{label}</Button>)}</div><div className="flex flex-wrap gap-2"><Select aria-label="Sắp xếp hàng chờ" value={sort} onChange={e=>{setSort(e.target.value as typeof sort);setPage(0);}}><option value="oldest">Đến bước lâu nhất</option><option value="newest">Mới đến bước</option></Select><input type="search" aria-label="Tìm hồ sơ" className="tf-field" placeholder="Tìm tên, mã hoặc project…" value={query} onChange={e => {setQuery(e.target.value);setPage(0);}} /></div></div>{filtered.length ? <><div className="overflow-x-auto"><Table caption="Hồ sơ và người đang xử lý"><thead><tr><th scope="col">Hồ sơ</th><th scope="col">Phạm vi</th><th scope="col">Người lập / gửi</th><th scope="col">Bước hiện tại</th><th scope="col"><span className="sr-only">Mở hồ sơ</span></th></tr></thead><tbody>{filtered.slice(safePage * 12,(safePage + 1) * 12).map(r => <tr key={r.id}><td><Link className="tf-inbox-row-title" href={requestHref(r)}>{r.title}</Link><span className="tf-list-meta">{r.code} · {r.module === "COSTFLOW" ? "CostFlow" : TEMPLATE_KINDS[r.kind as keyof typeof TEMPLATE_KINDS]}{r.resubmission ? " · Gửi lại" : ""}</span></td><td>{r.project?.name ?? "Nội bộ độc lập"}<span className="tf-list-meta">{STATES[r.state]}</span></td><td>{names(r.creatorId)}<span className="tf-list-meta">{new Date(r.createdAt).toLocaleString("vi-VN")} · Lần {r.attemptNumber}</span></td><td>{r.state === "SUBMITTED" ? <><span>{ROLES[r.currentRole ?? ""] ?? "Người xử lý"} · {names(r.currentAssigneeId ?? "")}</span><span className="tf-list-meta">{r.currentStepArrivedAt ? `Đến bước ${new Date(r.currentStepArrivedAt).toLocaleString("vi-VN")}` : "Chưa xác định thời điểm đến bước"}</span></> : <Badge tone={r.state === "APPROVED" ? "success" : r.state === "RETURNED" ? "warning" : "neutral"}>{STATES[r.state]}</Badge>}</td><td><div className="flex items-center justify-end gap-2">{filter === "pending" && r.currentAttemptId && r.submittedVersion !== null && <WorkflowDecisionDialog request={r} />}<Link href={requestHref(r)} aria-label={`Mở ${r.title}`} className="tf-link"><ChevronRight size={16} aria-hidden="true" /></Link></div></td></tr>)}</tbody></Table></div><div className="tf-module-toolbar mt-5 border-t border-zinc-100 pt-4"><span className="tf-list-meta">{safePage * 12 + 1}–{Math.min((safePage + 1) * 12,filtered.length)} / {filtered.length} hồ sơ</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Trước</Button><Button variant="secondary" size="sm" disabled={(safePage + 1) * 12 >= filtered.length} onClick={() => setPage(safePage + 1)}>Sau</Button></div></div></> : <EmptyState title={query ? "Không có hồ sơ phù hợp" : filter === "pending" ? "Không có hồ sơ đang chờ bạn" : filter === "processed" ? "Bạn chưa xử lý hồ sơ nào" : "Bạn chưa lập hồ sơ"} description="Đổi tab hoặc từ khóa tìm kiếm để xem hồ sơ khác." />}</Panel><p className="tf-list-meta">Duyệt, ký, thực hiện và tiền là các trạng thái riêng. Nhắc việc chưa bật.</p></>}
    {tab === "new" && <div className="tf-workspace-grid"><Panel><div className="tf-section-heading"><div><h2>Lập tờ trình / hợp đồng</h2><p>Lưu nháp và tài liệu chính trước khi gửi duyệt.</p></div></div>{data.templates.some(t => t.publishedAt) ? <DocumentEditor key={selectedTemplate} initialTemplateId={selectedTemplate} templates={data.templates} projects={data.projects} /> : <EmptyState title="Chưa có mẫu được công bố" description="Admin tải mẫu thật, phân công owner và người duyệt; owner xác nhận trước khi công bố." />}</Panel><aside className="tf-summary-card"><FilePlus2 size={22} className="mb-4 text-brand-700" aria-hidden="true" /><h3>Quy trình xử lý</h3><ol className="mt-4 space-y-4 text-sm"><li>1. Người lập lưu và gửi hồ sơ</li><li>2. Quản lý trực tiếp duyệt</li><li>3. Kế toán kiểm tra hồ sơ</li><li>4. CEO duyệt cuối</li></ol><p className="tf-ui-help mt-5">Bản gửi giữ đúng mẫu, nội dung và file. Duyệt xong mới theo dõi ký giấy.</p></aside></div>}
    {tab === "catalog" && <div className="space-y-5">{!data.templates.length && <EmptyState title="Chưa có mẫu được công bố" description="Admin cần cấu hình và công bố mẫu sau khi owner xác nhận." />}{[...new Set(data.templates.map(t => t.category || "Chưa phân danh mục"))].map(category => <section key={category}><h2 className="mb-4 text-xl font-semibold">{category}</h2><div className="tf-template-grid">{data.templates.filter(t => (t.category || "Chưa phân danh mục") === category).map(t => <Panel key={t.id}><h3 className="font-semibold">{t.name} · v{t.version}</h3><p className="my-3 text-sm">{t.purpose || "Chưa có mô tả mục đích"}</p><details className="my-3"><summary className="cursor-pointer tf-link">Xem hướng dẫn</summary><p className="whitespace-pre-wrap my-3">{t.instructions}</p><p className="tf-ui-help">Thông tin bắt buộc: {effectiveRequirements(t.requirements).requiredFields.map(key=>FIELD_LABELS[key]).join(", ") || "Không có trường bổ sung"}. Tài liệu: Tài liệu chính{effectiveRequirements(t.requirements).requiredDocuments.map(slot=>`, ${slot.label}`).join("")}.</p></details><div className="flex flex-wrap gap-4 items-center">{t.fileId && <Link className="tf-link" href={fileHref(t.fileId)}>Tải mẫu</Link>}<Button onClick={() => {setSelectedTemplate(t.id);setTab("new");}}>Lập hồ sơ</Button></div></Panel>)}</div></section>)}</div>}
    {tab === "templates" && <><div className="tf-section-heading"><div><h2>Mẫu quy trình & phân công</h2><p>Owner xác nhận nội dung, Admin công bố phiên bản. Văn bản do công ty soạn.</p></div><Badge>{Object.keys(TEMPLATE_KINDS).length} loại hồ sơ</Badge></div>{data.admin && <Panel><details><summary className="cursor-pointer text-sm font-semibold">+ Thêm mẫu quy trình</summary><div className="mt-5"><TemplateEditor users={data.users} /></div></details></Panel>}{!data.templates.length && <EmptyState title="Chưa cấu hình mẫu" />}<div className="tf-template-grid">{data.managedTemplates.map(t => <Panel key={`${t.id}:${t.revision}`}><div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><p className="tf-list-meta mb-2">{TEMPLATE_KINDS[t.kind as keyof typeof TEMPLATE_KINDS]}</p><h2 className="font-semibold break-words">{t.name} · v{t.version}</h2><p className="tf-ui-help">Owner: {names(t.ownerId)} · Kế toán: {names(t.accountantId)} · CEO: {names(t.ceoId)}</p></div><Badge tone={t.publishedAt ? "success" : "warning"}>{t.publishedAt ? "Đã công bố" : t.ownerConfirmedAt ? "Owner đã xác nhận" : "Chưa công bố"}</Badge></div>{t.fileId && <Link className="tf-link" href={fileHref(t.fileId)}>Tải file mẫu</Link>}<p className="my-2 whitespace-pre-wrap text-sm">{t.instructions || "Chưa có hướng dẫn"}</p><p className="tf-ui-help">Người/bên ký: {t.signerNames || "Chưa khai báo"}</p>
      {!t.publishedAt && data.admin && <details className="my-4"><summary className="cursor-pointer font-medium">Sửa cấu hình mẫu nháp</summary><div className="mt-3"><TemplateEditor template={t} users={data.users} /></div></details>}{!t.publishedAt && t.ownerId === user.id && <div className="mt-3"><Form command="CONFIRM_TEMPLATE" templateId={t.id} version={t.revision} label="Owner xác nhận nội dung" /></div>}{!t.publishedAt && data.admin && <div className="mt-3"><Form command="PUBLISH_TEMPLATE" templateId={t.id} version={t.revision} label="Công bố mẫu" /></div>}{t.publishedAt && data.admin && <details className="mt-3"><summary className="cursor-pointer font-medium">Tạo phiên bản mẫu mới</summary><div className="mt-3"><TemplateEditor parent={t} users={data.users} /></div></details>}
    </Panel>)}</div></>}
  </div></div>;
}

export function WorkflowDocumentPanel({ detail, templates, projects, user, submission }: { submission?: Submission; detail: Detail; templates: Template[]; projects: Person[]; user: { id: string; role: string } }) {
  const r = detail.request; const body = r.payload; const current = r.steps[r.currentStep]; const owner = r.creatorId === user.id;
  const canAddReference = owner || body.responsibleManagerId === user.id || body.templateSnapshot?.accountantId === user.id;
  const name = (id: string) => detail.users.find(p => p.id === id)?.name ?? "Người xử lý";
  const [blankOpen,setBlankOpen] = useState(false);
  const [signPadOpen, setSignPadOpen] = useState(false);
  const [eSignedData, setESignedData] = useState<string | null>(null);
  const latestTemplate = templates.find(t=>t.familyId === r.template?.familyId);
  const outdated = r.state === "DRAFT" && latestTemplate && latestTemplate.id !== r.templateId;
  const selector = submission && <Select label="Lần gửi" value={submission.selection} onChange={e=>window.location.assign(e.target.value === "current" ? workflowDocumentHref(submission.currentRequestId) : `${workflowDocumentHref(submission.currentRequestId)}?attempt=${encodeURIComponent(e.target.value)}`)}><option value="current">Bản hiện tại</option>{submission.attempts.map(a=><option key={a.id} value={a.id}>Lần gửi {a.number} · {new Date(a.createdAt).toLocaleString("vi-VN")}</option>)}</Select>;
  if (submission?.historical) return <div className="tf-module-page space-y-5"><h1 className="tf-module-title">{r.title}</h1>{selector}<Alert tone="warning" title="Đang xem bản đã gửi"><p>Nội dung và tài liệu được giữ theo lần gửi này. Chỉ đọc.</p><Link className="tf-link" href={workflowDocumentHref(submission.currentRequestId)}>Về bản hiện tại</Link></Alert>{submission.legacyMissingManifest && <Alert tone="warning" title="Bản cũ chưa có danh sách tài liệu đóng băng">Không xác minh được bộ tệp của lần gửi. Không thay bằng file hiện tại.</Alert>}<Panel><h2 className="font-semibold">Nội dung đã gửi</h2><p className="whitespace-pre-wrap my-3">{body.content}</p><p>{body.counterparty}</p>{body.amount && <p>Giá trị: {body.amount} VND</p>}<p className="my-3">Mẫu {body.templateSnapshot?.name} · v{body.templateSnapshot?.version}</p><p className="whitespace-pre-wrap">{body.templateSnapshot?.instructions}</p></Panel><DocumentFiles document={r} historical /></div>;
  const selfRoles = r.steps.filter(s => s.assigneeId === user.id).length + Number(owner);
  return <div><header className="tf-module-header"><div className="tf-module-breadcrumb"><Link href={WORKFLOW_HUB_HREF}>Hồ sơ & Trình duyệt</Link><ChevronRight size={12} aria-hidden="true" /><span>Chi tiết</span></div><div className="tf-module-heading"><div className="tf-module-identity"><span className="tf-module-mark"><FileCheck2 size={24} aria-hidden="true" /></span><div><h1 className="tf-module-title">{r.title}</h1><p className="tf-module-description">{r.project?.name ?? "Nội bộ độc lập"} · {TEMPLATE_KINDS[r.kind as keyof typeof TEMPLATE_KINDS]}</p></div></div><Badge tone={r.state === "APPROVED" ? "success" : "neutral"}>{STATES[r.state]}</Badge></div></header><div className="tf-module-page space-y-5"><div className="tf-module-toolbar"><p className="tf-list-meta">Phiên bản {r.version} · Mẫu {body.templateSnapshot?.name ?? r.template?.name} v{body.templateSnapshot?.version ?? r.template?.version}</p><div className="flex flex-wrap gap-2"><Badge tone={body.signature?.state === "CONFIRMED" ? "success" : "neutral"}>{body.signature?.state === "CONFIRMED" ? "Đã xác nhận đủ bản ký" : body.signature ? "Bản ký chờ Quản lý xác nhận" : "Chưa ký"}</Badge><Badge>Chưa xác nhận thực hiện hoàn tất</Badge></div></div>
    {selector}
    {r.pendingReplacementRequestId && <Alert title="Đang có bản thay thế chờ duyệt">Bản này vẫn là bản hiện hành cho tới khi bản thay thế hoàn tất toàn bộ vòng duyệt.</Alert>}
    {r.replacedByRequestId && <Alert tone="warning" title="Đã được thay thế"><Link className="tf-link" href={workflowDocumentHref(r.replacedByRequestId)}>Mở bản thay thế đã duyệt</Link></Alert>}
    {outdated && <Alert tone="warning" title="Mẫu này đã có phiên bản mới"><p>Nháp đang dùng v{r.template?.version}; mẫu hiện tại v{latestTemplate.version}.</p><p className="my-2">{latestTemplate.changeNote || "Chưa có ghi chú thay đổi"}</p>{latestTemplate.fileId && <Link className="tf-link" href={fileHref(latestTemplate.fileId)}>Tải mẫu mới</Link>}<p className="my-3">Bạn cần điền lại thông tin và tải lại tệp. Nháp cũ được giữ nguyên.</p>{owner && <Button onClick={()=>setBlankOpen(true)}>Tạo nháp theo mẫu mới</Button>}</Alert>}
    {blankOpen && outdated && <Panel><h2 className="font-semibold mb-3">Nháp mới · v{latestTemplate.version}</h2><DocumentEditor key={latestTemplate.id} initialTemplateId={latestTemplate.id} templates={templates} projects={projects}/><Button variant="ghost" onClick={()=>setBlankOpen(false)}>Đóng form nháp mới</Button></Panel>}
    {selfRoles > 1 && <Alert tone="warning" title="Bạn tham gia nhiều vai trò">Mỗi bước cần quyết định riêng, hệ thống không tự bỏ bước.</Alert>}{r.parentId && <Link className="tf-link" href={workflowDocumentHref(r.parentId)}>Xem hồ sơ nguồn của bản trình lại</Link>}
    {!blankOpen && (r.state === "DRAFT" && owner ? <Panel><h2 className="mb-3 font-semibold">Sửa nháp</h2><DocumentEditor document={r} templates={templates} projects={projects} /><div className="my-5 space-y-4">{effectiveRequirements(r.template?.requirements).requiredDocuments.map(slot=><section key={slot.key} id={`wf-${r.id}-${slot.key}`} tabIndex={-1}><h3 className="font-semibold">{slot.label} · Bắt buộc khi gửi</h3>{body.supportingFiles?.[slot.key] && <Link className="tf-link" href={fileHref(body.supportingFiles[slot.key])}>Tài liệu đã lưu</Link>}<Form command="ADD_SUPPORTING_DOCUMENT" requestId={r.id} version={r.version} label="Lưu tài liệu bắt buộc"><input type="hidden" name="supportingSlot" value={slot.key}/><UploadField label={slot.label} required /></Form></section>)}</div><div className="mt-5 border-t pt-4"><SubmitDocumentForm request={r} /></div></Panel> : <Panel><h2 className="mb-3 font-semibold">Nội dung đã trình</h2><p className="whitespace-pre-wrap">{body.content}</p>{body.counterparty && <p className="mt-3">Đối tác: {body.counterparty}</p>}{body.amount && <p>Giá trị: {body.amount} VND</p>}<p className="tf-ui-help mt-3 whitespace-pre-wrap">{body.templateSnapshot?.instructions}</p>{body.mainFileId && <Link className="tf-link mt-3 inline-block" href={fileHref(body.mainFileId)}>Tải tài liệu chính đúng bản</Link>}{detail.linked && <p className="mt-3"><Link className="tf-link" href={requestHref(detail.linked)}>Hồ sơ liên quan: {detail.linked.title}</Link></p>}</Panel>)}
    {r.state === "SUBMITTED" && <Panel><h2 className="mb-3 font-semibold">Đang chờ {ROLES[current?.role]} · {name(current?.assigneeId)}</h2>{current?.assigneeId === user.id && <WorkflowDecisionDialog request={r} />}{owner && <details className="mt-4"><summary className="cursor-pointer">Rút hồ sơ đang trình</summary><div className="mt-3"><Form command="DECIDE_DOCUMENT" requestId={r.id} request={r} version={r.version} label="Rút hồ sơ"><input type="hidden" name="decision" value="WITHDRAW" /><Textarea name="reason" label="Lý do rút" required /></Form></div></details>}</Panel>}
    {owner && r.state === "APPROVED" && !r.pendingReplacementRequestId && !r.replacedByRequestId && <Panel><details><summary className="cursor-pointer font-semibold">Tạo bản sửa đổi và trình lại từ đầu</summary><div className="mt-4"><Form command="REVISE_DOCUMENT" requestId={r.id} version={r.version} label="Tạo bản sửa đổi sạch" redirectAfterSave confirmMessage="Hồ sơ này đã được phê duyệt. Bạn có chắc chắn muốn tạo bản sửa đổi mới? Việc này sẽ bắt đầu lại toàn bộ quy trình duyệt 4 cấp."><Textarea name="postSigningReason" label="Lý do sửa đổi sau duyệt / sau ký" required={["DIGITAL_CONFIRMED", "PHYSICAL_CONFIRMED"].includes(r.signingEvidenceState ?? "")} hint="Bản mới chỉ kế thừa trường nghiệp vụ cho phép; tài liệu, chữ ký, scan, QR và trạng thái cũ không được sao chép." /></Form></div></details></Panel>}
    {owner && ["RETURNED", "WITHDRAWN", "REJECTED"].includes(r.state) && <Panel><details><summary className="cursor-pointer font-semibold">Tạo bản mới để sửa / trình lại</summary><div className="mt-4"><DocumentEditor parent={r} templates={templates} projects={projects} /></div></details></Panel>}
    <DocumentFiles document={r} />{canAddReference && ["APPROVED", "REPLACED"].includes(r.state) && <Panel><details><summary className="cursor-pointer">Bổ sung tài liệu tham khảo</summary><div className="mt-3"><Form command="ADD_REFERENCE" requestId={r.id} version={r.version} label="Lưu file tham khảo"><UploadField label="File tham khảo" required /></Form></div></details></Panel>}
    {r.state === "APPROVED" && body.templateSnapshot?.requiresExecutionTracking && <Panel><div className="tf-section-heading"><div><h2>Theo dõi thực hiện</h2><p>Chỉ bắt đầu sau khi hồ sơ có bằng chứng ký hoàn tất. Giao việc, nộp bằng chứng và nghiệm thu chi tiết thuộc Phase 11.</p></div><Badge tone={body.execution?.startedAt ? "success" : "warning"}>{body.execution?.startedAt ? "Đang thực hiện" : "Chưa bắt đầu"}</Badge></div>{!body.execution?.startedAt && body.responsibleManagerId === user.id && ["DIGITAL_CONFIRMED", "PHYSICAL_CONFIRMED"].includes(r.signingEvidenceState ?? "") && <Form command="START_EXECUTION" requestId={r.id} version={r.version} label="Bắt đầu theo dõi thực hiện" />}</Panel>}
    {r.state === "APPROVED" && body.cancellation?.status === "PENDING" && <Alert tone="warning" title="Đang chờ Quản lý quyết định yêu cầu hủy">Ký và bắt đầu thực hiện đang được giữ. Lý do: {body.cancellation.reason}</Alert>}
    {r.state === "APPROVED" && owner && !body.signature && !body.execution?.startedAt && body.cancellation?.status !== "PENDING" && <Panel><details><summary className="cursor-pointer font-semibold">Yêu cầu hủy hồ sơ đã duyệt</summary><div className="mt-3"><Form command="REQUEST_DOCUMENT_CANCEL" requestId={r.id} request={r} version={r.version} label="Gửi yêu cầu hủy"><Textarea name="reason" label="Lý do yêu cầu hủy" required /></Form></div></details></Panel>}
    {r.state === "APPROVED" && body.cancellation?.status === "PENDING" && body.responsibleManagerId === user.id && <Panel><h2 className="mb-3 font-semibold">Quyết định yêu cầu hủy</h2><Form command="DECIDE_DOCUMENT_CANCEL" requestId={r.id} request={r} version={r.version} label="Lưu quyết định hủy"><Select name="cancelDecision" label="Kết quả"><option value="CONFIRM">Xác nhận hủy</option><option value="REJECT">Không chấp nhận hủy</option></Select><Textarea name="reason" label="Lý do quyết định" required /></Form></Panel>}
    {r.state === "APPROVED" && (
      <Panel>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-[var(--border)]">
          <div>
            <h2 className="font-semibold text-[var(--foreground)] text-base">Ký hồ sơ & Bản lưu trữ văn bản</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Người/bên ký theo mẫu: <span className="font-medium text-[var(--foreground)]">{body.templateSnapshot?.signerNames || "Chưa quy định"}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={workflowPrintHref(r.id)}
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--info)] bg-[var(--info-soft)] border border-[var(--border)] rounded-lg hover:bg-[var(--surface-muted)] transition-colors"
            >
              <Printer size={13} aria-hidden="true" />
              In / Lưu PDF biểu mẫu A4
            </Link>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--success)] bg-[var(--success-soft)] border border-[var(--border)] rounded-lg">
              <ShieldCheck size={13} aria-hidden="true" />
              QR an toàn nằm trên bản in đã duyệt
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Track 1: Ký số nội bộ */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Ký duyệt số</span>
                <Badge tone={eSignedData ? "success" : "neutral"}>
                  {eSignedData ? "Đã ký số (Xem trước)" : "Chưa ký số"}
                </Badge>
              </div>
              <h3 className="font-semibold text-[var(--foreground)] text-sm mb-1">Ký duyệt điện tử (E-Sign)</h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
                Ký tay trực tiếp trên màn hình cảm ứng, tái sử dụng chữ ký mẫu hồ sơ hoặc tải ảnh chữ ký đã lọc nền trong suốt.
              </p>
              {eSignedData && (
                <div
                  className="mb-3 p-2 rounded-lg border flex items-center gap-3"
                  style={{ backgroundColor: "var(--success-soft)", borderColor: "var(--border)" }}
                >
                  <div className="w-16 h-10 bg-white rounded border border-[var(--border)] flex items-center justify-center p-1 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={eSignedData} alt="Chữ ký đã chọn" className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="text-xs">
                    <p className="font-medium text-[var(--success)]">Chữ ký điện tử sẵn sàng</p>
                    <p className="text-[var(--text-secondary)] text-xs">{name(user.id)} · Sẵn sàng xác nhận</p>
                  </div>
                </div>
              )}
            </div>
            <div className="pt-2">
              <Button
                variant={eSignedData ? "ghost" : "primary"}
                className="w-full text-xs py-2"
                onClick={() => setSignPadOpen(true)}
              >
                <PenTool size={13} className="mr-1.5" />
                {eSignedData ? "Đổi chữ ký điện tử khác" : "Ký duyệt điện tử ngay"}
              </Button>
            </div>
          </div>

          {/* Track 2: In biểu mẫu & Ký giấy vật lý */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Ký giấy vật lý</span>
                <Badge tone="neutral">Biểu mẫu chuẩn A4</Badge>
              </div>
              <h3 className="font-semibold text-[var(--foreground)] text-sm mb-1">In bản giấy & Quét lưu trữ</h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
                In bản A4 có đóng dấu mã QR xác thực bảo mật để thu thập chữ ký sống, sau đó tải tệp scan lên để hoàn tất lưu trữ.
              </p>
            </div>
            <div className="pt-2">
              <Link
                href={workflowPrintHref(r.id)}
                target="_blank"
                className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-semibold text-[var(--foreground)] bg-white border border-[var(--border)] rounded-lg hover:bg-[var(--surface-muted)] transition-colors text-center"
              >
                <Printer size={13} aria-hidden="true" />
                Mở bản in A4 để ký giấy
              </Link>
            </div>
          </div>
        </div>

        {signPadOpen && (
          <SignaturePad
            open={signPadOpen}
            onClose={() => setSignPadOpen(false)}
            onConfirm={(dataUrl) => {
              setESignedData(dataUrl);
              setSignPadOpen(false);
            }}
            userName={name(user.id)}
            userRoleTitle={user.role}
            title={`Ký xác nhận hồ sơ — ${r.title}`}
          />
        )}
      </Panel>
    )}
    {r.state === "APPROVED" && r.signingMode === "PHYSICAL" && <PaperSigningSection requestId={r.id} version={r.version} creator={owner} manager={body.responsibleManagerId === user.id} batches={r.physicalScanBatches ?? []} />}
    {detail.canTransfer && r.currentAttemptId && <Panel><details><summary className="cursor-pointer font-semibold">Chuyển giao xử lý</summary><div className="mt-3"><Form command="TRANSFER_DOCUMENT" requestId={r.id} request={r} version={r.version} label="Chuyển giao"><Select name="target" label="Phần việc"><option value="STEP">Bước duyệt đang chờ</option><option value="SIGNATURE">Quản lý xác nhận bản ký</option></Select><PersonField users={detail.users} label="Người nhận" name="assigneeId" /><Textarea label="Lý do chuyển giao" name="reason" required /></Form></div></details></Panel>}
    <Panel><h2 className="mb-3 font-semibold">Lịch sử quyết định</h2>{r.decisions.map(d => <p className="my-2 text-sm" key={d.id}>{name(d.actorId)} · {ACTIONS[d.action] ?? d.action} · {new Date(d.createdAt).toLocaleString("vi-VN")}{d.reason && ` · ${d.reason}`}</p>)}<details className="mt-3"><summary className="cursor-pointer">Lịch sử phiên bản ({r.history.length})</summary>{r.history.map(h => <p className="my-2 text-sm" key={h.id}>v{h.version} · {ACTIONS[h.action] ?? h.action} · {name(h.actorId)} · {new Date(h.createdAt).toLocaleString("vi-VN")}</p>)}</details></Panel>
  </div></div>;
}
function DocumentFiles({document:r,historical=false}:{document:Document;historical?:boolean}) {
 const body=r.payload;const main=historical ? body.submittedFiles?.mainFileId : body.mainFileId;const supporting=historical ? body.submittedFiles?.supportingFiles : body.supportingFiles;
 return <Panel><h2 className="font-semibold mb-4">Tài liệu của hồ sơ</h2>{[["MAIN","Tài liệu chính"],["SUPPORTING","Tài liệu bắt buộc bổ sung"],["REFERENCE","Tham khảo"],["SIGNED","Bản ký"]].map(([kind,label])=>{const files=r.files.filter(f=>f.kind===kind && (kind==="MAIN" ? f.id===main : kind==="SUPPORTING" ? Object.values(supporting??{}).includes(f.id) : true));return <section key={kind} className="my-4"><h3 className="font-semibold text-sm">{label}</h3>{files.length ? <ul>{files.map(f=><li key={f.id} className="my-2 text-sm"><Link className="tf-link break-all" href={fileHref(f.id)}>{f.name}</Link><span className="block tf-ui-help">{Math.ceil(f.size/1024)} KB · Bổ sung {new Date(f.createdAt).toLocaleString("vi-VN")}{historical && kind==="REFERENCE" && !body.submittedFiles?.referenceFileIds.includes(f.id) ? " · Bổ sung sau lần gửi" : ""}</span></li>)}</ul> : <p className="tf-ui-help">Chưa có tài liệu.</p>}{kind==="REFERENCE" && <p className="tf-ui-help">Các tài liệu tham khảo được liệt kê cùng ngày bổ sung; bộ tệp lúc gửi được giữ riêng.</p>}</section>})}</Panel>;
}
