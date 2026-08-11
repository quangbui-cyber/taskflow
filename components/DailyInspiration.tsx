"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Sunrise, X } from "lucide-react";

const INSPIRATION_DISMISS_EVENT = "tf:daily-inspiration-dismissed";
const dismissedInSession = new Set<string>();

export default function DailyInspiration({
  quote,
  dateLabel,
  dismissKey,
}: {
  quote: string;
  dateLabel: string;
  dismissKey: string;
}) {
  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener("storage", onStoreChange);
    window.addEventListener(INSPIRATION_DISMISS_EVENT, onStoreChange);
    return () => {
      window.removeEventListener("storage", onStoreChange);
      window.removeEventListener(INSPIRATION_DISMISS_EVENT, onStoreChange);
    };
  }, []);
  const getSnapshot = useCallback(() => {
    if (dismissedInSession.has(dismissKey)) return false;
    try {
      return window.localStorage.getItem(dismissKey) !== "1";
    } catch {
      return true;
    }
  }, [dismissKey]);
  const visible = useSyncExternalStore(subscribe, getSnapshot, () => true);

  if (!visible) return null;

  return (
    <aside
      aria-label="Cảm hứng hôm nay"
      className="mt-6 flex items-center gap-3 rounded-[8px] border border-zinc-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgb(17_24_39_/_0.02)] sm:gap-4"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-brand-600">
        <Sunrise size={26} strokeWidth={1.7} aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-zinc-700">
          Cảm hứng hôm nay
        </p>
        <p className="mt-0.5 text-sm leading-5 text-zinc-800">{quote}</p>
        <p className="mt-1 text-xs text-zinc-400 sm:hidden">{dateLabel}</p>
      </div>

      <time className="hidden shrink-0 text-xs text-zinc-500 sm:block">
        {dateLabel}
      </time>
      <button
        type="button"
        className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="Ẩn cảm hứng hôm nay"
        title="Ẩn trong hôm nay"
        onClick={() => {
          dismissedInSession.add(dismissKey);
          try {
            window.localStorage.setItem(dismissKey, "1");
          } catch {
            // Nút vẫn ẩn nội dung trong phiên hiện tại.
          }
          window.dispatchEvent(new Event(INSPIRATION_DISMISS_EVENT));
        }}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
