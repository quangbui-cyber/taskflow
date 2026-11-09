import { OPPORTUNITY_OUTCOMES, OPPORTUNITY_STAGES } from "./labels";

export type StepperSegment = {
  key: "CARE" | "BRIEF" | "BIDDING" | "RESULT";
  label: string;
  date: Date | null;
  state: "done" | "current" | "future";
  className: string;
};
const classes = { done: "bg-brand-50 text-brand-700", current: "bg-zinc-900 text-white font-semibold", future: "bg-zinc-100 text-zinc-500" };
type Event = { toStage: string; outcome: string | null; occurredAt: Date };
export function buildStepperSegments(input: { stage: string; outcome: string | null; events: Event[] }): StepperSegment[] {
  const current = OPPORTUNITY_STAGES.findIndex(row => row.key === input.stage);
  const outcome = OPPORTUNITY_OUTCOMES.find(row => row.key === input.outcome);
  return [...OPPORTUNITY_STAGES, { key: "RESULT" as const, label: "Kết quả" }].map((row, index) => {
    const result = row.key === "RESULT";
    const state = result ? (input.outcome ? "current" : "future") : index < current || (input.outcome && index === current) ? "done" : index === current ? "current" : "future";
    const dates = input.events.filter(event => result ? !!event.outcome : !event.outcome && event.toStage === row.key).map(event => event.occurredAt);
    return { key: row.key, label: result && outcome ? outcome.label : row.label, date: dates.reduce<Date | null>((earliest, date) => !earliest || date < earliest ? date : earliest, null), state, className: result && outcome ? `${outcome.className} font-semibold` : classes[state] };
  });
}
export function describeStageEvent(event: { fromStage: string | null; toStage: string; outcome: string | null }): string {
  const label = (key: string) => OPPORTUNITY_STAGES.find(row => row.key === key)?.label ?? OPPORTUNITY_OUTCOMES.find(row => row.key === key)?.label ?? key;
  if (!event.fromStage) return `Mở Cơ hội ở ${label(event.toStage)}`;
  return `${label(event.fromStage)} → ${label(event.outcome ?? event.toStage)}`;
}
