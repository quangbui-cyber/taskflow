import { OUTCOME_LEVELS } from "@/lib/crm/labels";

export default function OutcomeDots({ level }: { level: number | null }) {
  const outcome = OUTCOME_LEVELS.find((item) => item.key === level);
  return <span className="inline-flex flex-wrap items-center gap-2 text-xs text-zinc-500">
    <span className="inline-flex gap-1" aria-hidden="true">{[1, 2, 3, 4].map((dot) => <span key={dot} className={`h-1.5 w-1.5 rounded-full ${outcome && dot <= outcome.key ? "bg-zinc-900" : "bg-zinc-200"}`} />)}</span>
    <span>{outcome?.label ?? "Chưa ghi kết quả"}</span>
  </span>;
}
