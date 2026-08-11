import { Sunrise } from "lucide-react";

export default function DailyInspiration({ quote }: { quote: string }) {
  return (
    <aside
      aria-label="Cảm hứng hôm nay"
      className="mt-6 flex items-center gap-3 rounded-[8px] border border-zinc-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgb(17_24_39_/_0.02)] sm:gap-4"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center text-brand-600">
        <Sunrise size={26} strokeWidth={1.7} aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-brand-700">
          Cảm hứng hôm nay
        </p>
        <p className="mt-0.5 text-sm leading-5 text-zinc-800">
          &quot;{quote}&quot;
        </p>
      </div>
    </aside>
  );
}
