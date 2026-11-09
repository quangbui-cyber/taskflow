import { Prisma, type PrismaClient } from "@prisma/client";
import { projectStatusColor } from "../types";
import { loadOpportunityResource } from "./actor";
import { vnDateKey, vnDayStart } from "./dates";
import { canClose } from "./opportunityStage";
import { lockOpportunity } from "./opportunityWorkflow";
import { crmCan, type CrmActor } from "./policy";

type Actor = CrmActor & { name: string };
export type WinOpportunityInput = {
  opportunityId: string;
  expectedVersion: number;
  contractValue: number;
  wonAt: Date;
  projectName: string;
};
type WinResult = { ok: true; projectId: string; projectName: string; alreadyWon: boolean } | { error: string };
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const STALE = "Dữ liệu vừa được người khác cập nhật. Tải lại trang để xem bản mới.";
const FAILED = "Chưa tạo được Project. Cơ hội vẫn ở Bidding, thử lại sau ít phút.";

export async function winPreview(db: PrismaClient, opportunityId: string) {
  const [opportunity, tasks, files, meetings] = await Promise.all([
    db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { budgetMin: true, budgetMax: true } }),
    db.task.count({ where: { opportunityId } }),
    db.projectFile.count({ where: { opportunityId } }),
    db.meeting.count({ where: { opportunityId } }),
  ]);
  return { tasks, files, meetings, ...opportunity };
}

/** Read participants before moving tasks away from their Opportunity. */
export async function opportunityProjectMemberIds(tx: Prisma.TransactionClient, opportunityId: string): Promise<string[]> {
  const opportunity = await tx.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: {
    picAccount: { select: { userId: true } }, opportunityMembers: { select: { userId: true } },
  } });
  const tasks = await tx.task.findMany({ where: { opportunityId }, select: {
    creatorId: true, assigneeId: true, followers: { select: { userId: true } },
  } });
  return [...new Set([opportunity.picAccount?.userId, ...opportunity.opportunityMembers.map((member) => member.userId),
    ...tasks.flatMap((task) => [task.creatorId, task.assigneeId, ...task.followers.map((follower) => follower.userId)]),
  ].filter((id): id is string => !!id))];
}

export async function moveOpportunityWorkToProjectTx(tx: Prisma.TransactionClient, opportunityId: string, projectId: string): Promise<{ tasks: number; files: number; meetings: number }> {
  const owner = { opportunityId: null, projectId, sourceOpportunityId: opportunityId };
  const tasks = await tx.task.updateMany({ where: { opportunityId }, data: owner });
  const files = await tx.projectFile.updateMany({ where: { opportunityId }, data: owner });
  const meetings = await tx.meeting.updateMany({ where: { opportunityId }, data: owner });
  return { tasks: tasks.count, files: files.count, meetings: meetings.count };
}

export async function closeOpportunityEventStepsTx(tx: Prisma.TransactionClient, opportunityId: string, reason: "OPPORTUNITY_WON"): Promise<number> {
  const { expectedEventId } = await tx.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, select: { expectedEventId: true } });
  if (!expectedEventId) return 0;
  await tx.$queryRaw`SELECT id FROM "ExpectedEvent" WHERE id = ${expectedEventId} FOR UPDATE`;
  return (await tx.reminderStep.updateMany({ where: { expectedEventId, status: { in: ["PLANNED", "OPEN"] } }, data: { status: "CLOSED", closedReason: reason } })).count;
}

