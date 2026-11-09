"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmImportedClientAction } from "@/app/actions/crmClients";
import { useInteraction } from "@/components/InteractionProvider";
import { useClientEditSession } from "./ClientEditSession";

export default function PendingPicConfirmButton({ clientId }: { clientId: string }) {
  const [actionPending, startTransition] = useTransition();
  const session = useClientEditSession();
  const pending = actionPending || !!session?.busy;
  const { notify } = useInteraction(); const router = useRouter();
  return <button type="button" disabled={pending} aria-busy={pending} className="tf-button-secondary !min-h-9 !px-3 !text-xs" onClick={() => {
    if (pending) return;
    session?.setBusy(true);
    startTransition(async () => {
      try {
        const result = await confirmImportedClientAction({ clientId });
        if ("error" in result) { notify({ message: result.error ?? "Không lưu được. Kiểm tra kết nối rồi thử lại.", tone: "error" }); return; }
        if (result.version !== undefined) session?.saved(result.version);
        notify({ message: "Đã xác nhận khách.", tone: "success" }); router.refresh();
      } catch { notify({ message: "Không lưu được. Kiểm tra kết nối rồi thử lại.", tone: "error" }); }
      finally { session?.setBusy(false); }
    });
  }}>{pending && <span className="tf-spinner" aria-hidden="true" />}Xác nhận khách của tôi</button>;
}
