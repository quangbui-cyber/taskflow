import type { Prisma, PrismaClient } from "@prisma/client";
import { loadOpportunityResource } from "./actor";
import { vnDayStart } from "./dates";
import { closeOpportunityEventStepsTx, moveOpportunityWorkToProjectTx, opportunityProjectMemberIds } from "./opportunityWin";
import { lockOpportunity } from "./opportunityWorkflow";
import { crmCan, type CrmActor } from "./policy";

const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";

export async function listPurchaseOrderSourceOpportunities(db: PrismaClient | Prisma.TransactionClient, actor: CrmActor): Promise<{ id: string; name: string; clientId: string; clientName: string; programTypeCode: string }[]> {
  if (!actor.id) return [];
  // Apply permission scope before take, using the same fallback order as loadOpportunityResource.
  const assignment: Prisma.OpportunityWhereInput = actor.role === "ADMIN" ? {} : { OR: [
    { picAccount: { userId: actor.id } }, { responsibleTeamId: { in: actor.managedTeamIds } },
    { responsibleTeamId: null, picAccount: { teamId: { in: actor.managedTeamIds } } },
    { responsibleTeamId: null, picAccountId: null, client: { OR: [
      { responsibleTeamId: { in: actor.managedTeamIds } },
      { responsibleTeamId: null, picAccount: { teamId: { in: actor.managedTeamIds } } },
    ] } },
  ] };
  const opportunities = await db.opportunity.findMany({ where: { outcome: null, stage: "BIDDING", ...assignment }, select: {
    id: true, name: true, clientId: true, programTypeCode: true, responsibleTeamId: true, picAccount: { select: { userId: true, teamId: true } },
    client: { select: { name: true, responsibleTeamId: true, picAccount: { select: { teamId: true } } } },
  }, orderBy: [{ client: { name: "asc" } }, { name: "asc" }, { id: "asc" }], take: 200 });
  return opportunities.filter((o) => crmCan(actor, "CLOSE_OPPORTUNITY", { kind: "OPPORTUNITY", closed: false, picUserId: o.picAccount?.userId ?? null, teamId: o.responsibleTeamId ?? o.picAccount?.teamId ?? o.client.responsibleTeamId ?? o.client.picAccount?.teamId ?? null }))
    .map((o) => ({ id: o.id, name: o.name, clientId: o.clientId, clientName: o.client.name, programTypeCode: o.programTypeCode }));
}

type LinkInput = { opportunityId: string; projectId: string; contractValue: number; purchaseOrderNumber: string; wonAt: Date; now: Date };
type LinkResult = { ok: true; moved: { tasks: number; files: number; meetings: number } } | { error: string };

/** The caller must roll back its Project creation when this returns an error. */
export async function linkPurchaseOrderProjectTx(tx: Prisma.TransactionClient, actor: CrmActor & { name: string }, input: LinkInput): Promise<LinkResult> {
  await lockOpportunity(tx, input.opportunityId);
  const opportunity = await tx.opportunity.findUnique({ where: { id: input.opportunityId } });
  if (!opportunity) return { error: DENIED };
  if (opportunity.outcome !== null) return { error: "Cơ hội đã kết thúc không mở lại được." };
  if (opportunity.stage !== "BIDDING") return { error: "Chỉ gắn được Cơ hội đang ở Bidding." };
  const resource = await loadOpportunityResource(tx, opportunity.id);
  if (!resource || !crmCan(actor, "CLOSE_OPPORTUNITY", resource)) return { error: DENIED };
  const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { clientId: true } });
  if (!project || project.clientId !== opportunity.clientId) return { error: "Cơ hội không thuộc khách của dự án." };
  if (!Number.isSafeInteger(input.contractValue) || input.contractValue <= 0) return { error: "Nhập giá trị hợp đồng." };
  if (!(input.wonAt instanceof Date) || !Number.isFinite(input.wonAt.getTime()) || input.wonAt > vnDayStart(input.now)) return { error: "Ngày PO không được sau hôm nay." };
  const memberIds = await opportunityProjectMemberIds(tx, opportunity.id);
  await tx.project.update({ where: { id: input.projectId }, data: { sourceOpportunityId: opportunity.id, onProcessAt: vnDayStart(input.wonAt), members: { createMany: { data: memberIds.map((userId) => ({ userId, role: "member" })), skipDuplicates: true } } } });
  const moved = await moveOpportunityWorkToProjectTx(tx, opportunity.id, input.projectId);
  await tx.opportunity.update({ where: { id: opportunity.id }, data: { outcome: "WON", wonAt: vnDayStart(input.wonAt), closedAt: input.now, closedById: actor.id, contractValue: input.contractValue, version: { increment: 1 } } });
  await tx.opportunityStageEvent.create({ data: { opportunityId: opportunity.id, fromStage: "BIDDING", toStage: "WON", outcome: "WON", actorId: actor.id, actorName: actor.name, note: `PO ${input.purchaseOrderNumber}` } });
  await closeOpportunityEventStepsTx(tx, opportunity.id, "OPPORTUNITY_WON");
  return { ok: true, moved };
}
