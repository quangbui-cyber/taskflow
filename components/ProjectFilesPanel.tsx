"use client";

import { useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Presentation,
  Trash2,
  Upload,
} from "lucide-react";
import { useInteraction } from "@/components/InteractionProvider";
import { uploadStoredFile } from "@/lib/fileUploadClient";
import {
  formatProjectFileSize,
  projectFileTypeLabel,
} from "@/lib/projectFiles";

export type ProjectFileDTO = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  /** Link mở trên Google Drive; null khi file còn lưu trong app. */
  driveUrl: string | null;
  uploader: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
};

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  const className = "text-zinc-500";
  if (mimeType.startsWith("image/")) {
    return <FileImage size={19} className={className} aria-hidden="true" />;
  }
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) {
    return (
      <FileSpreadsheet size={19} className={className} aria-hidden="true" />
    );
  }
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) {
    return <Presentation size={19} className={className} aria-hidden="true" />;
  }
  if (
    mimeType === "application/pdf" ||
    mimeType.includes("word") ||
    mimeType === "application/vnd.google-apps.document" ||
    mimeType.startsWith("text/")
  ) {
    return <FileText size={19} className={className} aria-hidden="true" />;
  }
  return <File size={19} className={className} aria-hidden="true" />;
}

function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className="size-6 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex size-6 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function ProjectFilesPanel({
  projectId,
  currentUserId,
  canManageAll,
  initialFiles,
  driveEnabled = false,
}: {
  projectId: string;
  currentUserId: string;
  canManageAll: boolean;
  initialFiles: ProjectFileDTO[];
  driveEnabled?: boolean;
}) {
  const { notify } = useInteraction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function uploadFile(file: File) {
    setUploading(true);

    try {
      const saved = await uploadStoredFile<ProjectFileDTO>(
        { target: "project", projectId },
        file
      );
      setFiles((current) => [saved, ...current]);
      notify({ message: "Đã thêm tài liệu vào dự án.", tone: "success" });
    } catch (error) {
      notify({
        message:
          error instanceof Error
            ? error.message
            : "Không thể tải tài liệu lên.",
        tone: "error",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function deleteFile(file: ProjectFileDTO) {
    if (!window.confirm(`Xóa tài liệu "${file.name}" khỏi dự án?`)) return;
    setDeletingId(file.id);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/files/${file.id}`,
        { method: "DELETE" }
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "Không thể xóa tài liệu.");
      }
      setFiles((current) => current.filter((item) => item.id !== file.id));
      notify({ message: "Đã xóa tài liệu.", tone: "success" });
    } catch (error) {
      notify({
        message:
          error instanceof Error ? error.message : "Không thể xóa tài liệu.",
        tone: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="tf-panel mx-auto w-full max-w-4xl overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-zinc-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
            <Paperclip size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold text-zinc-950">Tài liệu dự án</h2>
            <p className="text-sm text-zinc-500">
              Lưu PO, brief và thông tin khách hàng cùng dự án.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
        <button
          type="button"
          className="tf-button-primary shrink-0"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          aria-busy={uploading}
        >
          {uploading ? (
            <span className="tf-spinner" aria-hidden="true" />
          ) : (
            <Upload size={16} aria-hidden="true" />
          )}
          {uploading ? "Đang tải..." : "Tải tài liệu"}
        </button>
      </div>

      {files.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
            <FileText size={20} aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-zinc-700">
            Chưa có tài liệu
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Hỗ trợ PDF, hình ảnh, Word, Excel, PowerPoint, TXT và CSV, tối đa
            {driveEnabled ? " 100 MB, lưu trên Google Drive của công ty." : " 4 MB."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100">
          {files.map((file) => {
            const canDelete =
              canManageAll || file.uploader?.id === currentUserId;
            return (
              <div
                key={file.id}
                className="flex min-w-0 items-center gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50/70"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[7px] bg-zinc-100">
                  <FileTypeIcon mimeType={file.mimeType} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {file.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                    <span>{projectFileTypeLabel(file.mimeType)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatProjectFileSize(file.size)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {new Intl.DateTimeFormat("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      }).format(new Date(file.createdAt))}
                    </span>
                  </div>
                </div>

                {file.uploader && (
                  <div
                    className="hidden shrink-0 items-center gap-2 sm:flex"
                    title={`Tải lên bởi ${file.uploader.name}`}
                  >
                    <Avatar
                      name={file.uploader.name}
                      avatarUrl={file.uploader.avatarUrl}
                    />
                    <span className="max-w-28 truncate text-xs text-zinc-500">
                      {file.uploader.name}
                    </span>
                  </div>
                )}

                {file.driveUrl && (
                  <a
                    href={`/api/projects/${projectId}/files/${file.id}?open=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tf-icon-button shrink-0"
                    aria-label={`Mở ${file.name} trên Google Drive`}
                    title="Mở trên Google Drive"
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                  </a>
                )}
                <a
                  href={`/api/projects/${projectId}/files/${file.id}`}
                  className="tf-icon-button shrink-0"
                  aria-label={`Tải xuống ${file.name}`}
                  title="Tải xuống"
                >
                  <Download size={16} aria-hidden="true" />
                </a>
                {canDelete && (
                  <button
                    type="button"
                    className="tf-icon-button shrink-0 text-red-500 hover:text-red-600"
                    disabled={deletingId === file.id}
                    onClick={() => void deleteFile(file)}
                    aria-label={`Xóa ${file.name}`}
                    title="Xóa tài liệu"
                  >
                    {deletingId === file.id ? (
                      <span className="tf-spinner" aria-hidden="true" />
                    ) : (
                      <Trash2 size={16} aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
