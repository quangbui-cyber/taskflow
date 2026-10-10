"use client";

import { useRef, useState, useTransition } from "react";
import { confirmRoundTripMergeAction } from "@/app/actions/costflowExcelIntake";
import type { RoundTripDiff, RoundTripImport } from "@/lib/costflow/excelRoundTrip";
import type { PairedRow } from "@/lib/costflow/types";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Alert } from "./ui/Presentation";

type Preview = {
  workspaceVersion: number;
  draft: { id: string; version: number };
  imported: RoundTripImport;
  diff: RoundTripDiff;
};

export default function ExcelRoundTripDialog({ projectId, draftId, dirty, onApplied }: {
  projectId: string;
  draftId: string;
  dirty: boolean;
  onApplied: (result: { rows: PairedRow[]; version: number; draftVersion: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedDeletionIds, setSelectedDeletionIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, startTransition] = useTransition();
  const operationId = useRef(crypto.randomUUID());

  const close = () => setOpen(false);
  const review = () => {
    if (!file) { setError("Chọn workbook round-trip đã chỉnh sửa."); return; }
    startTransition(async () => {
      try {
        const body = new FormData(); body.set("file", file);
        const response = await fetch(`/api/projects/${projectId}/costflow/excel-intake/round-trip/preview`, { method: "POST", body });
        const result = await response.json() as Preview & { error?: string };
        if (!response.ok || result.error) throw new Error(result.error || "Không xem trước được workbook.");
        setPreview(result); setSelectedDeletionIds([]); setError(""); setSuccess(""); operationId.current = crypto.randomUUID();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Không xem trước được workbook."); }
    });
  };
  const apply = () => {
    if (!preview) return;
    startTransition(async () => {
      const result = await confirmRoundTripMergeAction({
        projectId,
        draftId,
        expectedWorkspaceVersion: preview.workspaceVersion,
        expectedDraftVersion: preview.draft.version,
        expectedDraftFingerprint: preview.imported.fingerprint,
        previewFingerprint: preview.diff.previewFingerprint,
        imported: preview.imported,
        selectedDeletionIds,
        idempotencyKey: `excel-round-trip:${operationId.current}`,
      });
      if ("error" in result) {
        setError(/thay đổi|đồng thời/i.test(result.error) ? `Nháp trên máy chủ đã thay đổi (server draft changed). ${result.error}` : result.error);
        return;
      }
      setError(""); setSuccess(`Đã áp dụng workbook vào nháp v${result.draftVersion}.`);
      onApplied({ rows: result.rows, version: result.version, draftVersion: result.draftVersion });
    });
  };
  const deletionNames = preview?.diff.deletionCandidates.filter(row => selectedDeletionIds.includes(row.itemId)).map(row => row.name) ?? [];

  return <div className="tf-round-trip-actions">
    <a className="tf-button-secondary tf-button-size-sm" aria-disabled={dirty || undefined} href={dirty ? undefined : `/api/projects/${projectId}/costflow/excel-intake/drafts/${draftId}`}>
      Xuất Excel
    </a>
    <Button size="sm" variant="secondary" disabled={dirty} onClick={() => setOpen(true)}>Re-import Excel</Button>
    {dirty && <span className="tf-ui-help">Lưu Worksheet trước khi xuất hoặc re-import.</span>}
    <Dialog open={open} onClose={close} title="Đối chiếu Excel round-trip" description="Máy chủ tính lại dữ liệu và chỉ cập nhật nháp đang chỉnh sửa." className="tf-dialog-wide">
      <div className="tf-round-trip">
        <label className="tf-ui-label">Workbook đã chỉnh sửa<input type="file" accept=".xlsx" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); }} /></label>
        <Button onClick={review} loading={pending}>Xem thay đổi</Button>
        {error && <Alert tone="danger" title="Chưa thể áp dụng">{error}</Alert>}
        {success && <Alert tone="success" title="Đã cập nhật">{success}</Alert>}
        {preview && <div className="tf-round-trip-groups">
          <section><h3>Thêm mới ({preview.diff.adds.length})</h3>{preview.diff.adds.map(row => <p key={row.previewKey}>{row.row.name || "Dòng mới"} · ô {row.source.cell}</p>)}</section>
          <section><h3>Thay đổi ({preview.diff.changes.length})</h3>{preview.diff.changes.map((change, index) => <p key={`${change.itemId}-${change.field}-${index}`}><strong>{change.field}</strong>: {String(change.oldValue) || "—"} → {String(change.newValue) || "—"} · ô {change.source.cell}</p>)}</section>
          <section><h3>Di chuyển ({preview.diff.moves.length})</h3>{preview.diff.moves.map(move => <p key={move.itemId}>{move.itemId}: {move.oldParentItemId || "Gốc"} → {move.newParentItemId || "Gốc"} · ô {move.source.cell}</p>)}</section>
          <section><h3>Dòng có thể xóa ({preview.diff.deletionCandidates.length})</h3><p className="tf-ui-help">Mặc định không xóa. Chỉ dòng được chọn dưới đây mới bị xóa.</p>{preview.diff.deletionCandidates.map(row => <label key={row.itemId}><input type="checkbox" checked={selectedDeletionIds.includes(row.itemId)} onChange={event => setSelectedDeletionIds(current => event.target.checked ? [...current, row.itemId] : current.filter(id => id !== row.itemId))} /> {row.name}</label>)}</section>
          {deletionNames.length > 0 && <Alert tone="warning" title="Xác nhận xóa">Sẽ xóa: {deletionNames.join(", ")}. Các dòng chưa chọn vẫn được giữ nguyên.</Alert>}
          <div className="tf-round-trip-summary">Tổng mới được máy chủ tính lại. Thêm {preview.diff.adds.length}, sửa {preview.diff.changes.length}, di chuyển {preview.diff.moves.length}, xác nhận xóa {selectedDeletionIds.length}.</div>
          <Button onClick={apply} loading={pending}>Áp dụng thay đổi đã chọn</Button>
        </div>}
      </div>
    </Dialog>
  </div>;
}
