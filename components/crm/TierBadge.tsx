import { TIER_LABELS } from "@/lib/crm/labels";
import type { TierValue } from "@/lib/crm/settingsSchema";

// D-49.2: S black, A dark green, B green, C grey, unrated dashed ring.
const DOT = { S: "bg-zinc-900", A: "bg-[#3f6212]", B: "bg-[#65a30d]", C: "bg-zinc-400", UNRATED: "border-[1.5px] border-dashed border-zinc-400 bg-white" } as const;

export function TierDot({ tier, className = "" }: { tier: TierValue; className?: string }) {
  return <span aria-hidden="true" data-tier-dot={tier} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[tier]} ${className}`} />;
}

export default function TierBadge({ tier, variant = "badge" }: { tier: TierValue; variant?: "badge" | "dot" }) {
  if (variant === "dot") return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-500"><TierDot tier={tier} />{TIER_LABELS[tier]}</span>;
  const color = tier === "S" ? "border-zinc-900 bg-zinc-900 text-white" : tier === "UNRATED" ? "border-dashed border-zinc-300 bg-white text-zinc-500" : "border-zinc-100 bg-zinc-100 text-zinc-700";
  return <span className={`tf-badge whitespace-nowrap border font-normal ${color}`}>{TIER_LABELS[tier]}</span>;
}

// crm51 (sketch 006): small square with the tier letter, same colors as the dot.
const SQUARE = { S: "bg-zinc-900 text-white", A: "bg-[#3f6212] text-white", B: "bg-[#84cc16] text-zinc-900", C: "bg-zinc-400 text-white", UNRATED: "border-[1.5px] border-dashed border-zinc-300 bg-white text-zinc-500" } as const;
export function TierSquare({ tier, className = "" }: { tier: TierValue; className?: string }) {
  return <span title={TIER_LABELS[tier]} data-tier-square={tier} className={`inline-grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] text-[11px] font-bold ${SQUARE[tier]} ${className}`}><span aria-hidden="true">{tier === "UNRATED" ? "?" : tier}</span><span className="sr-only">{TIER_LABELS[tier]}</span></span>;
}
