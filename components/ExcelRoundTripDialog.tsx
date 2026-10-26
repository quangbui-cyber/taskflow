"use client";

import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import { confirmRoundTripMergeAction, rebuildRoundTripPreviewAction } from "@/app/actions/costflowExcelIntake";
import type { RoundTripDiff } from "@/lib/costflow/excelRoundTrip";
import type { PairedRow } from "@/lib/costflow/types";
import { createExcelPreviewState, reduceExcelPreviewState } from "@/lib/costflow/excelPreviewState";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Alert } from "./ui/Presentation";

type PreviewSession = {
  state: "ACTIONABLE" | "READ_ONLY_CONSUMED" | "NON_ACTIONABLE_EXPIRED" | "NON_ACTIONABLE_SUPERSEDED" | "NON_ACTIONABLE_CANCELLED";
  previewSessionId: string;
  operationKind: "NEW_DRAFT" | "ROUND_TRIP";
  expiresAt: string;
  display?: { draft: { id: string; version: number }; diff: RoundTripDiff };
  result?: { draftId?: string; draftVersion?: number; version?: number; rows?: PairedRow[] } | null;
  source?: { filename: string; sha256: string; downloadUrl: string } | null;
};

export default function ExcelRoundTripDialog({ projectId, draftId, dirty, onApplied }: {
  projectId: string;
  draftId: string;
  dirty: boolean;
  onApplied: (result: { rows: PairedRow[]; version: number; draftVersion: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewSession | null>(null);
  const [authority, authorityDispatch] = useReducer(reduceExcelPreviewState<File | null, NonNullable<PreviewSession["display"]>>, createExcelPreviewState<File | null, NonNullable<PreviewSession["display"]>>(null));
  const [resumeSessionId, setResumeSessionId] = useState("");
  const selectedDeletionIds = authority.selectedDeletionIds;
  const decimalResolutions = authority.decimalResolutions;
  const aggregateDeletionConfirmed = authority.aggregateDeletionConfirmed;
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [stale, setStale] = useState(false);
  const [pending, startTransition] = useTransition();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [aggregateOpen, setAggregateOpen] = useState(false);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const operationId = useRef(crypto.randomUUID());

  const close = () => setOpen(false);
  const acceptSession = (result: PreviewSession, revision = authority.sourceRevision) => {
    if (result.operationKind !== "ROUND_TRIP" || (result.display?.draft.id && result.display.draft.id !== draftId)) throw new Error("Phiên xem trước không thuộc nháp hiện tại.");
    setPreview(result);
    setResumeSessionId(result.previewSessionId);
    if (result.state === "ACTIONABLE" && result.display) authorityDispatch({ type: "RESPONSE_SUCCEEDED", sourceRevision: revision, sessionId: result.previewSessionId, projection: result.display });
    else authorityDispatch({ type: "SESSION_LOADED", serverState: result.state, sessionId: result.previewSessionId, projection: result.display ?? null });
    setError("");
    setSuccess("");
    setStale(false);
    operationId.current = crypto.randomUUID();
  };
  const continueFileChange = async (nextFile = stagedFile) => {
    const oldSessionId = authority.pendingSourceChange?.previous.actionableSessionId ?? authority.actionableSessionId;
    try {
      if (oldSessionId) {
        const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/sessions/${encodeURIComponent(oldSessionId)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Không thể hủy phiên cũ trên máy chủ.");
      }
      setFile(nextFile);
      authorityDispatch({ type: "SOURCE_CANCELLED" });
      setDiscardOpen(false);
      setStagedFile(null);
    } catch (reason) {
      authorityDispatch({ type: "SOURCE_CANCEL_FAILED", message: reason instanceof Error ? reason.message : "Không thể hủy phiên cũ trên máy chủ." });
    }
  };
  const proposeFile = (nextFile: File | null) => {
    authorityDispatch({ type: "SOURCE_CHANGE_INTENT", source: nextFile });
    setStagedFile(nextFile);
    const hasChoices = selectedDeletionIds.length > 0 || Object.keys(decimalResolutions).length > 0;
    if (hasChoices) setDiscardOpen(true);
    else void continueFileChange(nextFile);
  };
  const stayOnFile = async () => {
    const oldSessionId = authority.pendingSourceChange?.previous.actionableSessionId;
    if (oldSessionId) {
      const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/sessions/${encodeURIComponent(oldSessionId)}`, { cache: "no-store" });
      const result = await response.json() as PreviewSession;
      authorityDispatch({ type: "STAY_CONFIRMED", serverState: response.ok ? result.state : "NON_ACTIONABLE_CANCELLED" });
    } else authorityDispatch({ type: "STAY_CONFIRMED", serverState: "ACTIONABLE" });
    setDiscardOpen(false);
    setStagedFile(null);
  };
  const review = () => {
    if (!file) { setError("Chọn workbook round-trip đã chỉnh sửa."); return; }
    startTransition(async () => {
      try {
        const revision = authority.sourceRevision;
        authorityDispatch({ type: "REQUEST_STARTED", sourceRevision: revision });
        const body = new FormData();
        body.set("file", file);
        body.set("sourceRevision", String(revision));
        const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/round-trip/preview`, { method: "POST", body });
        const result = await response.json() as PreviewSession & { error?: string };
        if (!response.ok || result.error) throw new Error(result.error || "Không xem trước được workbook.");
        acceptSession(result, revision);
      } catch (reason) { const message = reason instanceof Error ? reason.message : "Không xem trước được workbook."; setError(message); authorityDispatch({ type: "RESPONSE_FAILED", sourceRevision: authority.sourceRevision, message }); }
    });
  };
  const resume = () => {
    if (!resumeSessionId.trim()) return;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/sessions/${encodeURIComponent(resumeSessionId.trim())}`, { cache: "no-store" });
        const result = await response.json() as PreviewSession & { error?: string };
        if (!response.ok || result.error) throw new Error(result.error || "Không mở được phiên xem trước.");
        acceptSession(result);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Không mở được phiên xem trước."); }
    });
  };
  const apply = () => {
    if (!preview || !authority.actionableSessionId || !authority.currentProjection) return;
    startTransition(async () => {
      const result = await confirmRoundTripMergeAction({
        projectId,
        draftId,
        previewSessionId: preview.previewSessionId,
        selectedDeletionIds,
        decimalResolutions,
        idempotencyKey: `excel-round-trip:${operationId.current}`,
      });
      if ("error" in result) {
        setStale(result.code === "STALE_DRAFT");
        setError(/thay đổi|đồng thời/i.test(result.error) ? `Nháp trên máy chủ đã thay đổi (server draft changed). ${result.error}` : result.error);
        return;
      }
      setError("");
      setSuccess(`Đã áp dụng workbook vào nháp v${result.draftVersion}. Phiên chuyển sang chỉ đọc.`);
      setPreview(current => current ? { ...current, state: "READ_ONLY_CONSUMED", result } : current);
      authorityDispatch({ type: "SERVER_STATUS", serverState: "READ_ONLY_CONSUMED" });
      onApplied({ rows: result.rows, version: result.version, draftVersion: result.draftVersion });
    });
  };
  const rebuild = () => {
    if (!preview) return;
    startTransition(async () => {
      const result = await rebuildRoundTripPreviewAction({ projectId, draftId, previewSessionId: preview.previewSessionId });
      if ("error" in result) { setError(result.error); return; }
      acceptSession(result);
      setSuccess("Đã tạo diff mới từ workbook đã giữ lại; các lựa chọn cũ đã được xóa.");
    });
  };
  const display = authority.currentProjection ?? authority.staleProjection;
  const diff = display?.diff;
  const actionable = preview?.state === "ACTIONABLE" && authority.actionableSessionId === preview.previewSessionId && !!authority.currentProjection;
  const unresolvedDecimals = diff?.decimalConflicts?.filter(conflict => !decimalResolutions[conflict.conflictId]).length ?? 0;
  const deletionNames = diff?.deletionCandidates.filter(row => selectedDeletionIds.includes(row.itemId)).map(row => row.name) ?? [];

  useEffect(() => {
    const refreshStatus = async () => {
      if (!open || !preview?.previewSessionId) return;
      const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/sessions/${encodeURIComponent(preview.previewSessionId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json() as PreviewSession;
      authorityDispatch({ type: "SERVER_STATUS", serverState: result.state });
      if (result.state !== "ACTIONABLE") setPreview(result);
    };
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, [open, preview?.previewSessionId, projectId]);

  return <div className="tf-round-trip-actions">
    <a className="tf-button-secondary tf-button-size-sm" aria-disabled={dirty || undefined} href={dirty ? undefined : `/api/projects/${projectId}/costflow/excel-intake/drafts/${draftId}`}>
      Xuất Excel
    </a>
    <Button size="sm" variant="secondary" disabled={dirty} onClick={() => setOpen(true)}>Re-import Excel</Button>
    {dirty && <span className="tf-ui-help">Lưu Worksheet trước khi xuất hoặc re-import.</span>}
    <Dialog open={open} onClose={close} title="Đối chiếu Excel round-trip" description="Máy chủ giữ authority; trình duyệt chỉ gửi lựa chọn xóa và mã phiên." className="tf-dialog-wide">
      <div className="tf-round-trip">
        <label className="tf-ui-label">Workbook đã chỉnh sửa<input type="file" accept=".xlsx" onChange={event => { proposeFile(event.target.files?.[0] ?? null); setError(""); }} /></label>
        <Button onClick={review} loading={pending}>Xem thay đổi</Button>
        <label className="tf-ui-label">Mã phiên xem trước<input className="tf-field" value={resumeSessionId} onChange={event => setResumeSessionId(event.target.value)} /></label>
        <Button variant="secondary" onClick={resume} disabled={!resumeSessionId.trim()} loading={pending}>Mở phiên</Button>
        {preview && <p className="tf-ui-help">Phiên {preview.previewSessionId} · hết hạn {new Date(preview.expiresAt).toLocaleString("vi-VN")}</p>}
        <p className="tf-ui-help" aria-live="polite">{authority.notice}</p>
        {error && <Alert tone="danger" title="Chưa thể áp dụng">{error}</Alert>}
        {stale && <Button variant="secondary" onClick={rebuild} loading={pending}>Tạo lại diff với bản mới nhất</Button>}
        {success && <Alert tone="success" title="Đã cập nhật">{success}</Alert>}
        {preview?.state === "READ_ONLY_CONSUMED" && <Alert tone="success" title="Bản xem lại chỉ đọc">Phiên đã được áp dụng và không thể chạy lại. {preview.source && <a href={preview.source.downloadUrl}>Tải nguồn {preview.source.filename}</a>}</Alert>}
        {preview?.state.startsWith("NON_ACTIONABLE_") && <Alert tone="warning" title="Phiên không còn hiệu lực">Phiên đã hết hạn, bị thay thế hoặc bị hủy; payload xem trước đã được xóa.</Alert>}
        {authority.staleProjection && !authority.currentProjection && <Alert tone="warning" title="Không còn áp dụng">Bản diff cũ chỉ còn để đối chiếu và không thể áp dụng.</Alert>}
        {diff && <div className={`tf-round-trip-groups ${authority.staleProjection && !authority.currentProjection ? "opacity-60" : ""}`} aria-readonly={!actionable}>
          {!!diff.decimalConflicts?.length && <section><h3>Xung đột số thập phân ({diff.decimalConflicts.length})</h3>{diff.decimalConflicts.map(conflict => <fieldset key={conflict.conflictId} disabled={!actionable}><legend>{conflict.field} · ô {conflict.source.cell}</legend><p>Hiển thị: {conflict.visible} · chính xác: {conflict.canonical}</p><label><input type="radio" name={conflict.conflictId} checked={decimalResolutions[conflict.conflictId] === "VISIBLE"} onChange={() => authorityDispatch({ type: "SET_DECIMAL_RESOLUTION", key: conflict.conflictId, value: "VISIBLE" })} /> Dùng giá trị hiển thị</label><label><input type="radio" name={conflict.conflictId} checked={decimalResolutions[conflict.conflictId] === "CANONICAL"} onChange={() => authorityDispatch({ type: "SET_DECIMAL_RESOLUTION", key: conflict.conflictId, value: "CANONICAL" })} /> Giữ giá trị chính xác</label></fieldset>)}</section>}
          <section><h3>Thêm mới ({diff.adds.length})</h3>{diff.adds.map(row => <p key={row.previewKey}>{row.row.name || "Dòng mới"} · ô {row.source.cell}</p>)}</section>
          <section><h3>Thay đổi ({diff.changes.length})</h3>{diff.changes.map((change, index) => <p key={`${change.itemId}-${change.field}-${index}`}><strong>{change.field}</strong>: {String(change.oldValue) || "—"} → {String(change.newValue) || "—"} · ô {change.source.cell}</p>)}</section>
          <section><h3>Di chuyển ({diff.moves.length})</h3>{diff.moves.map(move => <p key={move.itemId}>{move.itemId}: {move.oldParentItemId || "Gốc"} → {move.newParentItemId || "Gốc"} · ô {move.source.cell}</p>)}</section>
          <section><h3>Dòng có thể xóa ({diff.deletionCandidates.length})</h3><p className="tf-ui-help">Mặc định không xóa. Chỉ dòng được chọn dưới đây mới bị xóa.</p><Button size="sm" variant="secondary" disabled={!actionable || diff.deletionCandidates.length === 0} onClick={() => authorityDispatch({ type: "SET_DELETIONS", ids: diff.deletionCandidates.map(row => row.itemId) })}>Chọn tất cả</Button>{diff.deletionCandidates.map(row => <label key={row.itemId}><input type="checkbox" disabled={!actionable} checked={selectedDeletionIds.includes(row.itemId)} onChange={event => authorityDispatch({ type: "SET_DELETIONS", ids: event.target.checked ? [...selectedDeletionIds, row.itemId] : selectedDeletionIds.filter(id => id !== row.itemId) })} /> {row.name}</label>)}</section>
          {deletionNames.length > 0 && <Alert tone="warning" title="Xác nhận xóa">Sẽ xóa: {deletionNames.join(", ")}. Các dòng chưa chọn vẫn được giữ nguyên.</Alert>}
          <div className="tf-round-trip-summary">Tổng mới được máy chủ tính lại. Thêm {diff.adds.length}, sửa {diff.changes.length}, di chuyển {diff.moves.length}, xác nhận xóa {selectedDeletionIds.length}.</div>
          <Button onClick={() => selectedDeletionIds.length > 0 && !aggregateDeletionConfirmed ? setAggregateOpen(true) : apply()} loading={pending} disabled={!actionable || unresolvedDecimals > 0}>Áp dụng thay đổi đã chọn</Button>
        </div>}
      </div>
    </Dialog>
    <Dialog open={discardOpen} onClose={() => void stayOnFile()} title="Bỏ các lựa chọn đang sửa?" description="Đổi workbook sẽ hủy phiên hiện tại và xóa lựa chọn xung đột, dòng xóa."><div className="tf-ui-actions"><Button variant="secondary" onClick={() => void stayOnFile()}>Ở lại</Button><Button onClick={() => void continueFileChange()}>Tiếp tục và bỏ lựa chọn</Button></div></Dialog>
    <Dialog open={aggregateOpen} onClose={() => setAggregateOpen(false)} title="Xác nhận toàn bộ dòng xóa" description={`Sẽ xóa ${selectedDeletionIds.length} dòng đã chọn. Kiểm tra tổng hợp trước khi áp dụng.`}><div className="tf-ui-actions"><Button variant="secondary" onClick={() => setAggregateOpen(false)}>Quay lại</Button><Button onClick={() => { authorityDispatch({ type: "CONFIRM_DELETIONS", confirmed: true }); setAggregateOpen(false); apply(); }}>Xác nhận và áp dụng</Button></div></Dialog>
  </div>;
}
