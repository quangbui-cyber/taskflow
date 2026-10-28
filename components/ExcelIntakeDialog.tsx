"use client";

import { useEffect, useReducer, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { confirmExcelIntakeAction } from "@/app/actions/costflowExcelIntake";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input as Field, Textarea } from "@/components/ui/Field";
import { Alert, Table } from "@/components/ui/Presentation";
import type { ExcelIntakePreview } from "@/lib/costflow/excelIntakeParser";
import { excelIntakeDiagnosticTargetId, type ExcelIntakeDiagnosticIdentity } from "@/lib/costflow/excelIntake";
import { createExcelPreviewState, reduceExcelPreviewState } from "@/lib/costflow/excelPreviewState";
import AiExcelMappingReview, { type MappingStage } from "@/components/ai/AiExcelMappingReview";
import type { ReviewedExcelMapping } from "@/lib/ai/excel/mapping";

const editableFields = [
  "sell.quantity", "sell.days", "sell.unitPrice", "sell.vatPercent", "sell.basis", "sell.note",
  "buy.quantity", "buy.days", "buy.unitPrice", "buy.vatPercent", "buy.basis", "buy.note", "buy.supplier",
] as const;
type EditableField = typeof editableFields[number];

function editableValue(row: ExcelIntakePreview["rows"][number], field: EditableField) {
  if (field === "buy.supplier") return row.buy.supplier;
  const [side, key] = field.split(".") as ["sell" | "buy", "quantity" | "days" | "unitPrice" | "vatPercent" | "basis" | "note"];
  return row[side][key];
}

type SessionView = {
  state: "ACTIONABLE" | "READ_ONLY_CONSUMED" | "NON_ACTIONABLE_EXPIRED" | "NON_ACTIONABLE_SUPERSEDED" | "NON_ACTIONABLE_CANCELLED";
  previewSessionId: string;
  expiresAt: string;
  operationKind: "NEW_DRAFT" | "ROUND_TRIP";
  display?: ExcelIntakePreview;
  result?: { draftId?: string } | null;
  source?: { filename: string; sha256: string; downloadUrl: string } | null;
};

type IntakeState = {
  open: boolean;
  mode: "PASTE" | "XLSX";
  paste: string;
  file: File | null;
  sheet: string;
  range: string;
  corrections: Record<string, string>;
  decimalResolutions: Record<string, "VISIBLE" | "CANONICAL">;
  preview: ExcelIntakePreview | null;
  session: SessionView | null;
  resumeSessionId: string;
  sourceRevision: number;
  requestId: number;
  pending: boolean;
  error: string;
  mappingStage: MappingStage | null;
};
type IntakeAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_MODE"; mode: IntakeState["mode"] }
  | { type: "SET_SOURCE"; key: "paste" | "sheet" | "range" | "resumeSessionId"; value: string }
  | { type: "SET_FILE"; file: File | null }
  | { type: "CORRECT"; key: string; value: string }
  | { type: "RESOLVE_DECIMAL"; conflictId: string; value: "VISIBLE" | "CANONICAL" }
  | { type: "REQUEST_STARTED"; requestId: number }
  | { type: "PREVIEW_OK"; requestId: number; session: SessionView | null }
  | { type: "MAPPING_READY"; requestId: number; stage: MappingStage }
  | { type: "REQUEST_FAILED"; requestId: number; message: string };

export const initialExcelIntakeState: IntakeState = { open: false, mode: "PASTE", paste: "", file: null, sheet: "", range: "", corrections: {}, decimalResolutions: {}, preview: null, session: null, resumeSessionId: "", sourceRevision: 1, requestId: 0, pending: false, error: "", mappingStage: null };

export function excelIntakeReducer(state: IntakeState, action: IntakeAction): IntakeState {
  if (action.type === "OPEN") return { ...state, open: true };
  if (action.type === "CLOSE") return { ...state, open: false };
  if (action.type === "SET_MODE") return { ...state, mode: action.mode, mappingStage: null, error: "" };
  if (action.type === "SET_SOURCE") return { ...state, [action.key]: action.value, mappingStage: action.key === "resumeSessionId" ? state.mappingStage : null, error: "" };
  if (action.type === "SET_FILE") return { ...state, file: action.file, mappingStage: null, error: "" };
  if (action.type === "CORRECT") return { ...state, corrections: { ...state.corrections, [action.key]: action.value } };
  if (action.type === "RESOLVE_DECIMAL") return { ...state, decimalResolutions: { ...state.decimalResolutions, [action.conflictId]: action.value } };
  if (action.type === "REQUEST_STARTED") return { ...state, requestId: action.requestId, pending: true, error: "" };
  if (action.requestId !== state.requestId) return state;
  if (action.type === "MAPPING_READY") return { ...state, pending: false, session: null, preview: null, mappingStage: action.stage, error: "" };
  if (action.type === "PREVIEW_OK") return { ...state, pending: false, session: action.session, preview: action.session?.display ?? null, mappingStage: null, resumeSessionId: action.session?.previewSessionId ?? state.resumeSessionId, corrections: {}, decimalResolutions: {}, error: "" };
  return { ...state, pending: false, error: action.message };
}

