"use client";

import { useRouter } from "next/navigation";
import type { PairedFinance } from "@/lib/costflow/pairedReadModel";
import PairedQuotationIcEditor from "./PairedQuotationIcEditor";

export type CostFlowWorksheetMode = "quote" | "paired" | "ic";

export type CostFlowWorksheetProps = {
  mode?: CostFlowWorksheetMode;
  finance: PairedFinance;
  userId: string;
  quotationId?: string;
  draftId?: string;
  revisionId?: string;
};

export default function CostFlowWorksheet({
  finance,
  userId,
  quotationId,
  draftId,
  revisionId,
  mode = "paired"
}: CostFlowWorksheetProps) {
  const router = useRouter();
  const revision = finance.data.revisions.find(value => value.id === revisionId);
  const resolvedQuotationId = quotationId ?? revision?.quotationId;
  const source = finance.data.quotations?.find(quotation => quotation.id === resolvedQuotationId);
  const initial = finance.data.quotationDrafts
    ?.filter(draft =>
      draft.createdBy === userId &&
      (draftId ? draft.id === draftId : revisionId ? false : !!quotationId) &&
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
      revisionId={revisionId}
      onClose={() => router.push(`/projects/${finance.project.id}/costflow?tab=scope`)}
    />
  );
}
