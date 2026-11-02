"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { BookText, Plus, Trash2 } from "lucide-react";
import {
  addGlossaryEntry,
  deleteGlossaryEntry,
  type GlossaryActionState,
} from "@/app/actions/recapGlossary";
import { useActionFeedback, useInteraction } from "@/components/InteractionProvider";

type Entry = { id: string; kind: string; text: string; heardAs: string | null; useCount: number };

export default function RecapGlossaryManager({ entries }: { entries: Entry[] }) {
  const { notify } = useInteraction();
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<"TERM" | "RULE">("TERM");
  const [state, formAction, pending] = useActionState<GlossaryActionState, FormData>(addGlossaryEntry, {});
  const [removing, startTransition] = useTransition();
  useActionFeedback(state);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteGlossaryEntry(id);
      if (result.error) notify({ message: result.error, tone: "error" });
      else if (result.success) notify({ message: result.success, tone: "success" });
    });
  }

  const terms = entries.filter((entry) => entry.kind === "TERM");
  const rules = entries.filter((entry) => entry.kind === "RULE");

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
            <BookText size={18} aria-hidden="true" />
          </span>
          <h2 className="font-semibold">Từ điển biên bản họp</h2>
        </div>
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="grid gap-3 border-b border-zinc-100 px-5 py-4 sm:grid-cols-[9rem_1fr_1fr_auto]"
      >
        <select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value === "RULE" ? "RULE" : "TERM")}
          className="tf-field"
          aria-label="Loại mục"
        >
          <option value="TERM">Tên, thuật ngữ</option>
          <option value="RULE">Quy tắc viết</option>
        </select>
        <input
          name="text"
          className={`tf-field ${kind === "RULE" ? "sm:col-span-2" : ""}`}
          placeholder={kind === "RULE" ? "Gọi là đám Strategy, không viết Chiến lược" : "Tuyết Lê"}
          aria-label={kind === "RULE" ? "Quy tắc" : "Cách viết đúng"}
          maxLength={240}
          required
        />
        {kind === "TERM" && (
          <input name="heardAs" className="tf-field" placeholder="Hay bị chép thành: Tuy L" aria-label="Hay bị chép thành" maxLength={120} />
        )}
        <button type="submit" className="tf-button-primary" disabled={pending} aria-busy={pending}>
          {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
          Thêm
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-500">Từ điển chưa có mục nào.</p>
      ) : (
        <div className="divide-y divide-zinc-100">
          {[
            { label: "Tên, thuật ngữ", rows: terms },
            { label: "Quy tắc viết", rows: rules },
          ]
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <div key={group.label} className="px-5 py-3">
                <h3 className="mb-1 text-xs font-medium text-zinc-500">
                  {group.label} ({group.rows.length})
                </h3>
                <ul>
                  {group.rows.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 py-1.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-zinc-900">{entry.text}</span>
                        {entry.heardAs && <span className="ml-2 text-zinc-500">← {entry.heardAs}</span>}
                      </span>
                      {entry.kind === "TERM" && entry.useCount > 0 && (
                        <span className="text-xs text-zinc-400">{entry.useCount} lần xác nhận</span>
                      )}
                      <button
                        type="button"
                        className="tf-icon-button shrink-0"
                        disabled={removing}
                        onClick={() => remove(entry.id)}
                        aria-label={`Xoá ${entry.text}`}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
