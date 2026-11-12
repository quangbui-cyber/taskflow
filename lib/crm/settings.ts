import { Prisma, type PrismaClient } from "@prisma/client";
import { cache } from "react";
import { prisma } from "../prisma";
import { loadProgramTypes, LEGACY_PROGRAM_CODES } from "../programTypes";
import { DEFAULT_CADENCE_WEEKS, parseClientCatalog, type ClientCatalogItem, parseCadenceWeeks, parsePotentialScale, parseTierMatrix, parseReminderOffsets, parseReviewPriority, type CadenceWeeks, type PotentialLevel, type TierMatrix, type ReminderOffsets, type ReviewPriorityKey } from "./settingsSchema";
import { parsePipelineMode, type PipelineModeSetting } from "./pipelineMode";
import { emptyPersonaDepth, parsePersonaDepth, type PersonaDepth } from "./personaDepth";
import { parseCrmAccessUsers } from "../features";
import { parseWeeklyLoadWarn } from "./campaignPlan";
export const CRM_SETTING_KEYS = ["tier.cadenceWeeks", "tier.potentialScale", "tier.matrix", "reminder.offsets", "review.priority", "pipeline.mode", "persona.depth", "client.industries", "client.sources", "access.users", "campaign.weeklyLoadWarn"] as const;
/** Optional keys are created by the first explicit Admin save, without a migration or reseed. */
const OPTIONAL_KEYS: readonly CrmSettingKey[] = ["persona.depth", "client.industries", "client.sources", "access.users", "campaign.weeklyLoadWarn"];
const CATALOG_COLUMNS = { "client.industries": "industry", "client.sources": "acquisitionSource" } as const;
export type CrmSettingKey = typeof CRM_SETTING_KEYS[number];
export type CrmSettings = { cadenceWeeks: CadenceWeeks; potentialScale: PotentialLevel[]; tierMatrix: TierMatrix; reminderOffsets: ReminderOffsets; reviewPriority: ReviewPriorityKey[]; pipelineMode: PipelineModeSetting; personaDepth: PersonaDepth; industries: ClientCatalogItem[]; sources: ClientCatalogItem[]; accessUserIds: string[]; campaignWeeklyLoadWarn: number | null; versions: Record<CrmSettingKey, number> };
type Actor = { id: string; name: string };
type Db = PrismaClient;
const STALE = "Dữ liệu vừa được người khác cập nhật. Tải lại trang để xem bản mới.";
const INVALID = "Cấu hình không hợp lệ.";
const defaults = {
  "tier.cadenceWeeks": DEFAULT_CADENCE_WEEKS, "tier.potentialScale": [], "tier.matrix": { revenueBands: [], cells: {} },
  "reminder.offsets": { MICE: [90,60,30], YEP: [90,60,30], OUTING: [60,30], TEAMBUILDING: [60,30], ACTIVATION: [45,21], EVENT: [45,21] },
  "review.priority": ["APPOINTMENT", "PLAN_CLOSE", "ESCALATED", "TIER"], "pipeline.mode": { mode: "PROJECT_OFFICIAL", pilotTeamIds: [], plannedCutoverDate: null },
  "persona.depth": emptyPersonaDepth(), "client.industries": [], "client.sources": [], "access.users": [], "campaign.weeklyLoadWarn": { perWeek: null },
};
function parse(key: CrmSettingKey, value: unknown) {
  switch (key) {
    case "tier.cadenceWeeks": return parseCadenceWeeks(value);
    case "tier.potentialScale": return parsePotentialScale(value);
    case "tier.matrix": return parseTierMatrix(value);
    case "reminder.offsets": return parseReminderOffsets(value);
    case "review.priority": return parseReviewPriority(value);
    case "pipeline.mode": return parsePipelineMode(value);
    case "persona.depth": return parsePersonaDepth(value);
    case "client.industries": case "client.sources": return parseClientCatalog(value);
    case "access.users": return parseCrmAccessUsers(value);
    case "campaign.weeklyLoadWarn": return parseWeeklyLoadWarn(value);
  }
}
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
async function log(tx: Prisma.TransactionClient, key: string, oldValue: unknown, newValue: unknown, actor: Actor) {
  await tx.crmSettingChange.create({ data: { key, oldValue: oldValue === null ? Prisma.JsonNull : json(oldValue), newValue: json(newValue), userId: actor.id, userName: actor.name } });
}
export async function getCrmSettings(db: PrismaClient | Prisma.TransactionClient): Promise<CrmSettings> {
  const rows = await db.crmSetting.findMany({ where: { key: { in: [...CRM_SETTING_KEYS] } } });
  const value = (key: CrmSettingKey) => parse(key, rows.find((r) => r.key === key)?.value) ?? defaults[key];
  return { cadenceWeeks: value("tier.cadenceWeeks") as CadenceWeeks, potentialScale: value("tier.potentialScale") as PotentialLevel[], tierMatrix: value("tier.matrix") as TierMatrix, reminderOffsets: value("reminder.offsets") as ReminderOffsets, reviewPriority: value("review.priority") as ReviewPriorityKey[], pipelineMode: value("pipeline.mode") as PipelineModeSetting, personaDepth: value("persona.depth") as PersonaDepth, industries: value("client.industries") as ClientCatalogItem[], sources: value("client.sources") as ClientCatalogItem[], accessUserIds: value("access.users") as string[], campaignWeeklyLoadWarn: (value("campaign.weeklyLoadWarn") as { perWeek: number | null }).perWeek, versions: Object.fromEntries(CRM_SETTING_KEYS.map((key) => [key, rows.find((r) => r.key === key)?.version ?? 0])) as Record<CrmSettingKey, number> };
}
export const getCrmSettingsCached = cache(() => getCrmSettings(prisma));
export const CRM_LIMITED_SOURCE_ERROR = "Đang ở chế độ giới hạn. Chưa thể chuyển báo cáo chính thức sang Cơ hội.";
/** limitedAccess (crm54): while CRM is opened per person, the official report source cannot move to OPPORTUNITY_OFFICIAL. */
export async function saveCrmSetting(db: Db, input: { key: CrmSettingKey; value: unknown; expectedVersion: number; actor: Actor; limitedAccess?: boolean }): Promise<{ ok: true; version: number } | { error: string }> {
  const { key, expectedVersion, actor } = input;
  if (!CRM_SETTING_KEYS.includes(key) || !Number.isInteger(expectedVersion) || expectedVersion < 0) return { error: INVALID };
  const parsed = parse(key, input.value);
  if (parsed === null) return { error: INVALID };
  try { return await db.$transaction(async (tx) => {
    const previous = await tx.crmSetting.findUnique({ where: { key } });
    if (key === "pipeline.mode" && input.limitedAccess && (parsed as PipelineModeSetting).mode === "OPPORTUNITY_OFFICIAL" && parsePipelineMode(previous?.value)?.mode !== "OPPORTUNITY_OFFICIAL") return { error: CRM_LIMITED_SOURCE_ERROR };
    if (key === "access.users") {
      const ids = parsed as string[];
      if (ids.length && await tx.user.count({ where: { id: { in: ids }, isActive: true, deletedAt: null } }) !== ids.length) return { error: INVALID };
    }
    if (key === "client.industries" || key === "client.sources") {
      const kept = new Set((parsed as ClientCatalogItem[]).map((item) => item.label));
      const removed = (parseClientCatalog(previous?.value) ?? []).map((item) => item.label).filter((label) => !kept.has(label));
      const column = CATALOG_COLUMNS[key];
      if (removed.length && await tx.client.count({ where: { [column]: { in: removed } } })) return { error: "Mục đang được dùng cho khách. Hãy tắt mục thay vì xóa hoặc đổi tên." };
    }
    if (!previous && OPTIONAL_KEYS.includes(key) && expectedVersion === 0) {
      await tx.crmSetting.create({ data: { key, value: json(parsed), version: 1, updatedById: actor.id } });
      await log(tx, key, null, parsed, actor);
      return { ok: true, version: 1 };
    }
    if (!previous || previous.version !== expectedVersion) return { error: STALE };
    const saved = await tx.crmSetting.updateMany({ where: { key, version: expectedVersion }, data: { value: json(parsed), version: { increment: 1 }, updatedById: actor.id } });
    if (saved.count !== 1) return { error: STALE };
    await log(tx, key, previous.value, parsed, actor);
    return { ok: true, version: expectedVersion + 1 };
  }); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: STALE };
    throw error;
  }
}
export function listReasons(db: PrismaClient | Prisma.TransactionClient, opts: { group?: string; includeHidden?: boolean } = {}) {
  return db.crmReason.findMany({ where: { ...(opts.group ? { group: opts.group } : {}), ...(opts.includeHidden ? {} : { active: true }) }, orderBy: [{ order: "asc" }, { label: "asc" }] });
}
export async function saveReason(db: Db, input: { id?: string; group: string; label: string; requiresNote: boolean; active: boolean; order: number }, actor: Actor) {
  if (!["LOST", "CANCELLED", "DECLINED"].includes(input.group) || typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 80 || !Number.isInteger(input.order) || typeof input.active !== "boolean" || typeof input.requiresNote !== "boolean") return { error: INVALID };
  try { return await db.$transaction(async (tx) => {
    const old = input.id ? await tx.crmReason.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !old) return { error: INVALID };
    const data = { group: input.group, label: input.label.trim(), requiresNote: input.requiresNote, active: input.active, order: input.order };
    const row = old ? await tx.crmReason.update({ where: { id: old.id }, data }) : await tx.crmReason.create({ data });
    await log(tx, `reason.${input.group}`, old, row, actor);
    return { id: row.id };
  }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "Tên lý do đã tồn tại." }; throw error; }
}
export function listProgramTypesForAdmin(db: PrismaClient | Prisma.TransactionClient) { return loadProgramTypes(db, { activeOnly: false }); }
export async function saveProgramType(db: Db, input: { code: string; label: string; color: string; active: boolean; order: number }, actor: Actor) {
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(input.code) || typeof input.label !== "string" || !input.label.trim() || input.label.trim().length > 80 || !/^#[0-9a-fA-F]{6}$/.test(input.color) || !Number.isInteger(input.order) || typeof input.active !== "boolean") return { error: INVALID };
  return db.$transaction(async (tx) => {
    const old = await tx.programType.findUnique({ where: { code: input.code } });
    if (!old && LEGACY_PROGRAM_CODES.includes(input.code)) return { error: "Không thay đổi mã loại chương trình có sẵn." };
    const data = { label: input.label.trim(), color: input.color, active: input.active, order: input.order };
    const row = await tx.programType.upsert({ where: { code: input.code }, create: { code: input.code, ...data }, update: data });
    await log(tx, `programType.${row.code}`, old, row, actor);
    return { code: row.code };
  });
}
async function activeIds(tx: Prisma.TransactionClient, userIds: string[]) {
  if (!Array.isArray(userIds) || userIds.length > 100 || userIds.some((id) => typeof id !== "string" || !id || id.length > 64)) return null;
  const ids = [...new Set(userIds)];
  return await tx.user.count({ where: { id: { in: ids }, isActive: true, deletedAt: null } }) === ids.length ? ids : null;
}
export async function setTeamManagers(db: Db, teamId: string, userIds: string[], actor: Actor) {
  return db.$transaction(async (tx) => {
    const ids = await activeIds(tx, userIds);
    if (!ids || !await tx.salesTeam.findUnique({ where: { id: teamId } })) return { error: INVALID };
    const old = await tx.crmTeamManager.findMany({ where: { teamId }, select: { userId: true } });
    await tx.crmTeamManager.deleteMany({ where: { teamId } });
    await tx.crmTeamManager.createMany({ data: ids.map((userId) => ({ teamId, userId })) });
    await log(tx, `teamManagers.${teamId}`, old.map((u) => u.userId), ids, actor);
    return { ok: true as const };
  });
}
export async function setCrmDataStewards(db: Db, userIds: string[], actor: Actor) {
  return db.$transaction(async (tx) => {
    const ids = await activeIds(tx, userIds);
    if (!ids) return { error: INVALID };
    const old = await tx.user.findMany({ where: { isCrmDataSteward: true }, select: { id: true } });
    await tx.user.updateMany({ where: { isCrmDataSteward: true, id: { notIn: ids } }, data: { isCrmDataSteward: false } });
    await tx.user.updateMany({ where: { id: { in: ids } }, data: { isCrmDataSteward: true } });
    await log(tx, "stewards", old.map((u) => u.id), ids, actor);
    return { ok: true as const };
  });
}
export function listSettingChanges(db: PrismaClient | Prisma.TransactionClient, keyPrefix: string, limit = 20) {
  return db.crmSettingChange.findMany({ where: { key: { startsWith: keyPrefix } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.max(1, Math.min(100, Math.trunc(limit) || 20)) });
}
/** crm50: tag and competitor catalogs follow the reason/program pattern: unique label, disable instead of delete, history per row. */
const catalogText = (value: unknown, max: number) => typeof value === "string" && !!value.normalize("NFKC").trim() && value.normalize("NFKC").trim().length <= max;
const cleanLabel = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ");
export function listClientTags(db: PrismaClient | Prisma.TransactionClient, opts: { includeHidden?: boolean } = {}) {
  return db.clientTag.findMany({ where: opts.includeHidden ? {} : { active: true }, orderBy: [{ order: "asc" }, { label: "asc" }] });
}
export function listCompetitors(db: PrismaClient | Prisma.TransactionClient, opts: { includeHidden?: boolean } = {}) {
  return db.competitor.findMany({ where: opts.includeHidden ? {} : { active: true }, orderBy: { name: "asc" } });
}
export async function saveClientTag(db: Db, input: { id?: string; label: string; active: boolean; order: number }, actor: Actor): Promise<{ id: string } | { error: string }> {
  if ((input.id !== undefined && (typeof input.id !== "string" || !input.id || input.id.length > 64)) || !catalogText(input.label, 60) || typeof input.active !== "boolean" || !Number.isSafeInteger(input.order)) return { error: INVALID };
  const label = cleanLabel(input.label);
  try { return await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crm:client-tag-catalog'))`;
    const old = input.id ? await tx.clientTag.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !old) return { error: INVALID };
    const clash = await tx.clientTag.findFirst({ where: { label: { equals: label, mode: "insensitive" }, ...(old ? { id: { not: old.id } } : {}) }, select: { id: true } });
    if (clash) return { error: "Nhãn đã tồn tại." };
    const data = { label, active: input.active, order: input.order };
    const row = old ? await tx.clientTag.update({ where: { id: old.id }, data }) : await tx.clientTag.create({ data });
    await log(tx, `clientTag.${row.id}`, old, row, actor);
    return { id: row.id };
  }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "Nhãn đã tồn tại." }; throw error; }
}
export async function saveCompetitor(db: Db, input: { id?: string; name: string; active: boolean }, actor: Actor): Promise<{ id: string } | { error: string }> {
  if ((input.id !== undefined && (typeof input.id !== "string" || !input.id || input.id.length > 64)) || !catalogText(input.name, 120) || typeof input.active !== "boolean") return { error: INVALID };
  const name = cleanLabel(input.name);
  try { return await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crm:competitor-catalog'))`;
    const old = input.id ? await tx.competitor.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !old) return { error: INVALID };
    const clash = await tx.competitor.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(old ? { id: { not: old.id } } : {}) }, select: { id: true } });
    if (clash) return { error: "Agency đã có trong danh mục." };
    const row = old ? await tx.competitor.update({ where: { id: old.id }, data: { name, active: input.active } }) : await tx.competitor.create({ data: { name, active: input.active } });
    await log(tx, `competitor.${row.id}`, old, row, actor);
    return { id: row.id };
  }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "Agency đã có trong danh mục." }; throw error; }
}
