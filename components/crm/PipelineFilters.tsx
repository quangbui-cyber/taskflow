"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { OPPORTUNITY_SOURCES } from "@/lib/crm/labels";
import type { PipelineFilters as Filters } from "@/lib/crm/pipelineReport";

export default function PipelineFilters({ filters, teams, programTypes }: {
  filters: Filters; teams: { id: string; name: string }[]; programTypes: { code: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function change(key: string, value: string) {
    const query = new URLSearchParams(filters.key);
    if (value) query.set(key, value); else query.delete(key);
    startTransition(() => router.push(`/crm/pipeline?${query}`));
  }
  return <div aria-label="Bộ lọc pipeline" aria-busy={pending} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <label htmlFor="pipeline-client" className="block text-sm">Khách
      <select id="pipeline-client" className="tf-field mt-2" value={filters.client} disabled={pending} onChange={e => change("client", e.target.value === "ALL" ? "" : e.target.value)}>
        <option value="ALL">Tất cả</option><option value="NEW">Khách mới</option><option value="EXISTING">Khách cũ</option>
      </select>
    </label>
    <label htmlFor="pipeline-team" className="block text-sm">Team
      <select id="pipeline-team" className="tf-field mt-2" value={filters.teamId ?? ""} disabled={pending} onChange={e => change("team", e.target.value)}>
        <option value="">Tất cả team</option>
        {filters.teamId && !teams.some(t => t.id === filters.teamId) && <option value={filters.teamId} disabled>Team ngoài phạm vi pilot</option>}
        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </label>
    <label htmlFor="pipeline-program" className="block text-sm">Loại chương trình
      <select id="pipeline-program" className="tf-field mt-2" value={filters.programTypeCode ?? ""} disabled={pending} onChange={e => change("program", e.target.value)}>
        <option value="">Tất cả loại chương trình</option>{programTypes.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
      </select>
    </label>
    <label htmlFor="pipeline-source" className="block text-sm">Nguồn
      <select id="pipeline-source" className="tf-field mt-2" value={filters.source ?? ""} disabled={pending} onChange={e => change("source", e.target.value)}>
        <option value="">Tất cả nguồn</option>{OPPORTUNITY_SOURCES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </label>
  </div>;
}
