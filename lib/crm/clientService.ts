import { Prisma, type PrismaClient } from "@prisma/client";
import { crmCan, type CrmActor, type CrmAction, type CrmOwnerResource } from "./policy";
import { parsePotentialScale } from "./settingsSchema";

type Actor = CrmActor & { name: string };
type Result = { ok: true; version: number; id?: string } | { error: string };
type ProfileInput = {
  clientId: string;
  expectedVersion: number;
  industry?: string | null;
  budgetSeason?: string | null;
  budgetSeasonMonth?: number | null;
  vendorSelection?: string | null;
  valuedMost?: string | null;
};
type AssignmentNotice = { type: "CRM_PIC_ASSIGNED"; message: string; clientId: string };
type Effects = { notify: (ids: string[], data: AssignmentNotice) => Promise<void> };
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const STALE = "Dữ liệu vừa được người khác cập nhật. Tải lại trang để xem bản mới.";
const INVALID = "Thông tin khách hàng không hợp lệ.";
const validId = (id: unknown): id is string => typeof id === "string" && !!id && id.length <= 64;
const validVersion = (version: number) => Number.isSafeInteger(version) && version >= 0;
const validText = (value: unknown, max = 500) => value === undefined || value === null || (typeof value === "string" && value.trim().length <= max);
const text = (value: string | null | undefined) => value?.trim() || null;

async function loadLocked(tx: Prisma.TransactionClient, actor: Actor, clientId: string, action: CrmAction) {
  await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
  const client = await tx.client.findUnique({ where: { id: clientId }, include: { picAccount: { select: { userId: true, teamId: true } } } });
  if (!client) return null;
  const resource: CrmOwnerResource = { kind: "CLIENT", picUserId: client.picAccount?.userId ?? null, teamId: client.responsibleTeamId ?? client.picAccount?.teamId ?? null };
  return crmCan(actor, action, resource) ? client : null;
}

export async function updateClientProfile(db: PrismaClient, actor: Actor, input: ProfileInput): Promise<Result> {
  if (!validId(input.clientId) || !validVersion(input.expectedVersion)) return { error: INVALID };
  const fields = ["industry", "budgetSeason", "vendorSelection", "valuedMost"] as const;
  if (fields.some((field) => !validText(input[field]))) return { error: INVALID };
  if (input.budgetSeasonMonth !== undefined && input.budgetSeasonMonth !== null && (!Number.isInteger(input.budgetSeasonMonth) || input.budgetSeasonMonth < 1 || input.budgetSeasonMonth > 12)) return { error: "Tháng lập ngân sách phải từ 1 đến 12." };
  if (!fields.some((field) => input[field] !== undefined) && input.budgetSeasonMonth === undefined) return { error: INVALID };
  const data: Prisma.ClientUpdateManyMutationInput = { version: { increment: 1 } };
  for (const field of fields) if (input[field] !== undefined) data[field] = text(input[field]);
  if (input.budgetSeasonMonth !== undefined) data.budgetSeasonMonth = input.budgetSeasonMonth;
  return db.$transaction(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "EDIT");
    if (!client) return { error: DENIED };
    const changed = await tx.client.updateMany({ where: { id: client.id, version: input.expectedVersion }, data });
    return changed.count === 1 ? { ok: true, version: input.expectedVersion + 1 } : { error: STALE };
  });
}

