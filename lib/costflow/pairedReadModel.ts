import { hydrateLinePricingData } from "./pairedDraft";
import type { CompanySupplier } from "./supplierReadModel";
import { emptyFinance, type FinanceData, type IcRevision, type PairedDraft, type Quotation } from "./types";

export type PairedRouteParams = {
  quotationId?: string;
  draftId?: string;
  revisionId?: string;
};

export type PairedFinance = {
  project: {
    id: string;
    name: string;
    ownerId?: string;
    client?: { id: string; name: string } | null;
    members: { userId: string }[];
  };
  clients: { id: string; name: string }[];
  suppliers: CompanySupplier[];
  fullAccess: true;
  version: number;
  data: FinanceData;
  requests: { id: string; state: string }[];
  files: { id: string; name: string }[];
  evidence: {
    id: string;
    name: string;
    requestId: string | null;
    kind: string;
    mimeType?: string;
    sha256?: string;
  }[];
};

export type PairedWorkspaceSelection = {
  data: FinanceData;
  requestIds: string[];
  resolvedQuotationId?: string;
};

function selectedDraft(
  source: FinanceData,
  actorId: string,
  params: PairedRouteParams,
  resolvedQuotationId?: string,
) {
  const eligible = (source.quotationDrafts ?? []).filter(draft =>
    draft.createdBy === actorId
      && (draft.workspaceMode ?? "paired") === "paired"
      && (!resolvedQuotationId
        || draft.sourceQuotationId === resolvedQuotationId
        || draft.latestQuotationId === resolvedQuotationId),
  );
  return params.draftId
    ? eligible.find(draft => draft.id === params.draftId)
    : resolvedQuotationId
      ? eligible.at(-1)
      : undefined;
}

function relevantRevisionIds(
  source: FinanceData,
  explicitRevision: IcRevision | undefined,
  draft: PairedDraft | undefined,
  resolvedQuotationId?: string,
) {
  return new Set([
    explicitRevision?.id,
    draft?.icRevisionId,
    resolvedQuotationId
      ? source.revisions.find(revision => revision.quotationId === resolvedQuotationId)?.id
      : undefined,
    source.workingRevisionId,
  ].filter((value): value is string => Boolean(value)));
}

function selectedQuotations(source: FinanceData, resolvedQuotationId?: string) {
  const selected = new Map<string, Quotation>();
  const sourceQuotation = resolvedQuotationId
    ? source.quotations?.find(quotation => quotation.id === resolvedQuotationId)
    : undefined;
  const latest = source.quotations?.at(-1);
  if (sourceQuotation) selected.set(sourceQuotation.id, sourceQuotation);
  if (latest) selected.set(latest.id, latest);
  return [...selected.values()];
}

export function selectPairedWorkspace(
  source: FinanceData,
  actorId: string,
  params: PairedRouteParams,
): PairedWorkspaceSelection | null {
  const explicitRevision = params.revisionId
    ? source.revisions.find(revision => revision.id === params.revisionId)
    : undefined;
  if (params.revisionId && !explicitRevision) return null;

  const resolvedQuotationId = params.quotationId
    ?? explicitRevision?.quotationId
    ?? (params.draftId || params.revisionId ? undefined : source.quotations?.at(-1)?.id);
  if (resolvedQuotationId && !source.quotations?.some(quotation => quotation.id === resolvedQuotationId)) return null;

  const draft = selectedDraft(source, actorId, params, resolvedQuotationId);
  if (params.draftId && !draft) return null;

  const revisionIds = relevantRevisionIds(source, explicitRevision, draft, resolvedQuotationId);
  const revisions = source.revisions.filter(revision => revisionIds.has(revision.id));
  const projected = hydrateLinePricingData({
    ...emptyFinance(),
    config: source.config,
    closed: source.closed,
    beneficiaries: source.beneficiaries,
    revisions,
    quotations: selectedQuotations(source, resolvedQuotationId),
    quotationDrafts: draft ? [draft] : [],
    workingRevisionId: source.workingRevisionId && revisionIds.has(source.workingRevisionId)
      ? source.workingRevisionId
      : undefined,
  });

  return {
    data: projected,
    requestIds: [...new Set(revisions.map(revision => revision.requestId))],
    resolvedQuotationId,
  };
}
