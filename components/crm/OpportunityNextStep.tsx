"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useInteraction } from "@/components/InteractionProvider";
import TouchpointDialog from "./TouchpointDialog";
import { escalateCrmTaskAction } from "@/app/actions/crmEvents";
import { dueLabel } from "@/lib/crm/reviewView";
import type { OpportunityDetail } from "@/lib/crm/opportunityDetail";
import type { TouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import type { OutcomeBanner } from "@/lib/crm/opportunityView";

/** Open Opportunity: next task box. Closed Opportunity: result banner instead of any to-do. */
export default function OpportunityNextStep({ nextStep, clientId, opportunityId, closed, banner, canSetNext, canComplete, options, now }: {
  nextStep: OpportunityDetail["nextStep"]; clientId: string; opportunityId: string; closed: boolean; banner: OutcomeBanner | null;
  canSetNext: boolean; canComplete: boolean; options: TouchpointDialogOptions; now: Date;
}) {
  const [pending, startTransition] = useTransition(), { notify } = useInteraction(), router = useRouter();
  const [escalated, setEscalated] = useState(false);
  const busy = useRef(false);
  const prefill = { clientId, opportunityId };
  if (closed) {
    if (!banner) return null;
    return <section role="status" aria-label="Kết quả Cơ hội" className={`rounded-[14px] border px-4 py-3.5 ${banner.tone === "won" ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-zinc-50"}`}>
      <p className={`font-semibold ${banner.tone === "won" ? "text-emerald-700" : "text-zinc-800"}`}>{banner.title}</p>
      {banner.tone === "won" ? <p className="mt-1 text-[13px] text-zinc-600">{banner.project ? <>Đã chuyển sang Project <Link href={`/projects/${banner.project.id}`} className="font-semibold text-zinc-900 underline-offset-2 hover:underline">{banner.project.name} →</Link> gồm {banner.transferredLabel}. Theo dõi tiếp ở Project.</> : <>Chưa có Project liên kết.</>}</p>
        : <div className="mt-1 space-y-1 text-[13px] text-zinc-600">{banner.reason && <p>Lý do: {banner.reason}</p>}{banner.note && <p className="whitespace-pre-wrap break-words">{banner.note}</p>}</div>}
    </section>;
  }
  const isEscalated = escalated || !!nextStep?.escalated;
  function escalate() {
    if (!nextStep || pending || busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await escalateCrmTaskAction(nextStep.taskId);
        if ("error" in result) notify({ message: result.error ?? "Không lưu được. Kiểm tra kết nối rồi thử lại.", tone: "error" });
        else { setEscalated(true); notify({ message: result.success, tone: "success" }); router.refresh(); }
      } catch { notify({ message: "Không lưu được. Kiểm tra kết nối rồi thử lại.", tone: "error" }); }
      finally { busy.current = false; }
    });
  }
  const due = nextStep?.dueDate ? dueLabel(nextStep.dueDate, now) : null;
  const canAct = options.clients.length > 0;
  return <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-brand-100 bg-brand-50 px-4 py-3.5" aria-labelledby="next-step-title">
    <div className="min-w-0">
      <h2 id="next-step-title" className="text-xs font-semibold uppercase tracking-[0.04em] text-brand-700">Việc tiếp theo</h2>
      {nextStep ? <>
        <p className="break-words text-[17px] font-semibold text-zinc-900">{nextStep.title}</p>
        <p className="flex flex-wrap gap-x-1 text-[13px] text-zinc-500">{due && <span className={due.tone === "late" ? "font-semibold text-[#c2410c]" : due.tone === "warn" ? "font-semibold text-[#b86a08]" : undefined}>{due.label}</span>}{due && <span aria-hidden="true">·</span>}<span>{nextStep.assigneeName ?? "Chưa giao"}</span></p>
      </> : <p className="text-[15px] font-semibold text-zinc-500">Chưa có việc tiếp theo</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      {nextStep ? <>
        {canComplete && canAct && <TouchpointDialog options={options} lockClient triggerLabel="Xong, đặt việc tiếp" triggerVariant="secondary" prefill={{ ...prefill, completeTaskId: nextStep.taskId }} />}
        {canComplete && <button type="button" className="tf-button-secondary" disabled={pending || isEscalated} aria-busy={pending} onClick={escalate}>{pending && <span className="tf-spinner" aria-hidden="true" />}{isEscalated ? "Đã nhờ AD/AM" : "Nhờ AD/AM hỗ trợ"}</button>}
      </> : canSetNext && canAct && <TouchpointDialog options={options} lockClient triggerLabel="Đặt việc tiếp theo" triggerVariant="secondary" prefill={prefill} />}
    </div>
  </section>;
}
