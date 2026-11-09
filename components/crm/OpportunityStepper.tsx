import { buildStepperSegments } from "@/lib/crm/opportunityStepper";
import { formatCrmDate } from "@/lib/crm/dates";

// Segment palette: bg-brand-50 text-brand-700, bg-zinc-900 text-white, bg-zinc-100 text-zinc-500.
export default function OpportunityStepper({ stage, outcome, events, now }: {
  stage: string; outcome: string | null; events: { toStage: string; outcome: string | null; occurredAt: Date }[]; now: Date;
}) {
  return <ol className="grid grid-cols-2 overflow-hidden rounded-[8px] sm:grid-cols-4" aria-label="Tiến trình Cơ hội">
    {buildStepperSegments({ stage, outcome, events }).map(segment => <li key={segment.key} aria-current={segment.state === "current" ? "step" : undefined} className={`min-w-0 px-5 py-4 ${segment.className}`}>
      <p className="break-words text-sm">{segment.label}</p>
      <p className="mt-1 min-h-4 text-xs">{segment.date ? <time dateTime={segment.date.toISOString()}>{formatCrmDate(segment.date, now)}</time> : "-"}</p>
    </li>)}
  </ol>;
}
