"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { scorePotentialAction } from "@/app/actions/crmClients";
import { useInteraction } from "@/components/InteractionProvider";
import type { UnratedRow } from "@/lib/crm/reviewData";
import type { PotentialLevel } from "@/lib/crm/settingsSchema";
import { formatCompactVnd } from "@/lib/crm/opportunityFormat";

type Props = { rows: UnratedRow[]; potentialScale: PotentialLevel[]; potentialScaleConfigured: boolean; isAdmin: boolean };
export default function ReviewUnratedSection({ rows: initialRows, potentialScale, potentialScaleConfigured, isAdmin }: Props) {
  const [rows] = useState(() => initialRows);
  if (!rows.length) return null;
  return <section className="tf-panel !mt-12 overflow-hidden" aria-label="Chưa xếp hạng">
    <header className="px-5 py-3"><h2 className="text-base font-semibold">Chưa xếp hạng</h2></header>
    {potentialScaleConfigured ? <div className="divide-y divide-zinc-100">{rows.map(row => <PotentialRow key={row.clientId} row={row} potentialScale={potentialScale} />)}</div> : <>
      <div className="flex flex-wrap items-center gap-4 px-5 py-4 text-sm text-zinc-500"><span>Chưa có thang tiềm năng</span>{isAdmin && <Link href="/admin?tab=crm" className="tf-button-secondary">Mở cấu hình CRM</Link>}</div>
      <div className="divide-y divide-zinc-100">{rows.map(row => <div key={row.clientId} className="px-5 py-4"><Link href={`/crm/clients/${row.clientId}`} className="text-sm font-semibold hover:underline">{row.name}</Link><p className="mt-1 text-xs text-zinc-500">Doanh thu 24 tháng: {row.revenue24m ? formatCompactVnd(row.revenue24m) : "0"}</p></div>)}</div>
    </>}
  </section>;
}
function PotentialRow({ row, potentialScale }: { row: UnratedRow; potentialScale: PotentialLevel[] }) {
  const { notify } = useInteraction();
  const [level, setLevel] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const uid = useId();
  return <form className="flex flex-wrap items-center justify-between gap-4 px-5 py-4" onSubmit={e => {
    e.preventDefault(); if (busy.current || !level) return; busy.current = true;
    startTransition(async () => {
      try {
        const result = await scorePotentialAction({ clientId: row.clientId, level, expectedVersion: row.version });
        if ("error" in result) notify({ tone: "error", message: result.error || "Không lưu được. Kiểm tra kết nối rồi thử lại." });
        else { setSaved(result.success); notify({ tone: "success", message: result.success }); }
      } catch { notify({ tone: "error", message: "Không lưu được. Kiểm tra kết nối rồi thử lại." }); }
      finally { busy.current = false; }
    });
  }} aria-busy={pending}>
    <div><Link href={`/crm/clients/${row.clientId}`} className="text-sm font-semibold hover:underline">{row.name}</Link><p className="mt-1 text-xs text-zinc-500">Doanh thu 24 tháng: {row.revenue24m ? formatCompactVnd(row.revenue24m) : "0"}</p></div>
    {saved ? <span role="status" className="text-xs text-zinc-500">{saved}</span> : <div className="flex flex-wrap items-end gap-2"><div><label htmlFor={uid} className="tf-label">Tiềm năng</label><select id={uid} required className="tf-field" disabled={pending} value={level} onChange={e => setLevel(e.target.value)}><option value="">Chọn tiềm năng</option>{potentialScale.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div><button type="submit" className="tf-button-secondary min-h-10 md:!min-h-9" disabled={pending || !level} aria-busy={pending}>{pending && <span className="tf-spinner" />}Lưu hạng</button></div>}
  </form>;
}
