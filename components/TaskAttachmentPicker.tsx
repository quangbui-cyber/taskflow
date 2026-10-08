"use client";

import { useRef } from "react";
import { Paperclip, Upload, X } from "lucide-react";
import { formatProjectFileSize } from "@/lib/projectFiles";
import { TASK_FILE_ACCEPT } from "@/lib/taskCreationFiles";

export default function TaskAttachmentPicker({
  label,
  files,
  onChange,
  disabled,
}: {
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mt-2">
      {files.length > 0 && (
        <ul aria-label={label} className="mb-2 divide-y divide-zinc-100 rounded-[8px] border border-zinc-200">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex min-w-0 items-center gap-2 px-2.5 py-2">
              <Paperclip size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-zinc-800" title={file.name}>{file.name}</p>
                <p className="text-[11px] text-zinc-500">{formatProjectFileSize(file.size)}</p>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
                className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0"
                aria-label={`Bỏ chọn ${file.name}`}
                title="Bỏ chọn tệp"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={TASK_FILE_ACCEPT}
        hidden
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const next = [...files];
          for (const file of Array.from(event.target.files ?? [])) {
            if (!next.some((item) =>
              item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
            )) next.push(file);
          }
          onChange(next);
          // Allow choosing the same file again after removing it.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-[7px] border border-dashed border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
      >
        <Upload size={14} aria-hidden="true" />
        {label}
      </button>
    </div>
  );
}
