"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookPlus } from "lucide-react";
import { acceptGlossarySuggestions, dismissGlossarySuggestions } from "@/app/actions/recapGlossary";
import { useInteraction } from "@/components/InteractionProvider";
import type { GlossarySuggestion } from "@/lib/recapGlossary";

export default function RecapGlossarySuggestions({
  meetingId,
  suggestions,
}: {
  meetingId: string;
  suggestions: GlossarySuggestion[];
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  if (suggestions.length === 0) return null;

  const keyOf = (item: GlossarySuggestion) => `${item.wrong}\u0000${item.right}`;
  const picked = suggestions.filter((item) => !unchecked.has(keyOf(item)));

  function run(action: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) notify({ message: result.error, tone: "error" });
      else if (result.success) notify({ message: result.success, tone: "success" });
      router.refresh();
    });
  }

  return (
    <div className="mt-5 rounded-[12px] border border-zinc-200 bg-zinc-50 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-zinc-900">
        <BookPlus size={16} className="text-brand-700" aria-hidden="true" />
        Thêm {suggestions.length} từ vào từ điển?
      </p>
      <ul className="mt-3 space-y-1">
        {suggestions.map((item) => {
          const key = keyOf(item);
          return (
            <li key={key}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-sm hover:bg-white">
                <input
                  type="checkbox"
                  checked={!unchecked.has(key)}
                  onChange={() =>
                    setUnchecked((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                />
                <span className="text-zinc-500 line-through">{item.wrong}</span>
                <ArrowRight size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
                <span className="font-medium text-zinc-900">{item.right}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || picked.length === 0}
          className="tf-button-primary !min-h-9 !px-3 text-xs"
          onClick={() => run(() => acceptGlossarySuggestions(meetingId, picked))}
        >
          Thêm {picked.length} từ
        </button>
        <button
          type="button"
          disabled={pending}
          className="tf-button-secondary !min-h-9 !px-3 text-xs"
          onClick={() => run(() => dismissGlossarySuggestions(meetingId))}
        >
          Bỏ qua
        </button>
      </div>
    </div>
  );
}
