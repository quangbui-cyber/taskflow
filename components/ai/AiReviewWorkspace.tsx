"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { completeAiReview, createDocumentIntakeDraft, getAiReviewSnapshot,
  listDocumentIntakeDrafts, prepareAiApplyConflicts, recordAiFieldReview } from "@/app/actions/ai/review";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel } from "@/components/ui/Presentation";
import AiApplyConflictReview, { type ConflictSnapshot } from "./AiApplyConflictReview";
import AiApplicationReceiptView, { type AiReceiptView } from "./AiApplicationReceiptView";
import type { AiRunView } from "./AiRunHistory";

type ReviewSnapshot = Awaited<ReturnType<typeof getAiReviewSnapshot>>;
type ReviewField = ReviewSnapshot["fields"][number];
type Draft = Awaited<ReturnType<typeof listDocumentIntakeDrafts>>[number];
type Choice = "ACCEPT_AI" | "CORRECT" | "MANUAL" | "REJECT";
const critical = /(?:vendor|supplier|identity|tax|number|date|issued|amount|gross|net|vat|price|quantity|poIds|lineage|source)/i;

function locator(field: ReviewField) {
  const span = field.sourceSpan;
  if (!span) return "Không có vị trí nguồn đọc được";
  if (span.sheetName) return `Sheet ${span.sheetName} · ô ${span.cellRange ?? "—"}`;
  if (span.pageNumber) return `Trang ${span.pageNumber}`;
  if (span.xmlPath) return `XML ${span.xmlPath}`;
  return `Đoạn ${span.textStart ?? "—"}–${span.textEnd ?? "—"}`;
}

