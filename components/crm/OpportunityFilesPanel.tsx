"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, FileText, Trash2, Upload } from "lucide-react";
import { useInteraction } from "@/components/InteractionProvider";
import type { ProjectFileDTO } from "@/components/ProjectFilesPanel";
import { uploadStoredFile } from "@/lib/fileUploadClient";
import { formatProjectFileSize, projectFileTypeLabel } from "@/lib/projectFiles";

export default function OpportunityFilesPanel({ opportunityId, currentUserId, canUpload, canManageAll, readOnlyProjectId, initialFiles }: {
  opportunityId: string; currentUserId: string; canUpload: boolean; canManageAll: boolean; readOnlyProjectId: string | null; initialFiles: ProjectFileDTO[];
}) {
  const { notify } = useInteraction(), router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false), [deletingId, setDeletingId] = useState<string | null>(null);
  const [files, setFiles] = useState(initialFiles);
  const base = readOnlyProjectId ? `/api/projects/${readOnlyProjectId}/files` : `/api/crm/opportunities/${opportunityId}/files`;
  async function upload(file: File) {
    setUploading(true);
    try {
      const saved = await uploadStoredFile<ProjectFileDTO>({ target: "opportunity", opportunityId }, file);
      setFiles(rows => [saved, ...rows]); router.refresh();
      notify({ message: "Đã thêm tài liệu vào Cơ hội.", tone: "success" });
    } catch (error) { notify({ message: error instanceof Error ? error.message : "Không thể tải tài liệu lên.", tone: "error" }); }
    finally { setUploading(false); if (input.current) input.current.value = ""; }
  }
  async function remove(file: ProjectFileDTO) {
    if (!window.confirm(`Xóa tài liệu "${file.name}" khỏi Cơ hội?`)) return;
    setDeletingId(file.id);
    try {
      const response = await fetch(`${base}/${file.id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Không thể xóa tài liệu.");
      setFiles(rows => rows.filter(row => row.id !== file.id)); router.refresh();
      notify({ message: "Đã xóa tài liệu.", tone: "success" });
    } catch (error) { notify({ message: error instanceof Error ? error.message : "Không thể xóa tài liệu.", tone: "error" }); }
    finally { setDeletingId(null); }
  }
  return <section className="tf-panel overflow-hidden" aria-labelledby="opportunity-files-title">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 px-5 py-3">
      <h2 id="opportunity-files-title" className="text-base font-semibold">File</h2>
      {canUpload && !readOnlyProjectId && <><input ref={input} type="file" className="sr-only" aria-label="Chọn tài liệu" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        <button type="button" className="tf-button-secondary" disabled={uploading} aria-busy={uploading} onClick={() => input.current?.click()}>{uploading ? <span className="tf-spinner" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}{uploading ? "Đang tải..." : "Tải tài liệu"}</button></>}
    </header>
    {!files.length ? <p className="px-5 py-8 text-sm text-zinc-500">Chưa có file.</p> : <ul className="divide-y divide-zinc-100">{files.map(file => <li key={file.id} className="flex min-w-0 items-center gap-2 px-5 py-4">
      <FileText size={18} className="shrink-0 text-zinc-500" aria-hidden="true" />
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{file.name}</p><p className="mt-1 text-xs text-zinc-500">{projectFileTypeLabel(file.mimeType)} · {formatProjectFileSize(file.size)}{file.uploader ? ` · ${file.uploader.name}` : ""}</p></div>
      <a href={`${base}/${file.id}?open=1`} target="_blank" rel="noopener noreferrer" className="tf-icon-button shrink-0" aria-label={`Mở ${file.name}`}><ExternalLink size={16} aria-hidden="true" /></a>
      <a href={`${base}/${file.id}`} className="tf-icon-button shrink-0" aria-label={`Tải xuống ${file.name}`}><Download size={16} aria-hidden="true" /></a>
      {!readOnlyProjectId && (canManageAll || file.uploader?.id === currentUserId) && <button type="button" className="tf-icon-button shrink-0 text-red-600" disabled={deletingId === file.id} aria-busy={deletingId === file.id} aria-label={`Xóa ${file.name}`} onClick={() => void remove(file)}>{deletingId === file.id ? <span className="tf-spinner" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}</button>}
    </li>)}</ul>}
  </section>;
}
