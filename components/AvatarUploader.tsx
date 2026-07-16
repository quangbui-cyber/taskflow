"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import Avatar from "@/components/Avatar";

const MAX_SOURCE_SIZE = 5 * 1024 * 1024;
const OUTPUT_SIZE = 256;

async function resizeAvatar(file: File) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Không thể đọc ảnh."));
      image.src = sourceUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt không thể xử lý ảnh.");

    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - side) / 2;
    const sourceY = (image.naturalHeight - side) / 2;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      side,
      side,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE
    );

    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export default function AvatarUploader({
  name = "avatarUrl",
  id,
  displayName,
  defaultValue = "",
  compact = false,
  onChange,
}: {
  name?: string;
  id: string;
  displayName: string;
  defaultValue?: string | null;
  compact?: boolean;
  onChange?: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(defaultValue ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const reset = () => {
      setAvatarUrl(defaultValue ?? "");
      setError("");
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue]);

  function updateAvatar(value: string) {
    setAvatarUrl(value);
    onChange?.(value);
  }

  async function handleFile(file?: File) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Vui lòng chọn tệp ảnh.");
      return;
    }
    if (file.size > MAX_SOURCE_SIZE) {
      setError("Ảnh gốc không được vượt quá 5 MB.");
      return;
    }

    try {
      updateAvatar(await resizeAvatar(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể xử lý ảnh.");
    }
  }

  return (
    <div ref={rootRef} className={compact ? "flex items-center gap-2" : "space-y-2"}>
      <input type="hidden" name={name} value={avatarUrl} />
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <Avatar
        id={id}
        name={displayName}
        avatarUrl={avatarUrl}
        className={compact ? "h-10 w-10 text-sm" : "h-16 w-16 text-lg"}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
        >
          <ImagePlus size={14} aria-hidden="true" />
          {avatarUrl ? "Đổi ảnh" : "Thêm ảnh"}
        </button>
        {avatarUrl && (
          <button
            type="button"
            onClick={() => {
              updateAvatar("");
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="tf-icon-button !h-8 !min-h-8 !w-8 !border-transparent hover:!border-red-100 hover:!bg-red-50 hover:!text-red-500"
            title="Xoá ảnh"
            aria-label={`Xoá ảnh đại diện ${displayName}`}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
