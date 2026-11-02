"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Send, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import type { SendRecapInput } from "@/app/actions/meetingRecaps";

export type RecapPerson = { id: string; name: string; avatarUrl: string | null };
export type RecapDirectoryPerson = RecapPerson & { email: string };

export default function RecapSendDialog({
  title,
  when,
  attendees,
  directory,
  initialExtraIds,
  pending,
  resend,
  onClose,
  onSend,
}: {
  title: string;
  when: string;
  attendees: RecapPerson[];
  directory: RecapDirectoryPerson[];
  initialExtraIds: string[];
  pending: boolean;
  resend: boolean;
  onClose: () => void;
  onSend: (input: SendRecapInput) => void;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [extraIds, setExtraIds] = useState<string[]>(initialExtraIds);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [pending, onClose]);

  const byId = useMemo(() => new Map(directory.map((person) => [person.id, person])), [directory]);
  const extras = extraIds.map((id) => byId.get(id)).filter((person): person is RecapDirectoryPerson => Boolean(person));
  const normalized = query.trim().toLocaleLowerCase("vi");
  const matches = directory
    .filter((person) => !extraIds.includes(person.id))
    .filter((person) => !normalized || `${person.name} ${person.email}`.toLocaleLowerCase("vi").includes(normalized))
    .slice(0, 8);
  const total = attendees.filter((person) => !skipped.has(person.id)).length + extras.length;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="tf-overlay-enter fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-zinc-950/45 p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="recap-send-title"
        className="tf-modal-enter my-auto w-full max-w-lg rounded-[16px] border border-zinc-200 bg-white p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="recap-send-title" className="text-base font-semibold text-zinc-900">
              {resend ? "Gửi lại biên bản" : "Gửi biên bản họp"}
            </h2>
            <p className="mt-0.5 truncate text-sm text-zinc-500">
              {title} · {when}
            </p>
          </div>
          <button type="button" className="tf-icon-button shrink-0" onClick={onClose} disabled={pending} aria-label="Đóng">
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-5 text-xs font-medium text-zinc-500">Người tham dự ({attendees.length})</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attendees.map((person) => {
            const off = skipped.has(person.id);
            return (
              <button
                key={person.id}
                type="button"
                aria-pressed={!off}
                onClick={() =>
                  setSkipped((current) => {
                    const next = new Set(current);
                    if (next.has(person.id)) next.delete(person.id);
                    else next.add(person.id);
                    return next;
                  })
                }
                className={`inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 text-sm text-zinc-800 transition-opacity duration-150 hover:bg-zinc-50 ${
                  off ? "opacity-50 line-through" : ""
                }`}
              >
                <Avatar id={person.id} name={person.name} avatarUrl={person.avatarUrl} className="h-6 w-6 text-[11px]" />
                {person.name}
              </button>
            );
          })}
        </div>

        <p className="mt-5 text-xs font-medium text-zinc-500">Người nhận thêm ({extras.length})</p>
        {extras.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {extras.map((person) => (
              <span
                key={person.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-400 bg-brand-50 py-1 pl-1 pr-2 text-sm text-zinc-800"
              >
                <Avatar id={person.id} name={person.name} avatarUrl={person.avatarUrl} className="h-6 w-6 text-[11px]" />
                {person.name}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-zinc-500 hover:text-zinc-900"
                  aria-label={`Bỏ ${person.name}`}
                  onClick={() => setExtraIds((current) => current.filter((id) => id !== person.id))}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative mt-2">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            placeholder="Tìm đồng nghiệp theo tên hoặc email"
            className="tf-field w-full !pl-9"
            autoComplete="off"
            aria-label="Tìm người nhận thêm"
          />
          {open && (
            <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-[12px] border border-zinc-200 bg-white p-1 shadow-lg">
              {matches.length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-zinc-500">Không tìm thấy ai</p>
              ) : (
                matches.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-sm hover:bg-zinc-50"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setExtraIds((current) => [...current, person.id]);
                      setQuery("");
                    }}
                  >
                    <Avatar id={person.id} name={person.name} avatarUrl={person.avatarUrl} className="h-6 w-6 text-[11px]" />
                    <span className="min-w-0 flex-1 truncate text-zinc-900">{person.name}</span>
                    <span className="truncate text-xs text-zinc-500">{person.email}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
          <span className="text-sm text-zinc-500">{total} người sẽ nhận</span>
          <div className="flex gap-2">
            <button type="button" className="tf-button-secondary" onClick={onClose} disabled={pending}>
              Huỷ
            </button>
            <button
              type="button"
              className="tf-button-primary"
              disabled={pending}
              aria-busy={pending}
              onClick={() => onSend({ skipUserIds: [...skipped], extraUserIds: extraIds })}
            >
              {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
              Gửi cho {total} người
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
