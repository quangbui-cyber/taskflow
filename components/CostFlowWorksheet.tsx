"use client";

import { useRouter } from "next/navigation";
import type { Finance } from "./CostFlowPanel";
import PairedQuotationIcEditor from "./PairedQuotationIcEditor";

export type CostFlowWorksheetMode = "quote" | "paired" | "ic";

export type CostFlowWorksheetProps = {
  mode?: CostFlowWorksheetMode;
  finance: Finance;
  userId: string;
  quotationId?: string;
  draftId?: string;
};

export default function CostFlowWorksheet({
  finance,
  userId,
  quotationId,
  draftId,
  mode = "paired"
}: CostFlowWorksheetProps) {
  const router = useRouter();
  const source = finance.data.quotations?.find(quotation => quotation.id === quotationId);
  const initial = finance.data.quotationDrafts
    ?.filter(draft =>
      draft.createdBy === userId &&
      (draftId ? draft.id === draftId : !!quotationId) &&
      (draft.workspaceMode ?? "paired") === mode &&
      (!quotationId || draft.sourceQuotationId === quotationId || draft.latestQuotationId === quotationId)
    )
    .at(-1);

  return (
    <PairedQuotationIcEditor
      finance={finance}
      mode={mode}
      initial={initial}
      source={source}
      onClose={() => router.push(`/projects/${finance.project.id}/costflow?tab=scope`)}
    />
  );
}