function FieldReviewCard({ field, projectId, runId, onSaved, onAccessRevoked }: {
  field: ReviewField; projectId: string; runId: string; onSaved: () => Promise<void>; onAccessRevoked: () => void;
}) {
  const [choice, setChoice] = useState<Choice>(field.reviewStatus === "PENDING" ? field.aiValue === null ? "MANUAL" : "ACCEPT_AI" : field.reviewStatus as Choice);
  const [value, setValue] = useState(field.correctedValue ?? field.manualValue ?? "");
  const [reason, setReason] = useState(field.reason ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const score = Number(field.confidence);
  const confidence = Number.isFinite(score) ? score * (score <= 1 ? 100 : 1) : 0;
  const sourceHref = field.sourceSpan ? `/api/projects/${projectId}/ai/runs/${runId}/source/${field.sourceSpan.sourceRevisionId}${field.sourceSpan.pageNumber ? `#page=${field.sourceSpan.pageNumber}` : ""}` : null;
  async function save() {
    if (saving) return;
    if ((choice === "CORRECT" || choice === "MANUAL") && !value.trim()) { setError("Nhập giá trị trước khi lưu."); inputRef.current?.focus(); return; }
    if ((choice === "CORRECT" || choice === "MANUAL") && critical.test(field.fieldKey) && reason.trim().length < 3) {
      setError("Trường bắt buộc cần lý do chỉnh sửa ít nhất 3 ký tự."); document.getElementById(`reason-${field.id}`)?.focus(); return;
    }
    setSaving(true); setError("");
    try { await recordAiFieldReview({ projectId, runId, candidateFieldId: field.id, choice,
      value: choice === "CORRECT" || choice === "MANUAL" ? value : undefined, reason }); await onSaved(); }
    catch (cause) { if (cause instanceof Error && /not found|unauthor/i.test(cause.message)) onAccessRevoked();
      else setError(cause instanceof Error ? cause.message : "Không thể lưu rà soát."); }
    finally { setSaving(false); }
  }
  function blockComposingEnter(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  }
  return <Panel className="min-w-0 space-y-3" onKeyDown={blockComposingEnter}>
    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{field.rowKey !== "document" ? `${field.rowKey} · ` : ""}{field.fieldKey}</h3>
      <Badge tone={field.reviewStatus === "PENDING" ? "warning" : "info"}>{field.reviewStatus === "PENDING" ? "Cần rà soát" : "Đã rà soát"}</Badge>
      {critical.test(field.fieldKey) && <Badge tone="warning">Bắt buộc xác nhận</Badge>}</div>
    <p className="text-sm">{field.reviewStatus === "CORRECT" ? "Người dùng sửa" : field.reviewStatus === "MANUAL" ? "Người dùng nhập" : "AI trích xuất"}</p>
    <p className="break-words text-sm">Giá trị nguồn: {field.rawValue ?? "—"}<br />AI đề xuất: {field.aiValue ?? "—"}<br />
      Giá trị đã rà soát: {field.reviewStatus === "CORRECT" ? field.correctedValue : field.reviewStatus === "MANUAL" ? field.manualValue : field.reviewStatus === "ACCEPT_AI" ? field.aiValue : "—"}</p>
    <p className="tf-ui-help">{confidence >= 90 ? "Tin cậy cao" : confidence >= 60 ? "Cần xác nhận" : "Không ánh xạ"} · {Math.round(confidence)}%</p>
    <p className="break-words text-sm">Nguồn: {locator(field)}{field.sourceSpan?.quote && <> · “{field.sourceSpan.quote}”</>}</p>
    {sourceHref && <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="underline">Mở nguồn · {locator(field)}</a>}
    {field.reviewStatus === "PENDING" && <>
      <Select label="Quyết định rà soát" value={choice} onChange={(event) => { setChoice(event.target.value as Choice); setError(""); }}>
        <option value="ACCEPT_AI" disabled={field.aiValue === null}>Giữ đề xuất</option>
        <option value="CORRECT">Sửa giá trị</option><option value="MANUAL">Nhập thủ công</option><option value="REJECT">Loại đề xuất</option>
      </Select>
      {(choice === "CORRECT" || choice === "MANUAL") && <Input ref={inputRef} label={choice === "MANUAL" ? "Người dùng nhập" : "Người dùng sửa"}
        value={value} onChange={(event) => setValue(event.target.value)} error={error && !value.trim() ? error : undefined} />}
      {(choice === "CORRECT" || choice === "MANUAL") && <Textarea id={`reason-${field.id}`} label="Lý do chỉnh sửa"
        required={critical.test(field.fieldKey)} value={reason} onChange={(event) => setReason(event.target.value)}
        error={error && value.trim() ? error : undefined} />}
      {error && <p role="alert" className="tf-ui-error">{error}</p>}
      <Button variant="secondary" loading={saving} loadingLabel="Đang lưu…" onClick={save}>Lưu rà soát trường</Button>
    </>}
    {field.reviewedById && <p className="tf-ui-help">Người rà soát: {field.reviewedById} · {field.reviewedAt ? new Date(field.reviewedAt).toLocaleString("vi-VN") : ""}</p>}
  </Panel>;
}

export default function AiReviewWorkspace({ projectId, run, onAccessRevoked, onHistoryChange }: {
  projectId: string; run: AiRunView; onAccessRevoked: () => void; onHistoryChange: () => void;
}) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftId, setDraftId] = useState("");
  const [kind, setKind] = useState<"PO" | "VAT" | "IC">("PO");
  const [conflicts, setConflicts] = useState<ConflictSnapshot | null>(null);
  const [receipt, setReceipt] = useState<AiReceiptView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++requestId.current;
    try {
      const [next, available] = await Promise.all([
        getAiReviewSnapshot({ projectId, runId: run.id }), listDocumentIntakeDrafts({ projectId }),
      ]);
      if (current === requestId.current) { setSnapshot(next); setDrafts(available); setError(""); }
    } catch (cause) {
      if (current !== requestId.current) return;
      if (cause instanceof Error && /not found|unauthor/i.test(cause.message)) { setSnapshot(null); onAccessRevoked(); return; }
      setError("Không thể tải dữ liệu rà soát. Thử lại từ Lịch sử.");
    }
  }, [projectId, run.id, onAccessRevoked]);
  useEffect(() => { void Promise.resolve().then(refresh); return () => { requestId.current += 1; }; }, [refresh]);
  async function finishReview() {
    if (!snapshot || pending) return;
    setPending(true); setError("");
    try { await completeAiReview({ projectId, runId: run.id }); await refresh(); onHistoryChange(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Chưa thể hoàn tất rà soát."); }
    finally { setPending(false); }
  }
  async function createDraft() {
    if (kind === "IC") return;
    setPending(true); setError("");
    try { const created = await createDocumentIntakeDraft({ projectId, kind }); await refresh(); setDraftId(created.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tạo bản nháp."); }
    finally { setPending(false); }
  }
  async function showConflicts() {
    if (!draftId || pending) return;
    setPending(true); setError("");
    try { setConflicts(await prepareAiApplyConflicts({ projectId, runId: run.id, kind, draftId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Bản này không thể nhận thay đổi AI. Chọn bản nháp hợp lệ."); }
    finally { setPending(false); }
  }
  if (receipt) return <AiApplicationReceiptView receipt={receipt} projectId={projectId} />;
  if (conflicts) return <AiApplyConflictReview projectId={projectId} runId={run.id} kind={kind} draftId={draftId}
    snapshot={conflicts} onReceipt={setReceipt} onBack={() => setConflicts(null)} />;
  if (!snapshot) return <Panel><p role="status">{error || "Đang tải kết quả rà soát…"}</p></Panel>;
  const pendingCount = snapshot.fields.filter((field) => field.reviewStatus === "PENDING").length;
  const reviewable = snapshot.runStatus === "SUCCEEDED" && snapshot.fields.length > 0;
  return <section aria-label="Rà soát kết quả AI" className="min-w-0 space-y-4">
    <Panel className="space-y-2"><h2 className="tf-ui-heading">Rà soát Run {run.id.slice(0, 10)}</h2>
      <p>{snapshot.fields.length - pendingCount}/{snapshot.fields.length} trường đã rà soát · {pendingCount} trường còn lại</p>
      <p className="tf-ui-help">Nguồn: {run.sources.map((source) => `${source.filename} · SHA-256 ${source.sha256.slice(0, 12)}`).join("; ")}</p>
      {error && <Alert tone="danger" title="Cần xử lý">{error}</Alert>}
      {!reviewable && <Alert tone="warning" title="Chưa có kết quả có thể rà soát">Run {run.status}. Mở Lịch sử để xem trạng thái.</Alert>}
    </Panel>
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">{snapshot.fields.map((field) => <FieldReviewCard key={field.id}
      field={field} projectId={projectId} runId={run.id} onSaved={refresh} onAccessRevoked={onAccessRevoked} />)}</div>
    {reviewable && <Panel className="space-y-3">
      {snapshot.reviewStatus !== "COMPLETED" ? <><Button variant="primary" disabled={pendingCount > 0 || pending} onClick={finishReview}>Đã rà soát dữ liệu AI</Button>
        {pendingCount > 0 && <p className="tf-ui-help">Còn {pendingCount} trường chưa rà soát; phải xử lý tất cả trước khi hoàn tất.</p>}</> : <>
        <h2 className="tf-ui-heading">Áp dụng vào bản nháp</h2>
        <Select label="Loại bản nháp" value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setDraftId(""); }}>
          <option value="PO">PO</option><option value="VAT">Hóa đơn VAT</option><option value="IC">IC hiện có</option>
        </Select>
        {kind !== "IC" && <Button variant="secondary" disabled={pending} onClick={createDraft}>Tạo bản nháp {kind}</Button>}
        {kind === "IC" ? <Input label="Mã bản nháp IC đang có" value={draftId} onChange={(event) => setDraftId(event.target.value)} /> :
          <Select label="Bản nháp nhận dữ liệu" value={draftId} onChange={(event) => setDraftId(event.target.value)}>
            <option value="">Chọn bản nháp</option>{drafts.filter((draft) => draft.kind === kind && draft.status === "DRAFT").map((draft) =>
              <option key={draft.id} value={draft.id}>{draft.id} · v{draft.version}</option>)}
          </Select>}
        <Button variant="primary" disabled={!draftId || pending} onClick={showConflicts}>So sánh trước khi áp dụng</Button>
      </>}
    </Panel>}
    {snapshot.receipts.length > 0 && <div className="space-y-3"><h2 className="tf-ui-heading">Phiếu áp dụng trước đó</h2>
      {snapshot.receipts.map((item) => <AiApplicationReceiptView key={item.id} receipt={{ ...item, runId: run.id }} projectId={projectId} />)}</div>}
    {!reviewable && snapshot.fields.length === 0 && <EmptyState title="Chưa có trường đề xuất" description="Không có dữ liệu để rà soát trong run này." />}
  </section>;
}
