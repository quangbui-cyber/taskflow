"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MergeClientDialog from "./MergeClientDialog";
import type { DuplicateClientPair, MergeClientSide } from "@/lib/crm/clientMerge";

function ClientSummary({ client }: {
  client: MergeClientSide;
}) {
  return <div className="min-w-0 space-y-1">
    <p className="break-words text-sm font-semibold text-zinc-900">{client.name}</p>
    <p className="text-xs font-normal leading-5 text-zinc-500">
      {client.projectCount} dự án · {client.opportunityCount} Cơ hội · {client.openTaskCount} việc mở · {client.touchpointCount} điểm chạm
    </p>
  </div>;
}

export default function ClientMergeManager({ pairs }: {
  pairs: DuplicateClientPair[];
}) {
  const [selected, setSelected] = useState<DuplicateClientPair | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  function merged() {
    setSelected(null);
    router.refresh();
    requestAnimationFrame(() => heading.current?.focus());
  }

  return <section className="tf-panel min-w-0">
    <header className="flex items-center justify-between gap-3 px-5 py-4">
      <h2 ref={heading} tabIndex={-1} className="text-base font-semibold text-zinc-900">Khách nghi trùng</h2>
      <span className="text-sm font-normal text-zinc-500" aria-label={`${pairs.length} cặp nghi trùng`}>{pairs.length}</span>
    </header>
    {pairs.length ? <ul className="divide-y divide-zinc-100">
      {pairs.map((pair) => <li key={`${pair.a.id}:${pair.b.id}`} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
        <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-2">
          <ClientSummary client={pair.a} />
          <ClientSummary client={pair.b} />
        </div>
        <button
          type="button"
          className="tf-button-danger self-start sm:self-center"
          aria-haspopup="dialog"
          aria-label={`Gộp ${pair.a.name} và ${pair.b.name}`}
          onClick={() => setSelected(pair)}
        >Gộp</button>
      </li>)}
    </ul> : <div className="tf-empty p-8">
      <h3 className="text-sm font-semibold text-zinc-900">Không có khách nghi trùng</h3>
    </div>}
    {selected && <MergeClientDialog
      key={`${selected.a.id}:${selected.b.id}`}
      pair={selected}
      onClose={() => setSelected(null)}
      onMerged={merged}
    />}
  </section>;
}
