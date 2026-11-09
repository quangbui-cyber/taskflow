"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissDraftAction } from "@/app/actions/crmTouchpoints";
import { useInteraction } from "@/components/InteractionProvider";
import type { TouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import TouchpointDialog from "./TouchpointDialog";

export default function DraftTouchpointActions({ draft, options }: {
  draft: { id: string; clientId: string; opportunityId: string | null; occurredAt: string };
  options: TouchpointDialogOptions;
}) {
  const [open, setOpen] = useState(false); const [pending, startTransition] = useTransition();
  const router = useRouter(); const { notify } = useInteraction();
  const canDismiss = options.clients.find(c => c.id === draft.clientId)?.canLogClient;
  return <div className="flex flex-wrap gap-2">
    <button type="button" className="tf-button-secondary !min-h-9" disabled={pending} onClick={() => setOpen(true)}>Xác nhận</button>
    {canDismiss && <button type="button" className="tf-button-ghost !min-h-9" aria-busy={pending} disabled={pending} onClick={() => {
      startTransition(async () => {
        try {
          const result = await dismissDraftAction(draft.id);
          if ("error" in result) notify({ message: result.error, tone: "error" }); else router.refresh();
        } catch { notify({ message: "Không lưu được. Kiểm tra kết nối rồi thử lại.", tone: "error" }); }
      });
    }}>Bỏ qua</button>}
    <TouchpointDialog options={options} triggerVariant="secondary" renderTrigger={false} open={open} onOpenChange={setOpen} lockClient prefill={{ clientId: draft.clientId, opportunityId: draft.opportunityId, confirmDraftId: draft.id, occurredAt: draft.occurredAt, kind: "MEETING" }} />
  </div>;
}