/** Commit the whole ownership transfer before the caller schedules Drive work in after(). */
export async function winOpportunity(db: PrismaClient, actor: Actor, input: WinOpportunityInput): Promise<WinResult> {
  if (!Number.isSafeInteger(input.contractValue) || input.contractValue <= 0) return { error: "Nhập giá trị hợp đồng." };
  if (!(input.wonAt instanceof Date) || !Number.isFinite(input.wonAt.getTime()) || vnDateKey(input.wonAt) > vnDateKey(new Date())) return { error: "Nhập ngày thắng không sau hôm nay." };
  if (typeof input.projectName !== "string" || !input.projectName.trim() || input.projectName.trim().length > 200) return { error: "Nhập tên Project từ 1 đến 200 ký tự." };
  if (typeof input.opportunityId !== "string" || !input.opportunityId || input.opportunityId.length > 64 || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) return { error: "Thông tin Cơ hội không hợp lệ." };
  try {
    return await db.$transaction<WinResult>(async (tx) => {
      await lockOpportunity(tx, input.opportunityId);
      const opportunity = await tx.opportunity.findUnique({ where: { id: input.opportunityId }, include: {
        picAccount: { select: { userId: true } }, opportunityMembers: { select: { userId: true } },
      } });
      if (!opportunity) return { error: DENIED };
      const resource = await loadOpportunityResource(tx, opportunity.id);
      // Repeated wins are read-only, but still require the original action's assignment.
      if (resource?.kind !== "OPPORTUNITY" || !crmCan(actor, "CLOSE_OPPORTUNITY", opportunity.outcome === "WON" ? { ...resource, closed: false } : resource)) {
        if (opportunity.outcome !== null && opportunity.outcome !== "WON") return { error: "Cơ hội đã kết thúc không mở lại được." };
        return { error: DENIED };
      }
      if (opportunity.outcome === "WON") {
        const existing = await tx.project.findUnique({ where: { sourceOpportunityId: opportunity.id }, select: { id: true, name: true } });
        return existing ? { ok: true, projectId: existing.id, projectName: existing.name, alreadyWon: true } : { error: FAILED };
      }
      if (opportunity.outcome !== null) return { error: "Cơ hội đã kết thúc không mở lại được." };
      if (!canClose(opportunity, "WON")) return { error: "Thắng chỉ ghi được từ Bidding." };
      if (opportunity.version !== input.expectedVersion) return { error: STALE };

      const memberIds = new Set([actor.id, ...await opportunityProjectMemberIds(tx, opportunity.id)]);
      const changed = await tx.opportunity.updateMany({ where: { id: opportunity.id, version: input.expectedVersion, outcome: null }, data: {
        outcome: "WON", wonAt: input.wonAt, closedAt: new Date(), closedById: actor.id, contractValue: input.contractValue, version: { increment: 1 },
      } });
      if (changed.count !== 1) return { error: STALE };
      const project = await tx.project.create({ data: {
        name: input.projectName.trim(), category: "CLIENT", status: "ON_PROCESS", color: projectStatusColor("ON_PROCESS"),
        type: opportunity.programTypeCode, clientId: opportunity.clientId, accountId: opportunity.picAccountId,
        revenue: input.contractValue, onProcessAt: vnDayStart(input.wonAt), ownerId: actor.id, sourceOpportunityId: opportunity.id,
        members: { create: [...memberIds].map((userId) => ({ userId, role: userId === actor.id ? "owner" : "member" })) },
      }, select: { id: true, name: true } });
      await moveOpportunityWorkToProjectTx(tx, opportunity.id, project.id);
      await tx.opportunityStageEvent.create({ data: {
        opportunityId: opportunity.id, fromStage: "BIDDING", toStage: "WON", outcome: "WON", actorId: actor.id, actorName: actor.name,
      } });
      await closeOpportunityEventStepsTx(tx, opportunity.id, "OPPORTUNITY_WON");
      return { ok: true, projectId: project.id, projectName: project.name, alreadyWon: false };
    }, { timeout: 15_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" &&
      Array.isArray(error.meta?.target) && error.meta.target.includes("sourceOpportunityId")) {
      try {
        const resource = await loadOpportunityResource(db, input.opportunityId);
        if (resource?.kind !== "OPPORTUNITY" || !crmCan(actor, "CLOSE_OPPORTUNITY", { ...resource, closed: false })) return { error: DENIED };
        const existing = await db.project.findUnique({ where: { sourceOpportunityId: input.opportunityId }, select: { id: true, name: true } });
        if (existing) return { ok: true, projectId: existing.id, projectName: existing.name, alreadyWon: true };
      } catch { /* A failed lookup must not disclose database details. */ }
    }
    console.warn("CRM opportunity win transaction failed.");
    return { error: FAILED };
  }
}
