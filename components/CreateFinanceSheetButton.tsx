"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { createFinanceSheet } from "@/app/actions/finance";
import { useInteraction } from "@/components/InteractionProvider";

export default function CreateFinanceSheetButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await createFinanceSheet(projectId);
          if (result.error) {
            notify({ message: result.error, tone: "error" });
            return;
          }
          router.refresh();
        })
      }
      className="tf-button-primary"
    >
      {pending ? <span className="tf-spinner" aria-hidden="true" /> : <FilePlus2 size={16} aria-hidden="true" />}
      Tạo IC
    </button>
  );
}
