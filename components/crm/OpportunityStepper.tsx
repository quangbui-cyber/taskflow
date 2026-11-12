import { buildStepperSegments } from "@/lib/crm/opportunityStepper";
import { formatCrmDate } from "@/lib/crm/dates";

// Segment palette: bg-brand-50 text-brand-700, bg-zinc-900 text-white, bg-zinc-100 text-zinc-500.
// The current open stage shows the proposal countdown; on mobile only stage names are shown.
export default function OpportunityStepper({ stage, outcome, events, now, countdown }: {
  stage: string; outcome: string | null; events: { toStage: string; outcome: string | null; occurredAt: Date }[]; now: Date;
  countdown?: { label: string; tone: "late" | "warn" | null } | null;
}) {
  return <ol className="grid grid-cols-4 gap-1" aria-label="Tiến trình Cơ hội">
    {buildStepperSegments({ stage, outcome, events }).map(segment => {
      const showCountdown = segment.state === "current" && !outcome && !!countdown;
      return <li key={segment.key} aria-current={segment.state === "current" ? "step" : undefined} className={`min-w-0 rounded-[10px] px-2 py-2 sm:px-3 ${segment.className}`}>
        <p className="break-words text-xs font-semibold sm:text-[13px]">{segment.label}</p>
        <p className={`mt-0.5 hidden min-h-4 break-words text-xs sm:block ${showCountdown && countdown?.tone === "late" ? "font-semibold text-[#fdba74]" : showCountdown && countdown?.tone === "warn" ? "font-semibold text-[#fcd34d]" : ""}`}>{showCountdown ? countdown!.label : segment.date ? <time dateTime={segment.date.toISOString()}>{formatCrmDate(segment.date, now)}</time> : "-"}</p>
      </li>;
    })}
  </ol>;
}
