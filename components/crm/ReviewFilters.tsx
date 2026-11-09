"use client";

import Link from "next/link";
import { useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReviewFilters as Filters, WeeklyReview } from "@/lib/crm/reviewData";

export default function ReviewFilters({ teams, pics, filters, canUseMine }: {
  teams: WeeklyReview["teams"]; pics: WeeklyReview["pics"]; filters: Filters; canUseMine: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const uid = useId();
  function href(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    return `/crm?${next}`;
  }
  const chips = [{ value: "all", label: "Tất cả" }, ...(canUseMine ? [{ value: "me", label: "Của tôi" }] : []), ...pics.map(p => ({ value: p.accountId, label: p.name }))];
  return <div className="flex min-w-0 flex-wrap items-end gap-4">
    <div><label htmlFor={uid} className="tf-label">Team</label><select id={uid} className="tf-field" value={filters.teamId ?? "all"} onChange={e => router.push(href("team", e.target.value))}>
      <option value="all">Tất cả team</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select></div>
    <nav aria-label="PIC" className="flex max-w-full flex-wrap gap-2">{chips.map(c => <Link key={c.value} href={href("pic", c.value)} aria-current={filters.pic === c.value ? "page" : undefined} className={`inline-flex min-h-10 items-center rounded-[7px] border px-3 py-2 text-xs ${filters.pic === c.value ? "bg-zinc-900 text-white border-zinc-900" : "bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>{c.label}</Link>)}</nav>
  </div>;
}
