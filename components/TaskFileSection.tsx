"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { useInteraction } from "@/components/InteractionProvider";
import {
  MAX_PROJECT_FILE_SIZE,
  formatProjectFileSize,
} from "@/lib/projectFiles";
import type { TaskFileDTO, TaskFileKind } from "@/lib/types";

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

async function readError(response: Response, fallback: string) {
  // Vercel trả 413 dạng văn bản (không phải JSON) khi request vượt giới hạn.
  if (response.status === 413) return "Tệp quá lớn — tối đa 4 MB.";
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export default function TaskFileSection({
  taskId,
  kind,
  initialFiles,
  currentUserId,
}: {
  taskId: string;
  kind: TaskFileKind;
  initialFiles: TaskFileDTO[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const isResult = kind === "RESULT";

  async function uploadFiles(selected: File[]) {
    const tooLarge = selected.filter((f) => f.size > MAX_PROJECT_FILE_SIZE);
    if (tooLarge.length > 0) {
      notify({
        message: `“${tooLarge[0].name}” lớn hơn 4 MB — chưa tải lên.`,
        tone: "error",
      });
    }
    const accepted = selected.filter((f) => f.size <= MAX_PROJECT_FILE_SIZE);
    if (accepted.length === 0) return;

    setUploading(true);
    let uploaded = 0;
    for (const file of accepted) {
      const body = new FormData();
      body.append("kind", kind);
      body.append("file", file);
      try {
        const response = await fetch(`/api/tasks/${taskId}/files`, {
          method: "POST",
          body,
        });
        if (!response.ok) {
          throw new Error(await readError(response, "Không thể tải tệp lên."));
        }
        const result = (await response.json()) as { file: TaskFileDTO };
        setFiles((current) => [...current, result.file]);
        uploaded += 1;
      } catch (error) {
        notify({
          message: `${file.name}: ${
            error instanceof Error ? error.message : "Không thể tải tệp lên."
          }`,
          tone: "error",
        });
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (uploaded > 0) {
      notify({
        message: uploaded === 1 ? "Đã tải tệp lên." : `Đã tải ${uploaded} tệp lên.`,
        tone: "success",
      });
      router.refresh();
    }
  }

  async function deleteFile(file: TaskFileDTO) {
    if (!window.confirm(`Xoá tệp “${file.name}”?`)) return;
    setDeletingId(file.id);
    try {
      const response = await fetch(`/api/tasks/${taskId}/files/${file.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Không thể xoá tệp."));
      }
      setFiles((current) => current.filter((item) => item.id !== file.id));
      notify({ message: "Đã xoá tệp.", tone: "success" });
      router.refresh();
    } catch (error) {
      notify({
        message: error instanceof Error ? error.message : "Không thể xoá tệp.",
        tone: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mt-2">
      {files.length > 0 && (
        <ul
          className={`mb-2 divide-y rounded-[8px] border ${
            isResult
              ? "divide-emerald-100 border-emerald-200"
              : "divide-zinc-100 border-zinc-200"
          }`}
        >
          {files.map((file) => (
            <li key={file.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
              <Paperclip size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-800">{file.name}</p>
                <p className="text-[11px] text-zinc-400">
                  {formatProjectFileSize(file.size)}
                  {file.uploader && ` · ${file.uploader.name}`}
                </p>
              </div>
              <a
                href={`/api/tasks/${taskId}/files/${file.id}`}
                className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0"
                aria-label={`Tải xuống ${file.name}`}
                title="Tải xuống"
              >
                <Download size={15} aria-hidden="true" />
              </a>
              {file.uploader?.id === currentUserId && (
                <button
                  type="button"
                  className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0 text-red-500 hover:text-red-600"
                  disabled={deletingId === file.id}
                  onClick={() => void deleteFile(file)}
                  aria-label={`Xoá ${file.name}`}
                  title="Xoá tệp"
                >
                  {deletingId === file.id ? (
                    <span className="tf-spinner" aria-hidden="true" />
                  ) : (
                    <Trash2 size={15} aria-hidden="true" />
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          if (selected.length > 0) void uploadFiles(selected);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        aria-busy={uploading}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-[7px] border border-dashed px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
          isResult
            ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            : "border-zinc-300 text-zinc-500 hover:border-brand-300 hover:text-brand-700"
        }`}
      >
        {uploading ? (
          <span className="tf-spinner" aria-hidden="true" />
        ) : (
          <Upload size={14} aria-hidden="true" />
        )}
        {uploading
          ? "Đang tải..."
          : isResult
            ? "Đính kèm tệp kết quả"
            : "Đính kèm tệp giao việc"}
        <span className="text-zinc-400">· tối đa 4 MB</span>
      </button>
    </div>
  );
}
