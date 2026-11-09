"use client";

import { useId, useRef, useState, useTransition } from "react";
import { mergeClientsAction } from "@/app/actions/crmMerge";
import { useInteraction } from "@/components/InteractionProvider";
import CrmDialogFrame from "./CrmDialogFrame";
import type { DuplicateClientPair } from "@/lib/crm/clientMerge";

export default function MergeClientDialog({ pair, onClose, onMerged }: { pair: DuplicateClientPair; onClose: () => void; onMerged: () => void }) {
  const [targetId, setTargetId] = useState(pair.suggestedTargetId);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const { notify } = useInteraction();
  const labelId = useId();
  const source = pair.a.id === targetId ? pair.b : pair.a;
  const target = pair.a.id === targetId ? pair.a : pair.b;
  function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    startTransition(async () => {
      try {
        const result = await mergeClientsAction({ sourceClientId: source.id, targetClientId: target.id, expectedSourceVersion: source.version, expectedTargetVersion: target.version });
        if (result.error) { setError(result.error); notify({ message: result.error, tone: "error" }); }
        else { notify({ message: result.success ?? `Đã gộp ${source.name} vào ${target.name}.`, tone: "success" }); onMerged(); }
      } catch {
        const message = "Không thể gộp khách lúc này. Vui lòng thử lại.";
        setError(message); notify({ message, tone: "error" });
      } finally { submitting.current = false; }
    });
  }
  return <CrmDialogFrame open title="Gộp khách" dirty={false} pending={pending} onClose={onClose} onSubmit={submit} submitLabel="Gộp khách" footer={
    <div className="mt-6 flex justify-end gap-2">
      <button type="button" className="tf-button-secondary" disabled={pending} onClick={onClose}>Hủy</button>
      <button type="submit" className="tf-button-danger" disabled={pending} aria-busy={pending}>{pending && <span className="tf-spinner" aria-hidden="true" />}Gộp khách</button>
    </div>
  }>
    <div role="radiogroup" aria-labelledby={labelId} className="space-y-3">
      <p id={labelId} className="text-sm font-semibold">Giữ lại</p>
      {[pair.a, pair.b].map((client) => <label key={client.id} className="flex min-w-0 items-start gap-3 rounded-[10px] bg-zinc-50 p-3 text-sm font-normal">
        <input type="radio" name={labelId} value={client.id} checked={targetId === client.id} onChange={() => setTargetId(client.id)} className="mt-1 shrink-0 accent-zinc-900" />
        <span className="min-w-0 break-words">{client.name}</span>
      </label>)}
    </div>
    <p className="break-words text-sm leading-6 text-zinc-700">Gộp {source.name} vào {target.name}? Dự án, Cơ hội, việc và điểm chạm của {source.name} chuyển sang {target.name}. Không hoàn tác được.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </CrmDialogFrame>;
}
