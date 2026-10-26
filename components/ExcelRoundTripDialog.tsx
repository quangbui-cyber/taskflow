"use client";

import { useRef, useState, useTransition } from "react";
import { confirmRoundTripMergeAction } from "@/app/actions/costflowExcelIntake";
import type { RoundTripDiff } from "@/lib/costflow/excelRoundTrip";
import type { PairedRow } from "@/lib/costflow/types";
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
  const [resumeSessionId, setResumeSessionId] = useState("");
  const [selectedDeletionIds, setSelectedDeletionIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, startTransition] = useTransition();
  const operationId = useRef(crypto.randomUUID());
  const sourceRevision = useRef(1);

  const close = () => setOpen(false);
  const acceptSession = (result: PreviewSession) => {
    if (result.operationKind !== "ROUND_TRIP" || (result.display?.draft.id && result.display.draft.id !== draftId)) throw new Error("Phiên xem trước không thuộc nháp hiện tại.");
    setPreview(result);
    setResumeSessionId(result.previewSessionId);
    setSelectedDeletionIds([]);
    setError("");
    setSuccess("");
    operationId.current = crypto.randomUUID();
  };
  const review = () => {
    if (!file) { setError("Chọn workbook round-trip đã chỉnh sửa."); return; }
    startTransition(async () => {
      try {
        const body = new FormData();
        body.set("file", file);
        body.set("sourceRevision", String(sourceRevision.current++));
        const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/round-trip/preview`, { method: "POST", body });
        const result = await response.json() as PreviewSession & { error?: string };
        if (!response.ok || result.error) throw new Error(result.error || "Không xem trước được workbook.");
        acceptSession(result);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Không xem trước được workbook."); }
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
    if (!preview || preview.state !== "ACTIONABLE" || !preview.display) return;
    startTransition(async () => {
      const result = await confirmRoundTripMergeAction({
        projectId,
        draftId,
        previewSessionId: preview.previewSessionId,
        selectedDeletionIds,
        idempotencyKey: `excel-round-trip:${operationId.current}`,
      });
      if ("error" in result) {
        setError(/thay đổi|đồng thời/i.test(result.error) ? `Nháp trên máy chủ đã thay đổi (server draft changed). ${result.error}` : result.error);
        return;
      }
      setError("");
      setSuccess(`Đã áp dụng workbook vào nháp v${result.draftVersion}. Phiên chuyển sang chỉ đọc.`);
      setPreview(current => current ? { ...current, state: "READ_ONLY_CONSUMED", result } : current);
      onApplied({ rows: result.rows, version: result.version, draftVersion: result.draftVersion });
    });
  };
  const diff = preview?.display?.diff;
  const actionable = preview?.state === "ACTIONABLE" && !!diff;
  const deletionNames = diff?.deletionCandidates.filter(row => selectedDeletionIds.includes(row.itemId)).map(row => row.name) ?? [];

  return <div className="tf-round-trip-actions">
    <a className="tf-button-secondary tf-button-size-sm" aria-disabled={dirty || undefined} href={dirty ? undefined : `/api/projects/${projectId}/costflow/excel-intake/drafts/${draftId}`}>
      Xuất Excel
    </a>
    <Button size="sm" variant="secondary" disabled={dirty} onClick={() => setOpen(true)}>Re-import Excel</Button>
    {dirty && <span className="tf-ui-help">Lưu Worksheet trước khi xuất hoặc re-import.</span>}
    <Dialog open={open} onClose={close} title="Đối chiếu Excel round-trip" description="Máy chủ giữ authority; trình duyệt chỉ gửi lựa chọn xóa và mã phiên." className="tf-dialog-wide">
      <div className="tf-round-trip">
        <label className="tf-ui-label">Workbook đã chỉnh sửa<input type="file" accept=".xlsx" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); }} /></label>
        <Button onClick={review} loading={pending}>Xem thay đổi</Button>
        <label className="tf-ui-label">Mã phiên xem trước<input className="tf-field" value={resumeSessionId} onChange={event => setResumeSessionId(event.target.value)} /></label>
        <Button variant="secondary" onClick={resume} disabled={!resumeSessionId.trim()} loading={pending}>Mở phiên</Button>
        {preview && <p className="tf-ui-help">Phiên {preview.previewSessionId} · hết hạn {new Date(preview.expiresAt).toLocaleString("vi-VN")}</p>}
        {error && <Alert tone="danger" title="Chưa thể áp dụng">{error}</Alert>}
        {success && <Alert tone="success" title="Đã cập nhật">{success}</Alert>}
        {preview?.state === "READ_ONLY_CONSUMED" && <Alert tone="success" title="Bản xem lại chỉ đọc">Phiên đã được áp dụng và không thể chạy lại. {preview.source && <a href={preview.source.downloadUrl}>Tải nguồn {preview.source.filename}</a>}</Alert>}
        {preview?.state.startsWith("NON_ACTIONABLE_") && <Alert tone="warning" title="Phiên không còn hiệu lực">Phiên đã hết hạn, bị thay thế hoặc bị hủy; payload xem trước đã được xóa.</Alert>}
        {diff && <div className="tf-round-trip-groups" aria-readonly={!actionable}>
          <section><h3>Thêm mới ({diff.adds.length})</h3>{diff.adds.map(row => <p key={row.previewKey}>{row.row.name || "Dòng mới"} · ô {row.source.cell}</p>)}</section>
          <section><h3>Thay đổi ({diff.changes.length})</h3>{diff.changes.map((change, index) => <p key={`${change.itemId}-${change.field}-${index}`}><strong>{change.field}</strong>: {String(change.oldValue) || "—"} → {String(change.newValue) || "—"} · ô {change.source.cell}</p>)}</section>
          <section><h3>Di chuyển ({diff.moves.length})</h3>{diff.moves.map(move => <p key={move.itemId}>{move.itemId}: {move.oldParentItemId || "Gốc"} → {move.newParentItemId || "Gốc"} · ô {move.source.cell}</p>)}</section>
          <section><h3>Dòng có thể xóa ({diff.deletionCandidates.length})</h3><p className="tf-ui-help">Mặc định không xóa. Chỉ dòng được chọn dưới đây mới bị xóa.</p>{diff.deletionCandidates.map(row => <label key={row.itemId}><input type="checkbox" disabled={!actionable} checked={selectedDeletionIds.includes(row.itemId)} onChange={event => setSelectedDeletionIds(current => event.target.checked ? [...current, row.itemId] : current.filter(id => id !== row.itemId))} /> {row.name}</label>)}</section>
          {deletionNames.length > 0 && <Alert tone="warning" title="Xác nhận xóa">Sẽ xóa: {deletionNames.join(", ")}. Các dòng chưa chọn vẫn được giữ nguyên.</Alert>}
          <div className="tf-round-trip-summary">Tổng mới được máy chủ tính lại. Thêm {diff.adds.length}, sửa {diff.changes.length}, di chuyển {diff.moves.length}, xác nhận xóa {selectedDeletionIds.length}.</div>
          <Button onClick={apply} loading={pending} disabled={!actionable}>Áp dụng thay đổi đã chọn</Button>
        </div>}
      </div>
    </Dialog>
  </div>;
}
