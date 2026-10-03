"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  ExternalLink,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  Presentation,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  addDocumentLink,
  createDocumentSet,
  deleteDocumentLink,
  deleteDocumentSet,
  renameDocumentFile,
  renameDocumentLink,
  renameDocumentSet,
  type DocumentState,
} from "@/app/actions/documents";
import {
  useActionFeedback,
  useInteraction,
} from "@/components/InteractionProvider";
import { titleFromFileName } from "@/lib/documents";
import {
  formatProjectFileSize,
  projectFileTypeLabel,
} from "@/lib/projectFiles";

/** Một dòng trong bộ hồ sơ: file đính kèm hoặc link. */
export type DocumentFileDTO = {
  kind: "file" | "link";
  id: string;
  title: string;
  mimeType: string; // rỗng với link
  size: number; // 0 với link
  url: string | null; // chỉ có với link
  createdAt: string; // đã định dạng sẵn ở server
  uploaderName: string | null;
};

function linkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export type DocumentSetDTO = {
  id: string;
  name: string;
  description: string | null;
  files: DocumentFileDTO[];
};

const ACCEPTED_FILES =
  ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  const className = "shrink-0 text-zinc-500";
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
    mimeType.startsWith("text/")
  ) {
    return <FileText size={19} className={className} aria-hidden="true" />;
  }
  return <File size={19} className={className} aria-hidden="true" />;
}

/** Ô sửa tên tại chỗ: Enter để lưu, Esc để huỷ. */
function InlineRename({
  initial,
  ariaLabel,
  pending,
  onSave,
  onCancel,
}: {
  initial: string;
  ariaLabel: string;
  pending: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(value);
      }}
    >
      <input
        autoFocus
        value={value}
        maxLength={120}
        aria-label={ariaLabel}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="tf-field !min-h-9 min-w-0 flex-1 !py-1.5"
      />
      <button
        type="submit"
        disabled={pending}
        className="tf-icon-button !h-9 !min-h-9 !w-9 shrink-0 text-emerald-600"
        title="Lưu tên"
        aria-label="Lưu tên"
      >
        <Check size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="tf-icon-button !h-9 !min-h-9 !w-9 shrink-0"
        title="Huỷ"
        aria-label="Huỷ đổi tên"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </form>
  );
}