export async function changeClientPicOrTeam(
  db: PrismaClient,
  actor: Actor,
  input: { clientId: string; expectedVersion: number; picAccountId: string; responsibleTeamId: string | null },
  effects?: Effects,
): Promise<Result> {
  if (!validId(input.clientId) || !validId(input.picAccountId) || !validVersion(input.expectedVersion) || (input.responsibleTeamId !== null && !validId(input.responsibleTeamId))) return { error: INVALID };
  const result = await db.$transaction<{ ok: true; version: number; notifyUserId: string | null; clientName: string } | { error: string }>(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "CHANGE_PIC_OR_TEAM");
    if (!client) return { error: DENIED };
    if (client.version !== input.expectedVersion) return { error: STALE };
    const [pic, team] = await Promise.all([
      tx.account.findUnique({ where: { id: input.picAccountId }, select: { userId: true, user: { select: { isActive: true, deletedAt: true } } } }),
      input.responsibleTeamId ? tx.salesTeam.findUnique({ where: { id: input.responsibleTeamId }, select: { id: true } }) : null,
    ]);
    if (!pic || (pic.user && (!pic.user.isActive || pic.user.deletedAt)) || (input.responsibleTeamId && !team)) return { error: INVALID };
    const changed = await tx.client.updateMany({ where: { id: client.id, version: input.expectedVersion }, data: { picAccountId: input.picAccountId, responsibleTeamId: input.responsibleTeamId, version: { increment: 1 } } });
    if (changed.count !== 1) return { error: STALE };
    return { ok: true as const, version: input.expectedVersion + 1, notifyUserId: client.picAccountId !== input.picAccountId ? pic.userId : null, clientName: client.name };
  });
  if (!("ok" in result)) return result;
  if (result.notifyUserId) {
    // External delivery is a post-commit effect, injectable for dedicated-DB tests.
    try {
      const notify = effects?.notify ?? (await import("../notify")).notify;
      await notify([result.notifyUserId], { type: "CRM_PIC_ASSIGNED", message: `Bạn được giao phụ trách ${result.clientName}.`, clientId: input.clientId });
    } catch {
      console.warn("CRM PIC assignment notification could not be delivered.");
    }
  }
  return { ok: true, version: result.version };
}

export async function saveBuyingUnit(db: PrismaClient, actor: Actor, input: { clientId: string; id?: string; name: string; active: boolean }): Promise<Result> {
  if (!validId(input.clientId) || (input.id !== undefined && !validId(input.id)) || typeof input.name !== "string" || !input.name.trim() || !validText(input.name, 200) || typeof input.active !== "boolean") return { error: INVALID };
  try {
    return await db.$transaction(async (tx) => {
      const client = await loadLocked(tx, actor, input.clientId, "EDIT");
      if (!client) return { error: DENIED };
      if (input.id && !await tx.buyingUnit.findFirst({ where: { id: input.id, clientId: client.id }, select: { id: true } })) return { error: DENIED };
      const data = { name: input.name.trim(), active: input.active };
      const unit = input.id ? await tx.buyingUnit.update({ where: { id: input.id }, data }) : await tx.buyingUnit.create({ data: { ...data, clientId: client.id } });
      await tx.client.update({ where: { id: client.id }, data: { version: { increment: 1 } } });
      return { ok: true, version: client.version + 1, id: unit.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "Đơn vị mua đã có trong khách này." };
    throw error;
  }
}

export async function scorePotential(db: PrismaClient, actor: Actor, input: { clientId: string; level: string; note?: string | null }): Promise<Result> {
  if (!validId(input.clientId) || typeof input.level !== "string" || !validText(input.note)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "SCORE_POTENTIAL");
    if (!client) return { error: DENIED };
    const setting = await tx.crmSetting.findUnique({ where: { key: "tier.potentialScale" }, select: { value: true } });
    if (!parsePotentialScale(setting?.value)?.some((level) => level.key === input.level)) return { error: "Hãy chọn mức tiềm năng đã cấu hình." };
    const now = new Date();
    await tx.client.update({ where: { id: client.id }, data: { potentialLevel: input.level, potentialScoredById: actor.id, potentialScoredAt: now, version: { increment: 1 } } });
    await tx.clientPotentialScore.create({ data: { clientId: client.id, level: input.level, note: text(input.note), scoredById: actor.id, scoredByName: actor.name, createdAt: now } });
    return { ok: true, version: client.version + 1 };
  });
}

export async function confirmImportedClient(db: PrismaClient, actor: Actor, input: { clientId: string }): Promise<Result> {
  if (!validId(input.clientId)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "CONFIRM_IMPORTED_CLIENT");
    if (!client) return { error: DENIED };
    if (client.importStatus === "CONFIRMED") return { ok: true, version: client.version };
    if (client.importStatus !== "PENDING_PIC_CONFIRM") return { error: "Khách hàng không chờ PIC xác nhận." };
    await tx.client.update({ where: { id: client.id }, data: { importStatus: "CONFIRMED", importConfirmedAt: new Date(), version: { increment: 1 } } });
    return { ok: true, version: client.version + 1 };
  });
}
