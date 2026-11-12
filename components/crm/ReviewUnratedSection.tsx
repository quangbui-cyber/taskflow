"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { scorePotentialAction } from "@/app/actions/crmClients";
import { useInteraction } from "@/components/InteractionProvider";
import type { UnratedRow } from "@/lib/crm/reviewData";
import type { PotentialLevel } from "@/lib/crm/settingsSchema";
import { formatCompactVnd } from "@/lib/crm/opportunityFormat";

type Props = { rows: UnratedRow[]; potentialScale: PotentialLevel[]; potentialScaleConfigured: boolean; isAdmin: boolean };
export default function ReviewUnratedSection({ rows: initialRows, potentialScale, potentialScaleConfigured, isAdmin }: Props) {
  const [rows] = useState(() => initialRows);
  if (!rows.length) return <p className="text-zinc-500">Khách nào cũng đã có hạng.</p>;
  // crm51: rendered inside "Dọn dữ liệu" in the right column, so rows stack instead of using two columns.
  return <div aria-label="Chưa xếp hạng">
    {potentialScaleConfigured ? <div className="divide-y divide-zinc-100">{rows.map(row => <PotentialRow key={row.clientId} row={row} potentialScale={potentialScale} />)}</div> : <>
      <div className="flex flex-wrap items-center gap-3 py-2 text-zinc-500"><span>Chưa có thang tiềm năng</span>{isAdmin && <Link href="/admin?tab=crm" className="tf-button-secondary">Mở cấu hình CRM</Link>}</div>
      <div className="divide-y divide-zinc-100">{rows.map(row => <div key={row.clientId} className="py-2"><ClientLine row={row} /></div>)}</div>
    </>}
  </div>;
}
function ClientLine({ row }: { row: UnratedRow }) {
  return <div className="min-w-0"><Link href={`/crm/clients/${row.clientId}`} className="break-words text-sm font-semibold hover:underline">{row.name}</Link><p className="mt-0.5 text-xs text-zinc-500">Doanh thu 24 tháng {row.revenue24m ? formatCompactVnd(row.revenue24m) : "0"}</p></div>;
}
function PotentialRow({ row, potentialScale }: { row: UnratedRow; potentialScale: PotentialLevel[] }) {
  const { notify } = useInteraction();
  const [saved, setSaved] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  function score(level: string) {
    if (busy.current || pending) return;
    busy.current = true; setChosen(level);
    startTransition(async () => {
      try {
        const result = await scorePotentialAction({ clientId: row.clientId, level, expectedVersion: row.version });
        if ("error" in result) notify({ tone: "error", message: result.error || "Không lưu được. Kiểm tra kết nối rồi thử lại." });
        else { setSaved(result.success); notify({ tone: "success", message: result.success }); }
      } catch { notify({ tone: "error", message: "Không lưu được. Kiểm tra kết nối rồi thử lại." }); }
      finally { busy.current = false; }
    });
  }
  return <div className="grid gap-2 py-2" aria-busy={pending}>
    <ClientLine row={row} />
    {saved ? <span role="status" className="text-xs text-zinc-500">{saved}</span> : <div role="group" aria-label={`Tiềm năng của ${row.name}`} className="flex flex-wrap gap-1.5">{potentialScale.map(p => <button key={p.key} type="button" disabled={pending} aria-busy={pending && chosen === p.key} className="inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-zinc-200 bg-white px-2.5 text-xs text-zinc-700 transition-colors duration-150 hover:border-zinc-400 hover:bg-zinc-50 disabled:opacity-60 md:min-h-8" onClick={() => score(p.key)}>{pending && chosen === p.key && <span className="tf-spinner" />}{p.label}</button>)}</div>}
  </div>;
}
