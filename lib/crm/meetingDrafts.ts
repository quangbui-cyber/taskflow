import type { Prisma, PrismaClient } from "@prisma/client";
import { loadClientResource, loadOpportunityResource } from "./actor";
import { crmCan, type CrmActor } from "./policy";

export type MeetingDraftView = {
  draftId: string;
  clientId: string;
  clientName: string;
  opportunityId: string | null;
  opportunityName: string | null;
  occurredAt: string;
  meetingTitle: string;
  canConfirm: boolean;
};

export async function loadMeetingDraftForViewer(
  db: PrismaClient | Prisma.TransactionClient,
  { meetingId, meetingTitle, canSee, actor }: {
    meetingId: string;
    meetingTitle: string;
    canSee: boolean;
    actor: CrmActor;
  },
): Promise<MeetingDraftView | null> {
  if (!canSee) return null;
  const draft = await db.touchpoint.findFirst({
    where: { sourceId: meetingId, sourceType: { in: ["RECAP", "MEETING"] }, status: "DRAFT" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      clientId: true,
      client: { select: { name: true } },
      opportunityId: true,
      opportunity: { select: { name: true } },
      occurredAt: true,
    },
  });
  if (!draft) return null;

  // Confirmation must keep the draft's original owner. Closed Opportunities cannot accept a next task.
  const owner = draft.opportunityId
    ? await loadOpportunityResource(db, draft.opportunityId)
    : await loadClientResource(db, draft.clientId);
  return {
    draftId: draft.id,
    clientId: draft.clientId,
    clientName: draft.client.name,
    opportunityId: draft.opportunityId,
    opportunityName: draft.opportunity?.name ?? null,
    occurredAt: draft.occurredAt.toISOString(),
    meetingTitle,
    canConfirm: owner !== null && crmCan(actor, "LOG_TOUCHPOINT", owner),
  };
}
