"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteCampaign } from "@/app/actions/customerMail";
import { useInteraction } from "@/components/InteractionProvider";

export default function DeleteCampaignButton({ campaignId }: { campaignId: string }) {
  const { notify } = useInteraction();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!confirming) {
    return (
      <button type="button" className="tf-button-secondary" onClick={() => setConfirming(true)}>
        <Trash2 size={16} aria-hidden="true" />
        Xoá chiến dịch
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="tf-button-secondary" onClick={() => setConfirming(false)}>Giữ lại</button>
      <button
        type="button"
        className="tf-button-danger"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteCampaign(campaignId);
            if (result?.error) notify({ message: result.error, tone: "error" });
          })
        }
      >
        {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
        Xoá hẳn
      </button>
    </div>
  );
}
