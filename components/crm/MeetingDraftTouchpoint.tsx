"use client";

import { Handshake } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissDraftAction } from "@/app/actions/crmTouchpoints";
import { useInteraction } from "@/components/InteractionProvider";
import { vnDateKey } from "@/lib/crm/dates";
import type { TouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import type { MeetingDraftView } from "@/lib/crm/meetingDrafts";
import TouchpointDialog from "./TouchpointDialog";

export default function MeetingDraftTouchpoint({ view, options, canDismiss }: {
  view: MeetingDraftView;
  options: TouchpointDialogOptions | null;
  canDismiss: boolean;
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  const dateKey = vnDateKey(new Date(view.occurredAt));
  const [year, month, day] = dateKey.split("-");

  function dismiss() {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await dismissDraftAction(view.draftId);
        if ("error" in result && result.error) {
          notify({ tone: "error", message: result.error });
          return;
        }
        setDismissed(true);
        router.refresh();
      } catch {
        notify({ tone: "error", message: "Không thể bỏ qua điểm chạm nháp. Thử lại." });
      }
    });
  }

  if (dismissed) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-zinc-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Handshake size={18} className="mt-0.5 shrink-0 text-zinc-500" aria-hidden="true" />
        <div className="min-w-0 break-words">
          <p className="text-sm font-semibold text-zinc-900">Điểm chạm nháp đã tạo</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {view.clientName} · {day}/{month}/{year}{view.opportunityName && ` · Cơ hội ${view.opportunityName}`}
          </p>
        </div>
      </div>
      {(options || canDismiss) && (
        <div className="flex flex-wrap items-center gap-2">
          {options && view.canConfirm && (
            <>
              <button type="button" className="tf-button-secondary !min-h-8 !px-3 !py-1 text-xs" disabled={pending} onClick={() => setOpen(true)}>Xác nhận</button>
              <TouchpointDialog
                options={options}
                triggerVariant="secondary"
                renderTrigger={false}
                open={open}
                onOpenChange={setOpen}
                lockClient
                prefill={{
                  clientId: view.clientId,
                  opportunityId: view.opportunityId,
                  kind: "MEETING",
                  occurredAt: view.occurredAt,
                  confirmDraftId: view.draftId,
                }}
              />
            </>
          )}
          {canDismiss && (
            <button type="button" className="min-h-8 rounded-lg px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-500 disabled:opacity-50" disabled={pending} onClick={dismiss}>Bỏ qua</button>
          )}
        </div>
      )}
    </div>
  );
}
