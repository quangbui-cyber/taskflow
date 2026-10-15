"use client";
// Authenticated private bytes are deliberately displayed without an image optimizer/cache.
/* eslint-disable @next/next/no-img-element */

import { useState, type ReactNode } from "react";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Select, Input, Textarea } from "./ui/Field";
import { Alert } from "./ui/Presentation";

export type EvidenceFile = { id: string; name: string; requestId: string | null; kind: string; mimeType?: string; sha256?: string };
type EvidenceFinance = { project: { id: string }; files: { id: string; name: string }[] };
export default function IcEvidencePanel({ finance, open, onClose, targets, ids, reason, files, onFiles, onChange, readOnly = false, footer }: {
  finance: EvidenceFinance; open: boolean; onClose: () => void; targets: string[]; ids: string[]; reason: string; files: EvidenceFile[];
  onFiles: (file: EvidenceFile) => void; onChange: (ids: string[], reason: string) => void; readOnly?: boolean; footer?: ReactNode;
}) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [source, setSource] = useState(""); const [preview, setPreview] = useState<EvidenceFile | null>(null);
  const upload = async (form: FormData) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${finance.project.id}/costflow/evidence/upload`, { method: "POST", body: form });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Tải file thất bại.");
      onFiles(result.evidence); onChange([...new Set([...ids, result.evidence.id])], reason);
    } catch (e) { setError(e instanceof Error ? e.message : "Tải file thất bại. Chọn lại để thử."); } finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={onClose} title="Minh chứng IC" description={targets.join(" · ")} footer={footer}>
    <div className="tf-ic-evidence-panel space-y-4">
      <p>Minh chứng dự toán · Lựa chọn áp dụng cho {targets.length} dòng/phạm vi. Liên kết chỉ được lưu khi lưu nháp.</p>
      {!readOnly && <fieldset disabled={busy} className="space-y-3"><Input type="file" label="Tải file mới (tối đa 4 MiB/file)" onChange={e => { const file = e.target.files?.[0]; if (file) { const form = new FormData(); form.set("proof", file); void upload(form); } e.target.value = ""; }} /><Select label="Tài liệu dự án" value={source} onChange={e => setSource(e.target.value)}><option value="">Chọn tài liệu</option>{finance.files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</Select><Button variant="secondary" disabled={!source} onClick={() => { const form = new FormData(); form.set("sourceFileId", source); void upload(form); }}>Lưu bản minh chứng từ tài liệu</Button></fieldset>}
      {busy && <p role="status">Đang tải…</p>}{error && <Alert tone="danger" title={error} />}
      <ul className="space-y-3">{files.filter(f => !readOnly || ids.includes(f.id)).map(file => <li key={file.id}><label><input type="checkbox" checked={ids.includes(file.id)} disabled={readOnly || busy} onChange={e => onChange(e.target.checked ? [...new Set([...ids,file.id])] : ids.filter(id=>id!==file.id),reason)} /> {file.name}</label> <Button variant="ghost" onClick={()=>setPreview(file)}>Xem</Button> <a className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${file.id}`}>Tải về</a><p className="tf-ui-help">{ids.includes(file.id) ? "Đã chọn liên kết" : "Đã tải, chưa gắn dòng"} · SHA-256 {file.sha256 ?? "đã lưu"}</p></li>)}</ul>
      <Textarea label="Lý do chưa có minh chứng" value={reason} disabled={readOnly} onChange={e=>onChange(ids,e.target.value)} />
      {preview && <div><h3>{preview.name}</h3>{preview.mimeType === "application/pdf" ? <iframe title={`Xem ${preview.name}`} sandbox="" src={`/api/projects/${finance.project.id}/costflow/evidence/${preview.id}/preview`} className="tf-evidence-preview" /> : ["image/png","image/jpeg"].includes(preview.mimeType ?? "") ? <img alt={preview.name} src={`/api/projects/${finance.project.id}/costflow/evidence/${preview.id}/preview`} className="tf-evidence-preview" /> : <p>Định dạng này hỗ trợ tải về.</p>}<Button variant="ghost" onClick={()=>setPreview(null)}>Đóng xem trước</Button></div>}
    </div>
  </Dialog>;
}
