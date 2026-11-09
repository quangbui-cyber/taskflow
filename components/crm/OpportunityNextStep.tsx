"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useInteraction } from "@/components/InteractionProvider";
import TouchpointDialog from "./TouchpointDialog";
import { escalateCrmTaskAction } from "@/app/actions/crmEvents";
import { formatCrmDate } from "@/lib/crm/dates";
import type { OpportunityDetail } from "@/lib/crm/opportunityDetail";
import type { TouchpointDialogOptions } from "@/lib/crm/dialogOptions";

export default function OpportunityNextStep({ nextStep, clientId, opportunityId, closed, canSetNext, canComplete, options, now }: {
  nextStep: OpportunityDetail["nextStep"]; clientId: string; opportunityId: string; closed: boolean; canSetNext: boolean; canComplete: boolean; options: TouchpointDialogOptions; now: Date;
}) {
  const [pending, startTransition] = useTransition(), { notify } = useInteraction(), router = useRouter();
  const prefill = { clientId, opportunityId };
  function escalate() {
    if (!nextStep || pending) return;
    startTransition(async () => {
      try {
        const result = await escalateCrmTaskAction(nextStep.taskId);
        if ("error" in result) notify({ message: result.error ?? "Không lưu được. Kiểm tra kết nối rồi thử lại.", tone: "error" });
        else { notify({ message: result.success, tone: "success" }); router.refresh(); }
      } catch { notify({ message: "Không lưu được. Kiểm tra kết nối rồi thử lại.", tone: "error" }); }
    });
  }
  return <section className="tf-panel space-y-4 p-5" aria-labelledby="next-step-title">
    <h2 id="next-step-title" className="text-base font-semibold">Bước tiếp theo</h2>
    {nextStep ? <><p className="break-words text-sm font-semibold">{nextStep.title}</p>
      <p className="flex flex-wrap gap-2 text-xs text-zinc-500"><span>{nextStep.assigneeName ?? "Chưa giao"}</span>{nextStep.dueDate && <span className={nextStep.overdue ? "text-[#b86a08]" : undefined}>hạn {formatCrmDate(nextStep.dueDate, now)}</span>}</p>
      {!closed && canComplete && options.clients.length > 0 && <div className="flex flex-wrap gap-2">
        <TouchpointDialog options={options} lockClient triggerLabel="Xong và đặt bước tiếp" triggerVariant="secondary" prefill={{ ...prefill, completeTaskId: nextStep.taskId }} />
        <button type="button" className="tf-button-ghost" disabled={pending || nextStep.escalated} aria-busy={pending} onClick={escalate}>{pending && <span className="tf-spinner" aria-hidden="true" />}Cần AD/AM</button>
      </div>}
    </> : <><p className="text-sm text-zinc-500">Chưa có bước tiếp theo</p>{!closed && canSetNext && options.clients.length > 0 && <TouchpointDialog options={options} lockClient triggerLabel="Đặt bước tiếp" triggerVariant="secondary" prefill={prefill} />}</>}
  </section>;
}
