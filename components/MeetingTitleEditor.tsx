"use client";

import { useId, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { renameMeetingTitle } from "@/app/actions/meetingRecaps";
import { useInteraction } from "@/components/InteractionProvider";
import { MEETING_TITLE_MAX } from "@/lib/meetings";

export default function MeetingTitleEditor({ meetingId, title, canEdit }: {
  meetingId: string;
  title: string;
  canEdit: boolean;
}) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();

  if (!canEdit || !editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="tf-page-title !mt-0 break-words">{title}</h1>
        {canEdit && (
          <button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            onClick={() => { setDraft(title); setError(null); setEditing(true); }}>
            <Pencil size={14} aria-hidden="true" /> Đổi tên
          </button>
        )}
      </div>
    );
  }

  return (
    <form className="mt-1 space-y-2" aria-busy={pending} onSubmit={(event) => {
      event.preventDefault();
      setError(null);
      startTransition(async () => {
        try {
          const result = await renameMeetingTitle(meetingId, draft);
          if (result.error) setError(result.error);
          else {
            setEditing(false);
            notify({ message: result.success ?? "Đã đổi tên cuộc họp.", tone: "success" });
          }
        } catch {
          setError("Chưa thể đổi tên cuộc họp. Bạn thử lại nhé.");
        }
      });
    }}>
      <label htmlFor={inputId} className="sr-only">Tên cuộc họp</label>
      <input id={inputId} name="title" className="tf-field w-full" value={draft}
        onChange={(event) => setDraft(event.target.value)} required minLength={2} maxLength={MEETING_TITLE_MAX}
        disabled={pending} autoFocus aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined}
        onKeyDown={(event) => { if (event.key === "Escape" && !pending) setEditing(false); }} />
      {error && <p id={`${inputId}-error`} role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="tf-button-primary !min-h-9 !px-3 text-sm">
          {pending ? "Đang lưu…" : "Lưu tên"}
        </button>
        <button type="button" disabled={pending} onClick={() => setEditing(false)} className="tf-button-secondary !min-h-9 !px-3 text-sm">Huỷ</button>
      </div>
    </form>
  );
}
