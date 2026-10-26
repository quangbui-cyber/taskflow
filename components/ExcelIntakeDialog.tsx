"use client";

import { useEffect, useReducer, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { confirmExcelIntakeAction } from "@/app/actions/costflowExcelIntake";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input as Field, Textarea } from "@/components/ui/Field";
import { Alert, Table } from "@/components/ui/Presentation";
import type { ExcelIntakePreview } from "@/lib/costflow/excelIntakeParser";

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
  preview: ExcelIntakePreview | null;
  session: SessionView | null;
  resumeSessionId: string;
  sourceRevision: number;
  requestId: number;
  pending: boolean;
  error: string;
};
type IntakeAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_MODE"; mode: IntakeState["mode"] }
  | { type: "SET_SOURCE"; key: "paste" | "sheet" | "range" | "resumeSessionId"; value: string }
  | { type: "SET_FILE"; file: File | null }
  | { type: "CORRECT"; key: string; value: string }
  | { type: "REQUEST_STARTED"; requestId: number }
  | { type: "PREVIEW_OK"; requestId: number; session: SessionView | null }
  | { type: "REQUEST_FAILED"; requestId: number; message: string };

export const initialExcelIntakeState: IntakeState = { open: false, mode: "PASTE", paste: "", file: null, sheet: "", range: "", corrections: {}, preview: null, session: null, resumeSessionId: "", sourceRevision: 1, requestId: 0, pending: false, error: "" };

export function excelIntakeReducer(state: IntakeState, action: IntakeAction): IntakeState {
  if (action.type === "OPEN") return { ...state, open: true };
  if (action.type === "CLOSE") return { ...state, open: false };
  if (action.type === "SET_MODE") return { ...state, mode: action.mode, error: "" };
  if (action.type === "SET_SOURCE") return { ...state, [action.key]: action.value, error: "" };
  if (action.type === "SET_FILE") return { ...state, file: action.file, error: "" };
  if (action.type === "CORRECT") return { ...state, corrections: { ...state.corrections, [action.key]: action.value } };
  if (action.type === "REQUEST_STARTED") return { ...state, requestId: action.requestId, pending: true, error: "" };
  if (action.requestId !== state.requestId) return state;
  if (action.type === "PREVIEW_OK") return { ...state, pending: false, session: action.session, preview: action.session?.display ?? null, resumeSessionId: action.session?.previewSessionId ?? state.resumeSessionId, corrections: {}, error: "" };
  return { ...state, pending: false, error: action.message };
}