export default function ExcelIntakeDialog({ projectId, version, files = [], disabled = false }: { projectId: string; version: number; files?: { id: string; name: string }[]; disabled?: boolean }) {
  const [state, dispatch] = useReducer(excelIntakeReducer, initialExcelIntakeState);
  const [authority, authorityDispatch] = useReducer(reduceExcelPreviewState<
    { mode: IntakeState["mode"]; paste: string; file: File | null; sheet: string; range: string },
    ExcelIntakePreview
  >, createExcelPreviewState({ mode: "PASTE", paste: "", file: null, sheet: "", range: "" }));
  const [discardOpen, setDiscardOpen] = useState(false);
  const [stagedChange, setStagedChange] = useState<IntakeAction | null>(null);
  const [confirmError, setConfirmError] = useState("");
  const [confirmPending, startConfirm] = useTransition();
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sequence = useRef(0);
  const visiblePreview = authority.currentProjection ?? authority.staleProjection;
  const blocking = visiblePreview?.errors.length ?? 0;
  const unresolvedDecimals = visiblePreview?.decimalConflicts.filter(conflict => !state.decimalResolutions[conflict.conflictId]).length ?? 0;
  const actionable = state.session?.state === "ACTIONABLE" && state.session.operationKind === "NEW_DRAFT" && authority.actionableSessionId === state.session.previewSessionId;

  useEffect(() => { if (!state.open) triggerRef.current?.focus(); }, [state.open]);
  useEffect(() => {
    const refreshStatus = async () => {
      if (!state.open || !state.session?.previewSessionId) return;
      const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/sessions/${encodeURIComponent(state.session.previewSessionId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as SessionView;
      authorityDispatch({ type: "SERVER_STATUS", serverState: body.state });
    };
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, [projectId, state.open, state.session?.previewSessionId]);

  async function requestSession(request: Promise<Response>, requestId: number, sourceRevision: number) {
    try {
      const response = await request;
      const body = await response.json() as (SessionView & { error?: string }) | MappingStage;
      if (requestId !== sequence.current) return;
      if (body.state === "MANUAL_MAPPING") {
        dispatch({ type: "MAPPING_READY", requestId, stage: body });
        authorityDispatch({ type: "MAPPING_READY", sourceRevision });
        return;
      }
      if (!response.ok || body.error) throw new Error(body.error || "Không đọc được phiên xem trước.");
      if (body.operationKind !== "NEW_DRAFT") throw new Error("Phiên xem trước không thuộc luồng tạo nháp mới.");
      dispatch({ type: "PREVIEW_OK", requestId, session: body });
      if (body.state === "ACTIONABLE" && body.display) authorityDispatch({ type: "RESPONSE_SUCCEEDED", sourceRevision, sessionId: body.previewSessionId, projection: body.display });
      else authorityDispatch({ type: "SESSION_LOADED", serverState: body.state, sessionId: body.previewSessionId, projection: body.display ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không đọc được phiên xem trước.";
      dispatch({ type: "REQUEST_FAILED", requestId, message });
      authorityDispatch({ type: "RESPONSE_FAILED", sourceRevision, message });
    }
  }

  async function preview(mapping?: ReviewedExcelMapping, aiSourceId?: string) {
    const requestId = ++sequence.current;
    dispatch({ type: "REQUEST_STARTED", requestId });
    authorityDispatch({ type: "REQUEST_STARTED", sourceRevision: authority.sourceRevision });
    const form = new FormData();
    form.set("paste", state.paste);
    form.set("sheet", state.sheet);
    form.set("range", state.range);
    form.set("sourceRevision", String(authority.sourceRevision));
    if (state.mode === "XLSX" && state.file) form.set("file", state.file);
    if (state.mode === "XLSX") form.set("aiMappingIntent", "true");
    if (mapping) form.set("reviewedMapping", JSON.stringify(mapping));
    if (aiSourceId) form.set("aiSourceId", aiSourceId);
    await requestSession(fetch(`/api/projects/${projectId}/costflow/excel-intake/preview`, { method: "POST", body: form }), requestId, authority.sourceRevision);
  }

  async function resume() {
    const sessionId = state.resumeSessionId.trim();
    if (!sessionId) return;
    const requestId = ++sequence.current;
    dispatch({ type: "REQUEST_STARTED", requestId });
    await requestSession(fetch(`/api/projects/${projectId}/costflow/excel-intake/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" }), requestId, authority.sourceRevision);
  }

  const nextSource = (action: IntakeAction) => ({
    mode: action.type === "SET_MODE" ? action.mode : state.mode,
    paste: action.type === "SET_SOURCE" && action.key === "paste" ? action.value : state.paste,
    file: action.type === "SET_FILE" ? action.file : state.file,
    sheet: action.type === "SET_SOURCE" && action.key === "sheet" ? action.value : state.sheet,
    range: action.type === "SET_SOURCE" && action.key === "range" ? action.value : state.range,
  });

  async function continueSourceChange(action = stagedChange) {
    if (!action) return;
    const oldSessionId = authority.pendingSourceChange?.previous.actionableSessionId ?? authority.actionableSessionId;
    try {
      if (oldSessionId) {
        const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/sessions/${encodeURIComponent(oldSessionId)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Không thể hủy phiên cũ trên máy chủ.");
      }
      dispatch(action);
      authorityDispatch({ type: "SOURCE_CANCELLED" });
      setDiscardOpen(false);
      setStagedChange(null);
    } catch (error) {
      authorityDispatch({ type: "SOURCE_CANCEL_FAILED", message: error instanceof Error ? error.message : "Không thể hủy phiên cũ trên máy chủ." });
    }
  }

  function proposeSourceChange(action: IntakeAction) {
    const source = nextSource(action);
    const hasChoices = Object.keys(state.corrections).length > 0 || Object.keys(state.decimalResolutions).length > 0;
    authorityDispatch({ type: "SOURCE_CHANGE_INTENT", source });
    setStagedChange(action);
    if (hasChoices) setDiscardOpen(true);
    else void continueSourceChange(action);
  }

  async function stayOnSource() {
    const oldSessionId = authority.pendingSourceChange?.previous.actionableSessionId;
    if (!oldSessionId) {
      authorityDispatch({ type: "STAY_CONFIRMED", serverState: "ACTIONABLE" });
    } else {
      const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/sessions/${encodeURIComponent(oldSessionId)}`, { cache: "no-store" });
      const body = await response.json() as SessionView;
      authorityDispatch({ type: "STAY_CONFIRMED", serverState: response.ok ? body.state : "NON_ACTIONABLE_CANCELLED" });
    }
    setDiscardOpen(false);
    setStagedChange(null);
  }

  const corrected = (rowKey: string, field: string, fallback: string | null) => state.corrections[`${rowKey}.${field}`] ?? fallback ?? "";
  const focusIssue = (issue: ExcelIntakeDiagnosticIdentity) => document.getElementById(excelIntakeDiagnosticTargetId(issue))?.focus();
  const confirm = () => {
    if (!visiblePreview || !state.session || !actionable || blocking || unresolvedDecimals) return;
    setConfirmError("");
    startConfirm(async () => {
      const result = await confirmExcelIntakeAction({ projectId, previewSessionId: state.session!.previewSessionId, expectedVersion: version, idempotencyKey: `excel-intake:${crypto.randomUUID()}`, corrections: state.corrections, decimalResolutions: state.decimalResolutions });
      if ("error" in result) { setConfirmError(result.error); return; }
      router.push(`/projects/${projectId}/costflow/paired?draftId=${encodeURIComponent(result.draftId)}`);
    });
  };

  const readOnly = !!state.session && !actionable;
  return <>
    <Button ref={triggerRef} variant="secondary" size="sm" disabled={disabled} onClick={() => dispatch({ type: "OPEN" })}>Nhập từ Excel</Button>
    <Dialog open={state.open} onClose={() => dispatch({ type: "CLOSE" })} title="Nhập Báo giá & IC" description="Dán bảng hoặc tải XLSX để xem trước. Chưa có hồ sơ nào được ghi." className="excel-intake-dialog"
      footer={<>
        <Button variant="secondary" onClick={() => void preview()} loading={state.pending}>Xem trước dữ liệu</Button>
        <Button onClick={confirm} loading={confirmPending} disabled={state.pending || confirmPending || blocking > 0 || unresolvedDecimals > 0 || !state.preview || !actionable}>Tạo nháp Báo giá &amp; IC</Button>
      </>}>
      <div className="excel-intake-source-grid">
        <Button variant={state.mode === "PASTE" ? "primary" : "secondary"} onClick={() => proposeSourceChange({ type: "SET_MODE", mode: "PASTE" })}>Dán bảng</Button>
        <Button variant={state.mode === "XLSX" ? "primary" : "secondary"} onClick={() => proposeSourceChange({ type: "SET_MODE", mode: "XLSX" })}>Tải XLSX</Button>
        <Field label="Sheet" value={state.sheet} onChange={event => proposeSourceChange({ type: "SET_SOURCE", key: "sheet", value: event.target.value })} placeholder="Tự nhận diện" />
        <Field label="Vùng dữ liệu" value={state.range} onChange={event => proposeSourceChange({ type: "SET_SOURCE", key: "range", value: event.target.value })} placeholder="Ví dụ A6:Y40" />
      </div>
      {state.mode === "PASTE" ? <Textarea label="Dữ liệu nhiều ô" value={state.paste} onChange={event => proposeSourceChange({ type: "SET_SOURCE", key: "paste", value: event.target.value })} /> :
        <Field label="Tệp XLSX" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event: ChangeEvent<HTMLInputElement>) => proposeSourceChange({ type: "SET_FILE", file: event.target.files?.[0] ?? null })} />}
      <div className="excel-intake-source-grid">
        <Field label="Mở lại phiên xem trước" hint="Dán mã phiên đã lưu để tiếp tục sửa hoặc xem lại dữ liệu trước đó." value={state.resumeSessionId} onChange={event => dispatch({ type: "SET_SOURCE", key: "resumeSessionId", value: event.target.value })} placeholder="Dán mã phiên" />
        <Button variant="secondary" onClick={resume} disabled={!state.resumeSessionId.trim()} loading={state.pending}>Mở phiên đã lưu</Button>
      </div>
      <p className="tf-ui-help" aria-live="polite">{authority.notice || (state.pending ? "Đang kiểm tra dữ liệu…" : state.error || (visiblePreview ? visiblePreview.adapter === "AI_REVIEWED" ? `Đã rà soát ánh xạ · ${visiblePreview.rows.length} dòng.` : `Đã nhận diện bằng bộ đọc chuẩn — không gọi AI · ${visiblePreview.rows.length} dòng.` : "Chọn nguồn rồi xem trước dữ liệu."))}</p>
      {state.session && <p className="tf-ui-help">Phiên {state.session.previewSessionId} · hết hạn {new Date(state.session.expiresAt).toLocaleString("vi-VN")}</p>}
      {state.error && <Alert tone="danger" title="Chưa thể xem trước">{state.error} Dữ liệu và các ô đã sửa vẫn được giữ.</Alert>}
      {state.mappingStage && <>
        <p className="tf-ui-help">Để dùng AI hoặc mapping đã lưu, <a className="tf-link" href={`/projects/${projectId}?tab=files`}>lưu XLSX vào Tài liệu dự án</a> rồi chọn đúng tệp bên dưới. Ánh xạ thủ công dùng tệp đang tải trong hộp thoại.</p>
        <AiExcelMappingReview key={state.mappingStage.fingerprint} stage={state.mappingStage} files={files} pending={state.pending}
          onAnalyze={sourceId => void preview(undefined, sourceId)} onApply={(mapping, sourceId) => void preview(mapping, sourceId)} />
      </>}
      {confirmError && <Alert tone="danger" title="Chưa thể tạo nháp">{confirmError} Dữ liệu và các ô đã sửa vẫn được giữ.</Alert>}
      {state.session?.state === "READ_ONLY_CONSUMED" && <Alert tone="success" title="Phiên đã được xác nhận">Bản xem lại chỉ đọc{state.session.result?.draftId ? ` · nháp ${state.session.result.draftId}` : ""}. {state.session.source && <a href={state.session.source.downloadUrl}>Tải nguồn {state.session.source.filename}</a>}</Alert>}
      {state.session?.state.startsWith("NON_ACTIONABLE_") && <Alert tone="warning" title="Phiên không còn hiệu lực">Phiên đã hết hạn, bị thay thế hoặc bị hủy. Dữ liệu xem trước đã được xóa.</Alert>}
      {authority.staleProjection && !authority.currentProjection && <Alert tone="warning" title="Không còn áp dụng">Bản xem trước cũ chỉ còn để đối chiếu và không thể tạo nháp.</Alert>}
      {!!visiblePreview?.errors.length && <Alert tone="danger" title="Lỗi cần sửa"><ul>{visiblePreview.errors.map(issue => <li key={`${issue.candidateKey}-${issue.field}-${issue.source.cell}`}><button type="button" className="tf-link" onClick={() => focusIssue(issue)}>{issue.message}</button> — {issue.source.sheet} · dòng {issue.source.row} · ô {issue.source.cell}</li>)}</ul></Alert>}
      {!!visiblePreview?.warnings.length && <Alert tone="warning" title="Cảnh báo"><ul>{visiblePreview.warnings.map(issue => <li key={`${issue.candidateKey}-${issue.field}-${issue.source.cell}`}><button type="button" className="tf-link" onClick={() => focusIssue(issue)}>{issue.message}</button> — {issue.source.sheet} · dòng {issue.source.row} · ô {issue.source.cell}</li>)}</ul></Alert>}
      {!!visiblePreview?.decimalConflicts.length && <Alert tone="warning" title="Chọn giá trị cho từng ô xung đột"><div>{visiblePreview.decimalConflicts.map(conflict => <fieldset id={excelIntakeDiagnosticTargetId({ ...conflict, conflictId: conflict.conflictId })} tabIndex={-1} key={conflict.conflictId} disabled={readOnly}><legend><button type="button" className="tf-link" onClick={() => focusIssue({ ...conflict, conflictId: conflict.conflictId })}>{conflict.field} · ô {conflict.source.cell}</button></legend><p>Hiển thị: {conflict.visible} · chính xác: {conflict.canonical}</p><label><input type="radio" name={conflict.conflictId} checked={state.decimalResolutions[conflict.conflictId] === "VISIBLE"} onChange={() => { dispatch({ type: "RESOLVE_DECIMAL", conflictId: conflict.conflictId, value: "VISIBLE" }); authorityDispatch({ type: "SET_DECIMAL_RESOLUTION", key: conflict.conflictId, value: "VISIBLE" }); }} /> Dùng giá trị hiển thị</label><label><input type="radio" name={conflict.conflictId} checked={state.decimalResolutions[conflict.conflictId] === "CANONICAL"} onChange={() => { dispatch({ type: "RESOLVE_DECIMAL", conflictId: conflict.conflictId, value: "CANONICAL" }); authorityDispatch({ type: "SET_DECIMAL_RESOLUTION", key: conflict.conflictId, value: "CANONICAL" }); }} /> Giữ giá trị chính xác</label></fieldset>)}</div></Alert>}
      {visiblePreview && <div className={`excel-intake-table-scroll ${authority.staleProjection && !authority.currentProjection ? "opacity-60" : ""}`}><p className="tf-ui-help">Sheet · dòng · ô được giữ cho từng trường nguồn.</p><Table caption="Xem trước Báo giá xanh và IC vàng" hideCaption>
        <thead><tr><th>Hạng mục</th>{editableFields.map(field => <th key={field}>{field}</th>)}</tr></thead>
        <tbody>{visiblePreview.rows.map(row => <tr key={row.candidateKey} className="excel-intake-row-card"><td>{row.name || row.description}{[...visiblePreview.errors, ...visiblePreview.warnings].filter(issue => issue.candidateKey === row.candidateKey && !editableFields.includes(issue.field as EditableField)).map(issue => <span id={excelIntakeDiagnosticTargetId(issue)} tabIndex={-1} className="tf-ui-help" key={`${issue.field}-${issue.source.cell}`}>{issue.field} · ô {issue.source.cell}</span>)}</td>{editableFields.map(field => <td key={field}><input id={excelIntakeDiagnosticTargetId({ candidateKey: row.candidateKey, field, source: row.coordinates.name })} aria-label={`${field} · ${row.name || row.description}`} className="tf-field" disabled={readOnly || !actionable} value={corrected(row.candidateKey, field, editableValue(row, field))} onChange={event => { dispatch({ type: "CORRECT", key: `${row.candidateKey}.${field}`, value: event.target.value }); authorityDispatch({ type: "SET_CORRECTION", key: `${row.candidateKey}.${field}`, value: event.target.value }); }} /></td>)}</tr>)}</tbody>
      </Table></div>}
    </Dialog>
    <Dialog open={discardOpen} onClose={() => void stayOnSource()} title="Bỏ các lựa chọn đang sửa?" description="Đổi nguồn sẽ hủy phiên hiện tại và xóa các ô sửa, lựa chọn số thập phân.">
      <div className="tf-ui-actions"><Button variant="secondary" onClick={() => void stayOnSource()}>Ở lại</Button><Button onClick={() => void continueSourceChange()}>Tiếp tục và bỏ lựa chọn</Button></div>
    </Dialog>
  </>;
}
