import type { Prisma, PrismaClient } from "@prisma/client";
import { loadOpportunityResource } from "./actor";
import { lockOpportunity } from "./opportunityWorkflow";
import { validateOpenOpportunityInput } from "./opportunityStage";
import { crmCan, type CrmActor } from "./policy";

type Actor = CrmActor & { name: string };
type Result = { ok: true; version: number } | { error: string };
export type EditOpportunityInput = {
  opportunityId: string; expectedVersion: number; name?: string; programTypeCode?: string; buyingUnitId?: string | null;
  expectedYear?: number; expectedMonth?: number | null; expectedQuarter?: number | null; demandSignal?: string; confirmReason?: string | null; source?: string;
  budgetMin?: number | null; budgetMax?: number | null; briefSummary?: string | null; winStrategy?: string | null; proposalDueAt?: Date | null; proposalPlannedAt?: Date | null;
};
export type ChangeOpportunityPicInput = { opportunityId: string; expectedVersion: number; picAccountId: string; responsibleTeamId: string | null };
type Notice = { type: "CRM_PIC_ASSIGNED"; message: string; opportunityId: string };
type Effects = { notify: (ids: string[], data: Notice) => Promise<void> };
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const STALE = "Dữ liệu vừa được người khác cập nhật. Tải lại trang để xem bản mới.";
const CLOSED = "Cơ hội đã kết thúc không mở lại được.";
const INVALID = "Thông tin Cơ hội không hợp lệ.";
const id = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 64;
const version = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown) => v === undefined || v === null || (v instanceof Date && Number.isFinite(v.getTime()));
const text = (v: unknown, limit: number) => v === undefined || v === null || (typeof v === "string" && v.trim().length <= limit);
const EDIT_KEYS = ["name", "programTypeCode", "buyingUnitId", "expectedYear", "expectedMonth", "expectedQuarter", "demandSignal", "confirmReason", "source", "budgetMin", "budgetMax", "briefSummary", "winStrategy", "proposalDueAt", "proposalPlannedAt"] as const;

export async function editOpportunity(db: PrismaClient, actor: Actor, input: EditOpportunityInput): Promise<Result> {
  if (!id(input.opportunityId) || !version(input.expectedVersion) || !EDIT_KEYS.some((key) => input[key] !== undefined)) return { error: INVALID };
  if ((input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 200)) || (input.programTypeCode !== undefined && !id(input.programTypeCode)) || (input.source !== undefined && typeof input.source !== "string") || (input.demandSignal !== undefined && typeof input.demandSignal !== "string")) return { error: INVALID };
  if (!text(input.confirmReason, 2000) || !text(input.briefSummary, 4000) || !text(input.winStrategy, 4000) || !date(input.proposalDueAt) || !date(input.proposalPlannedAt)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    await lockOpportunity(tx, input.opportunityId);
    const current = await tx.opportunity.findUnique({ where: { id: input.opportunityId } });
    if (!current) return { error: DENIED };
    if (current.outcome !== null) return { error: CLOSED };
    const resource = await loadOpportunityResource(tx, current.id);
    if (!resource || !crmCan(actor, "EDIT", resource)) return { error: DENIED };
    if (current.version !== input.expectedVersion) return { error: STALE };
    if (input.programTypeCode !== undefined && input.programTypeCode !== current.programTypeCode && current.expectedEventId) return { error: "Cơ hội đang gắn sự kiện dự kiến, không đổi loại chương trình được." };
    const merged = { ...current, budgetMin: current.budgetMin === null ? null : Number(current.budgetMin), budgetMax: current.budgetMax === null ? null : Number(current.budgetMax) };
    for (const key of EDIT_KEYS) if (input[key] !== undefined) Object.assign(merged, { [key]: input[key] });
    const checked = validateOpenOpportunityInput(merged);
    if (!("ok" in checked)) return { error: Object.values(checked.errors)[0] };
    if (!await tx.programType.findFirst({ where: { code: merged.programTypeCode, active: true }, select: { code: true } })) return { error: "Chọn loại chương trình đang dùng." };
    if (merged.buyingUnitId && !await tx.buyingUnit.findFirst({ where: { id: merged.buyingUnitId, clientId: current.clientId, active: true }, select: { id: true } })) return { error: INVALID };
    const data: Prisma.OpportunityUpdateManyMutationInput = { version: { increment: 1 } };
    for (const key of EDIT_KEYS) {
      if (input[key] === undefined) continue;
      const value = input[key];
      Object.assign(data, { [key]: typeof value === "string" ? value.trim() || null : value });
    }
    const changed = await tx.opportunity.updateMany({ where: { id: current.id, version: input.expectedVersion, outcome: null }, data });
    return changed.count === 1 ? { ok: true, version: current.version + 1 } : { error: STALE };
  });
}

export async function changeOpportunityPicOrTeam(db: PrismaClient, actor: Actor, input: ChangeOpportunityPicInput, effects?: Effects): Promise<Result> {
  if (!id(input.opportunityId) || !version(input.expectedVersion) || !id(input.picAccountId) || (input.responsibleTeamId !== null && !id(input.responsibleTeamId))) return { error: INVALID };
  const result = await db.$transaction<{ ok: true; version: number; notifyUserId: string | null; name: string } | { error: string }>(async (tx) => {
    await lockOpportunity(tx, input.opportunityId);
    const current = await tx.opportunity.findUnique({ where: { id: input.opportunityId } });
    if (!current) return { error: DENIED };
    if (current.outcome !== null) return { error: CLOSED };
    const resource = await loadOpportunityResource(tx, current.id);
    if (!resource || !crmCan(actor, "CHANGE_PIC_OR_TEAM", resource)) return { error: DENIED };
    if (current.version !== input.expectedVersion) return { error: STALE };
    const [pic, team] = await Promise.all([
      tx.account.findUnique({ where: { id: input.picAccountId }, select: { userId: true, user: { select: { isActive: true, deletedAt: true } } } }),
      input.responsibleTeamId ? tx.salesTeam.findUnique({ where: { id: input.responsibleTeamId }, select: { id: true } }) : null,
    ]);
    if (!pic || (pic.user && (!pic.user.isActive || pic.user.deletedAt)) || (input.responsibleTeamId && !team)) return { error: INVALID };
    const changed = await tx.opportunity.updateMany({ where: { id: current.id, version: input.expectedVersion, outcome: null }, data: { picAccountId: input.picAccountId, responsibleTeamId: input.responsibleTeamId, version: { increment: 1 } } });
    if (changed.count !== 1) return { error: STALE };
    if (pic.userId) await tx.opportunityMember.upsert({ where: { opportunityId_userId: { opportunityId: current.id, userId: pic.userId } }, create: { opportunityId: current.id, userId: pic.userId }, update: {} });
    return { ok: true, version: current.version + 1, notifyUserId: current.picAccountId !== input.picAccountId && pic.userId !== actor.id ? pic.userId : null, name: current.name };
  });
  if (!("ok" in result)) return result;
  if (result.notifyUserId) {
    try { const notify = effects?.notify ?? (await import("../notify")).notify; await notify([result.notifyUserId], { type: "CRM_PIC_ASSIGNED", message: `Bạn được giao phụ trách Cơ hội ${result.name}.`, opportunityId: input.opportunityId }); }
    catch { console.warn("CRM Opportunity PIC notification could not be delivered."); }
  }
  return { ok: true, version: result.version };
}