export default function ExcelIntakeDialog({ projectId, version, disabled = false }: { projectId: string; version: number; disabled?: boolean }) {
  const [state, dispatch] = useReducer(excelIntakeReducer, initialExcelIntakeState);
  const [confirmError, setConfirmError] = useState("");
  const [confirmPending, startConfirm] = useTransition();
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sequence = useRef(0);
  const blocking = state.preview?.errors.length ?? 0;
  const actionable = state.session?.state === "ACTIONABLE" && state.session.operationKind === "NEW_DRAFT";

  useEffect(() => { if (!state.open) triggerRef.current?.focus(); }, [state.open]);

  async function requestSession(request: Promise<Response>, requestId: number) {
    try {
      const response = await request;
      const body = await response.json() as SessionView & { error?: string };
      if (!response.ok || body.error) throw new Error(body.error || "Không đọc được phiên xem trước.");
      if (body.operationKind !== "NEW_DRAFT") throw new Error("Phiên xem trước không thuộc luồng tạo nháp mới.");
      dispatch({ type: "PREVIEW_OK", requestId, session: body });
    } catch (error) {
      dispatch({ type: "REQUEST_FAILED", requestId, message: error instanceof Error ? error.message : "Không đọc được phiên xem trước." });
    }
  }

  async function preview() {
    const requestId = ++sequence.current;
    dispatch({ type: "REQUEST_STARTED", requestId });
    const form = new FormData();
    form.set("paste", state.paste);
    form.set("sheet", state.sheet);
    form.set("range", state.range);
    form.set("sourceRevision", String(state.sourceRevision));
    if (state.mode === "XLSX" && state.file) form.set("file", state.file);
    await requestSession(fetch(`/api/projects/${projectId}/costflow/excel-intake/preview`, { method: "POST", body: form }), requestId);
  }

  async function resume() {
    const sessionId = state.resumeSessionId.trim();
    if (!sessionId) return;
    const requestId = ++sequence.current;
    dispatch({ type: "REQUEST_STARTED", requestId });
    await requestSession(fetch(`/api/projects/${projectId}/costflow/excel-intake/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" }), requestId);
  }

  const corrected = (rowKey: string, field: string, fallback: string | null) => state.corrections[`${rowKey}.${field}`] ?? fallback ?? "";
  const focusIssue = (field: string, candidateKey?: string) => document.getElementById(`excel-intake-row-${candidateKey ?? state.preview?.rows[0]?.candidateKey}-${field.replace(".", "-")}`)?.focus();
  const confirm = () => {
    if (!state.preview || !state.session || !actionable || blocking) return;
    setConfirmError("");
    startConfirm(async () => {
      const result = await confirmExcelIntakeAction({ projectId, previewSessionId: state.session!.previewSessionId, expectedVersion: version, idempotencyKey: `excel-intake:${crypto.randomUUID()}`, corrections: state.corrections });
      if ("error" in result) { setConfirmError(result.error); return; }
      router.push(`/projects/${projectId}/costflow/paired?draftId=${encodeURIComponent(result.draftId)}`);
    });
  };

  const readOnly = !!state.session && !actionable;
  return <>
    <Button ref={triggerRef} variant="secondary" size="sm" disabled={disabled} onClick={() => dispatch({ type: "OPEN" })}>Nhập từ Excel</Button>
    <Dialog open={state.open} onClose={() => dispatch({ type: "CLOSE" })} title="Nhập Báo giá & IC" description="Dán bảng hoặc tải XLSX để xem trước. Chưa có hồ sơ nào được ghi." className="excel-intake-dialog"
      footer={<>
        <Button variant="secondary" onClick={preview} loading={state.pending}>Cập nhật xem trước</Button>
        <Button onClick={confirm} loading={confirmPending} disabled={state.pending || confirmPending || blocking > 0 || !state.preview || !actionable}>Tạo nháp mới</Button>
      </>}>
      <div className="excel-intake-source-grid">
        <Button variant={state.mode === "PASTE" ? "primary" : "secondary"} onClick={() => dispatch({ type: "SET_MODE", mode: "PASTE" })}>Dán bảng</Button>
        <Button variant={state.mode === "XLSX" ? "primary" : "secondary"} onClick={() => dispatch({ type: "SET_MODE", mode: "XLSX" })}>Tải XLSX</Button>
        <Field label="Sheet" value={state.sheet} onChange={event => dispatch({ type: "SET_SOURCE", key: "sheet", value: event.target.value })} placeholder="Tự nhận diện" />
        <Field label="Vùng dữ liệu" value={state.range} onChange={event => dispatch({ type: "SET_SOURCE", key: "range", value: event.target.value })} placeholder="Ví dụ A6:Y40" />
      </div>
      {state.mode === "PASTE" ? <Textarea label="Dữ liệu nhiều ô" value={state.paste} onChange={event => dispatch({ type: "SET_SOURCE", key: "paste", value: event.target.value })} /> :
        <Field label="Tệp XLSX" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event: ChangeEvent<HTMLInputElement>) => dispatch({ type: "SET_FILE", file: event.target.files?.[0] ?? null })} />}
      <div className="excel-intake-source-grid">
        <Field label="Mã phiên xem trước" value={state.resumeSessionId} onChange={event => dispatch({ type: "SET_SOURCE", key: "resumeSessionId", value: event.target.value })} placeholder="Dán mã để tiếp tục hoặc xem lại" />
        <Button variant="secondary" onClick={resume} disabled={!state.resumeSessionId.trim()} loading={state.pending}>Mở phiên</Button>
      </div>
      <p className="tf-ui-help" aria-live="polite">{state.pending ? "Đang kiểm tra dữ liệu…" : state.error || (state.preview ? `Đã nhận diện ${state.preview.adapter} · ${state.preview.rows.length} dòng.` : "Chọn nguồn rồi cập nhật xem trước.")}</p>
      {state.session && <p className="tf-ui-help">Phiên {state.session.previewSessionId} · hết hạn {new Date(state.session.expiresAt).toLocaleString("vi-VN")}</p>}
      {state.error && <Alert tone="danger" title="Chưa thể xem trước">{state.error} Dữ liệu và các ô đã sửa vẫn được giữ.</Alert>}
      {confirmError && <Alert tone="danger" title="Chưa thể tạo nháp">{confirmError} Dữ liệu và các ô đã sửa vẫn được giữ.</Alert>}
      {state.session?.state === "READ_ONLY_CONSUMED" && <Alert tone="success" title="Phiên đã được xác nhận">Bản xem lại chỉ đọc{state.session.result?.draftId ? ` · nháp ${state.session.result.draftId}` : ""}. {state.session.source && <a href={state.session.source.downloadUrl}>Tải nguồn {state.session.source.filename}</a>}</Alert>}
      {state.session?.state.startsWith("NON_ACTIONABLE_") && <Alert tone="warning" title="Phiên không còn hiệu lực">Phiên đã hết hạn, bị thay thế hoặc bị hủy. Dữ liệu xem trước đã được xóa.</Alert>}
      {!!state.preview?.errors.length && <Alert tone="danger" title="Lỗi cần sửa"><ul>{state.preview.errors.map((issue, index) => <li key={`${issue.source.cell}-${index}`}><button type="button" className="tf-link" onClick={() => focusIssue(issue.field)}>{issue.message}</button> — {issue.source.sheet} · dòng {issue.source.row} · ô {issue.source.cell}</li>)}</ul></Alert>}
      {!!state.preview?.warnings.length && <Alert tone="warning" title="Cảnh báo"><ul>{state.preview.warnings.map((issue, index) => <li key={`${issue.source.cell}-${index}`}>{issue.message} — {issue.source.sheet} · dòng {issue.source.row} · ô {issue.source.cell}</li>)}</ul></Alert>}
      {state.preview && <div className="excel-intake-table-scroll"><p className="tf-ui-help">Sheet · dòng · ô được giữ cho từng trường nguồn.</p><Table caption="Xem trước Báo giá xanh và IC vàng" hideCaption>
        <thead><tr><th>Hạng mục</th><th>SL bán</th><th>Ngày bán</th><th>Đơn giá bán</th><th>SL mua</th><th>Ngày mua</th><th>Giá vốn</th><th>NCC</th></tr></thead>
        <tbody>{state.preview.rows.map(row => <tr key={row.candidateKey} className="excel-intake-row-card"><td>{row.name || row.description}</td>{(["sell.quantity", "sell.days", "sell.unitPrice", "buy.quantity", "buy.days", "buy.unitPrice", "buy.supplier"] as const).map(field => <td key={field}><input id={`excel-intake-row-${row.candidateKey}-${field.replace(".", "-")}`} className="tf-field" disabled={readOnly} value={corrected(row.candidateKey, field, field.startsWith("sell.") ? row.sell[field.slice(5) as "quantity" | "days" | "unitPrice"] : field === "buy.supplier" ? row.buy.supplier : row.buy[field.slice(4) as "quantity" | "days" | "unitPrice"])} onChange={event => dispatch({ type: "CORRECT", key: `${row.candidateKey}.${field}`, value: event.target.value })} /></td>)}</tr>)}</tbody>
      </Table></div>}
    </Dialog>
  </>;
}
