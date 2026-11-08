import { TIER_LABELS } from "@/lib/crm/labels";
import type { TierValue } from "@/lib/crm/settingsSchema";

export default function TierBadge({ tier }: { tier: TierValue }) {
  const color = tier === "S" ? "border-zinc-900 bg-zinc-900 text-white" : tier === "UNRATED" ? "border-dashed border-zinc-300 bg-white text-zinc-500" : "border-zinc-100 bg-zinc-100 text-zinc-700";
  return <span className={`tf-badge whitespace-nowrap border font-normal ${color}`}>{TIER_LABELS[tier]}</span>;
}
