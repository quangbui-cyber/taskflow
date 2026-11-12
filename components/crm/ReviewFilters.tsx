"use client";

import { useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReviewFilters as Filters, WeeklyReview } from "@/lib/crm/reviewData";

/** Team and PIC share one select; PIC choices stay scoped to the selected team. */
export default function ReviewFilters({ teams, pics, filters, canUseMine }: {
  teams: WeeklyReview["teams"]; pics: WeeklyReview["pics"]; filters: Filters; canUseMine: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const uid = useId();
  const value = filters.pic !== "all" ? `pic:${filters.pic}` : `team:${filters.teamId ?? "all"}`;
  function change(next: string) {
    const query = new URLSearchParams(params.toString());
    const [kind, id] = [next.slice(0, next.indexOf(":")), next.slice(next.indexOf(":") + 1)];
    if (kind === "team") { query.set("team", id); query.set("pic", "all"); }
    else query.set("pic", id);
    router.push(`/crm?${query}`);
  }
  const teamName = teams.find(t => t.id === filters.teamId)?.name;
  return <div className="min-w-0">
    <label htmlFor={uid} className="sr-only">Xem theo team hoặc PIC</label>
    <select id={uid} className="tf-field max-w-full" value={value} onChange={e => change(e.target.value)}>
      <optgroup label="Team">
        <option value="team:all">Tất cả team</option>
        {teams.map(t => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}
      </optgroup>
      <optgroup label={teamName ? `PIC trong ${teamName}` : "PIC"}>
        {canUseMine && <option value="pic:me">Của tôi</option>}
        {pics.map(p => <option key={p.accountId} value={`pic:${p.accountId}`}>{p.name}</option>)}
      </optgroup>
    </select>
  </div>;
}