function DocumentSetPanel({
  set,
  canManage,
}: {
  set: DocumentSetDTO;
  canManage: boolean;
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [renamingSet, setRenamingSet] = useState(false);
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  // File đã chọn nhưng chưa tải lên: chờ người dùng đặt tên.
  const [draft, setDraft] = useState<{ file: File; title: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<{
    title: string;
    url: string;
  } | null>(null);

  function runAction(action: () => Promise<DocumentState>, done?: () => void) {
    startTransition(async () => {
      const result = await action();
      notify({
        message: result.error ?? result.success ?? "Đã lưu.",
        tone: result.error ? "error" : "success",
      });
      if (!result.error) done?.();
    });
  }

  function clearDraft() {
    setDraft(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadDraft() {
    if (!draft) return;
    setUploading(true);
    const body = new FormData();
    body.append("file", draft.file);
    body.append("title", draft.title);
    try {
      const response = await fetch(`/api/documents/sets/${set.id}/files`, {
        method: "POST",
        body,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "Không thể tải tài liệu lên.");
      }
      notify({ message: "Đã thêm tài liệu.", tone: "success" });
      clearDraft();
      router.refresh();
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
    }
  }

  async function deleteFile(file: DocumentFileDTO) {
    if (!window.confirm(`Xoá tài liệu "${file.title}"?`)) return;
    if (file.kind === "link") {
      runAction(() => deleteDocumentLink(file.id));
      return;
    }
    setDeletingId(file.id);
    try {
      const response = await fetch(`/api/documents/files/${file.id}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "Không thể xoá tài liệu.");
      }
      notify({ message: "Đã xoá tài liệu.", tone: "success" });
      router.refresh();
    } catch (error) {
      notify({
        message:
          error instanceof Error ? error.message : "Không thể xoá tài liệu.",
        tone: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="tf-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-5 py-3">
        <FolderOpen size={18} className="shrink-0 text-zinc-500" aria-hidden="true" />
        {renamingSet ? (
          <InlineRename
            initial={set.name}
            ariaLabel="Tên bộ hồ sơ"
            pending={pending}
            onCancel={() => setRenamingSet(false)}
            onSave={(name) =>
              runAction(
                () => renameDocumentSet(set.id, name),
                () => setRenamingSet(false)
              )
            }
          />
        ) : (
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold">{set.name}</h2>
            <p className="truncate text-xs text-zinc-400">
              {set.description ? `${set.description} · ` : ""}
              {set.files.length} tài liệu
            </p>
          </div>
        )}
        {canManage && !renamingSet && (
          <div className="flex shrink-0 items-center gap-1">
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept={ACCEPTED_FILES}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setDraft({ file, title: titleFromFileName(file.name) });
              }}
            />
            <button
              type="button"
              className="tf-button-secondary"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={16} aria-hidden="true" />
              Thêm tài liệu
            </button>
            <button
              type="button"
              className="tf-button-secondary"
              onClick={() => setLinkDraft({ title: "", url: "" })}
            >
              <Link2 size={16} aria-hidden="true" />
              Thêm link
            </button>
            <button
              type="button"
              className="tf-icon-button"
              onClick={() => setRenamingSet(true)}
              title="Đổi tên bộ hồ sơ"
              aria-label={`Đổi tên bộ hồ sơ ${set.name}`}
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="tf-icon-button text-red-500"
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    `Xoá bộ hồ sơ "${set.name}" cùng ${set.files.length} tài liệu bên trong?`
                  )
                ) {
                  runAction(() => deleteDocumentSet(set.id));
                }
              }}
              title="Xoá bộ hồ sơ"
              aria-label={`Xoá bộ hồ sơ ${set.name}`}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {draft && (
        <form
          className="flex flex-wrap items-end gap-3 border-b border-zinc-100 bg-blue-50/50 px-5 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void uploadDraft();
          }}
        >
          <label className="block min-w-0 flex-1 basis-64">
            <span className="text-xs font-medium text-zinc-500">
              Đặt tên cho tài liệu
            </span>
            <input
              autoFocus
              required
              maxLength={120}
              value={draft.title}
              onChange={(event) =>
                setDraft({ file: draft.file, title: event.target.value })
              }
              className="tf-field mt-1.5"
            />
            <span className="mt-1 block truncate text-xs text-zinc-400">
              File: {draft.file.name} · {formatProjectFileSize(draft.file.size)}
            </span>
          </label>
          <div className="flex gap-2 pb-5">
            <button
              type="submit"
              className="tf-button-primary"
              disabled={uploading}
              aria-busy={uploading}
            >
              {uploading ? (
                <span className="tf-spinner" aria-hidden="true" />
              ) : (
                <Upload size={16} aria-hidden="true" />
              )}
              {uploading ? "Đang tải..." : "Tải lên"}
            </button>
            <button
              type="button"
              className="tf-button-secondary"
              disabled={uploading}
              onClick={clearDraft}
            >
              Huỷ
            </button>
          </div>
        </form>
      )}

      {linkDraft && (
        <form
          className="grid items-end gap-3 border-b border-zinc-100 bg-blue-50/50 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            runAction(
              () => addDocumentLink(set.id, linkDraft.title, linkDraft.url),
              () => setLinkDraft(null)
            );
          }}
        >
          <label className="block min-w-0">
            <span className="text-xs font-medium text-zinc-500">
              Tên tài liệu
            </span>
            <input
              autoFocus
              required
              maxLength={120}
              value={linkDraft.title}
              onChange={(event) =>
                setLinkDraft({ ...linkDraft, title: event.target.value })
              }
              placeholder="Ví dụ: Mẫu hợp đồng (Google Docs)"
              className="tf-field mt-1.5"
            />
          </label>
          <label className="block min-w-0">
            <span className="text-xs font-medium text-zinc-500">Link</span>
            <input
              required
              maxLength={2000}
              inputMode="url"
              value={linkDraft.url}
              onChange={(event) =>
                setLinkDraft({ ...linkDraft, url: event.target.value })
              }
              placeholder="https://..."
              className="tf-field mt-1.5"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              className="tf-button-primary"
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? (
                <span className="tf-spinner" aria-hidden="true" />
              ) : (
                <Plus size={16} aria-hidden="true" />
              )}
              Thêm
            </button>
            <button
              type="button"
              className="tf-button-secondary"
              disabled={pending}
              onClick={() => setLinkDraft(null)}
            >
              Huỷ
            </button>
          </div>
        </form>
      )}

      {set.files.length === 0 ? (
        <p className="px-5 py-6 text-sm text-zinc-400">
          Bộ hồ sơ này chưa có tài liệu nào.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-50">
          {set.files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-5 py-2.5">
              {file.kind === "link" ? (
                <Link2 size={19} className="shrink-0 text-blue-600" aria-hidden="true" />
              ) : (
                <FileTypeIcon mimeType={file.mimeType} />
              )}
              {renamingFileId === file.id ? (
                <InlineRename
                  initial={file.title}
                  ariaLabel="Tên tài liệu"
                  pending={pending}
                  onCancel={() => setRenamingFileId(null)}
                  onSave={(title) =>
                    runAction(
                      () =>
                        file.kind === "link"
                          ? renameDocumentLink(file.id, title)
                          : renameDocumentFile(file.id, title),
                      () => setRenamingFileId(null)
                    )
                  }
                />
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {file.title}
                    </p>
                    <p className="truncate text-xs text-zinc-400">
                      {file.kind === "link" && file.url
                        ? `Link · ${linkHost(file.url)}`
                        : `${projectFileTypeLabel(file.mimeType)} · ${formatProjectFileSize(file.size)}`}{" "}
                      · {file.createdAt}
                      {file.uploaderName ? ` · ${file.uploaderName}` : ""}
                    </p>
                  </div>
                  {file.kind === "link" && file.url ? (
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tf-icon-button shrink-0"
                      title="Mở link"
                      aria-label={`Mở link ${file.title}`}
                    >
                      <ExternalLink size={16} aria-hidden="true" />
                    </a>
                  ) : (
                    <a
                      href={`/api/documents/files/${file.id}`}
                      className="tf-icon-button shrink-0"
                      title="Tải về"
                      aria-label={`Tải về ${file.title}`}
                    >
                      <Download size={16} aria-hidden="true" />
                    </a>
                  )}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className="tf-icon-button shrink-0"
                        onClick={() => setRenamingFileId(file.id)}
                        title="Đổi tên tài liệu"
                        aria-label={`Đổi tên ${file.title}`}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="tf-icon-button shrink-0 text-red-500"
                        disabled={pending || deletingId === file.id}
                        onClick={() => void deleteFile(file)}
                        title="Xoá tài liệu"
                        aria-label={`Xoá ${file.title}`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CreateSetForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<DocumentState, FormData>(
    createDocumentSet,
    {}
  );
  useActionFeedback(state);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <section className="tf-panel p-5">
      <h2 className="font-semibold">Tạo bộ hồ sơ</h2>
      <form
        ref={formRef}
        action={formAction}
        className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"
      >
        <input
          name="name"
          required
          maxLength={120}
          placeholder="Tên bộ hồ sơ, ví dụ: Hồ sơ mẫu"
          aria-label="Tên bộ hồ sơ"
          className="tf-field"
        />
        <input
          name="description"
          maxLength={300}
          placeholder="Mô tả ngắn (không bắt buộc)"
          aria-label="Mô tả bộ hồ sơ"
          className="tf-field"
        />
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="tf-button-primary"
        >
          {pending ? (
            <span className="tf-spinner" aria-hidden="true" />
          ) : (
            <Plus size={16} aria-hidden="true" />
          )}
          {pending ? "Đang tạo..." : "Tạo"}
        </button>
      </form>
      {state.error && (
        <p className="mt-2 text-xs text-red-600">{state.error}</p>
      )}
    </section>
  );
}

export default function DocumentSets({
  sets,
  canManage,
}: {
  sets: DocumentSetDTO[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-6">
      {canManage && <CreateSetForm />}
      {sets.length === 0 ? (
        <section className="tf-panel px-5 py-8 text-center text-sm text-zinc-400">
          {canManage
            ? "Chưa có bộ hồ sơ nào. Tạo bộ hồ sơ đầu tiên ở trên."
            : "Chưa có bộ hồ sơ nào."}
        </section>
      ) : (
        sets.map((set) => (
          <DocumentSetPanel key={set.id} set={set} canManage={canManage} />
        ))
      )}
    </div>
  );
}
