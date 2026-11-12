import { Prisma, type PrismaClient } from "@prisma/client";
import { crmCan, type CrmActor, type CrmAction, type CrmOwnerResource } from "./policy";
import { loadOpportunityResource } from "./actor";
import { parseClientCatalog, parsePotentialScale } from "./settingsSchema";
import { diffClientFields, normalizeTaxCode, normalizeWebsite, validateClientNotes, validateParentChain, type ClientFieldDiff } from "./clientProfile";
import { clientDuplicateKey } from "./clientMerge";
import { CLIENT_NAME_MAX_LENGTH, canCreateClient, clientNameError, clientNameKey, normalizeClientName } from "../clientCatalog";
import { crmDeniedForUser } from "./access";

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
    if (typeof data.industry === "string" && data.industry !== client.industry && !await inCatalog(tx, "client.industries", data.industry)) return { error: "Chọn ngành trong danh mục." };
    const changed = await tx.client.updateMany({ where: { id: client.id, version: input.expectedVersion }, data });
    if (changed.count !== 1) return { error: STALE };
    const after: Record<string, unknown> = {};
    for (const field of [...fields, "budgetSeasonMonth"] as const) if (input[field] !== undefined) after[field] = data[field];
    await logClientChanges(tx, client.id, actor, diffClientFields(client, after));
    return { ok: true, version: input.expectedVersion + 1 };
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
    const [accounts, teams] = await Promise.all([
      tx.account.findMany({ where: { id: { in: [client.picAccountId, input.picAccountId].filter((v): v is string => !!v) } }, select: { id: true, name: true } }),
      tx.salesTeam.findMany({ where: { id: { in: [client.responsibleTeamId, input.responsibleTeamId].filter((v): v is string => !!v) } }, select: { id: true, name: true } }),
    ]);
    const ref = (rows: { id: string; name: string }[], id: string | null) => id ? { id, name: rows.find((row) => row.id === id)?.name ?? id } : null;
    await logClientChanges(tx, client.id, actor, diffClientFields(
      { picAccountId: ref(accounts, client.picAccountId), responsibleTeamId: ref(teams, client.responsibleTeamId) },
      { picAccountId: ref(accounts, input.picAccountId), responsibleTeamId: ref(teams, input.responsibleTeamId) },
    ));
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
    await logClientChanges(tx, client.id, actor, diffClientFields(client, { potentialLevel: input.level }));
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

// ---- crm50: hồ sơ công ty, alias, nhãn, agency, lưu trữ và lịch sử ----
const jsonValue = (value: unknown) => value === null || value === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
/** Every caller runs this inside the same transaction as the change it describes. */
export async function logClientChanges(tx: Prisma.TransactionClient, clientId: string, actor: { id: string; name: string }, diffs: ClientFieldDiff[]) {
  if (!diffs.length) return;
  await tx.clientFieldChange.createMany({ data: diffs.map((diff) => ({ clientId, field: diff.field, oldValue: jsonValue(diff.oldValue), newValue: jsonValue(diff.newValue), actorId: actor.id, actorName: actor.name })) });
}
/** An empty catalog keeps free text (no seeded catalog yet); otherwise new values must be active catalog items. */
async function inCatalog(tx: Prisma.TransactionClient, key: "client.industries" | "client.sources", value: string) {
  const row = await tx.crmSetting.findUnique({ where: { key }, select: { value: true } });
  const items = parseClientCatalog(row?.value) ?? [];
  return !items.length || items.some((item) => item.active && item.label === value);
}
const HIERARCHY_LOCK = "crm:client-hierarchy";
export async function lockClientHierarchy(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${HIERARCHY_LOCK}))`;
}
async function nameRef(tx: Prisma.TransactionClient, id: string | null) {
  return id ? { id, name: (await tx.client.findUnique({ where: { id }, select: { name: true } }))?.name ?? id } : null;
}

export type ClientIdentityInput = {
  clientId: string; expectedVersion: number;
  taxCode?: string | null; legalName?: string | null; shortName?: string | null; website?: string | null; address?: string | null;
  acquisitionSource?: string | null; referredBy?: string | null; notes?: string | null; parentClientId?: string | null;
};
const IDENTITY_TEXT = { legalName: 300, shortName: 120, address: 500, acquisitionSource: 80, referredBy: 200 } as const;
export const CLIENT_IDENTITY_KEYS = ["taxCode", "legalName", "shortName", "website", "address", "acquisitionSource", "referredBy", "notes", "parentClientId"] as const;
const TAX_TAKEN = "Mã số thuế đã thuộc khách khác.";

export async function updateClientIdentity(db: PrismaClient, actor: Actor, input: ClientIdentityInput): Promise<Result> {
  if (!input || !validId(input.clientId) || !validVersion(input.expectedVersion) || !CLIENT_IDENTITY_KEYS.some((key) => input[key] !== undefined)) return { error: INVALID };
  const data: Prisma.ClientUncheckedUpdateManyInput = {};
  for (const [key, max] of Object.entries(IDENTITY_TEXT) as [keyof typeof IDENTITY_TEXT, number][]) {
    if (input[key] === undefined) continue;
    if (!validText(input[key], max)) return { error: INVALID };
    data[key] = text(input[key]);
  }
  if (input.taxCode !== undefined) {
    const tax = normalizeTaxCode(input.taxCode);
    if ("error" in tax) return tax;
    data.taxCode = tax.value;
  }
  if (input.website !== undefined) {
    const site = normalizeWebsite(input.website);
    if ("error" in site) return site;
    data.website = site.value;
  }
  if (input.notes !== undefined) {
    if (input.notes !== null && typeof input.notes !== "string") return { error: INVALID };
    const problem = validateClientNotes(input.notes);
    if (problem) return { error: problem };
    data.notes = text(input.notes);
  }
  if (input.parentClientId !== undefined) {
    if (input.parentClientId !== null && !validId(input.parentClientId)) return { error: INVALID };
    data.parentClientId = input.parentClientId;
  }
  try {
    return await db.$transaction(async (tx) => {
      // Hierarchy lock before row locks: two requests cannot each pass the cycle check against a stale tree.
      if (input.parentClientId !== undefined) await lockClientHierarchy(tx);
      const client = await loadLocked(tx, actor, input.clientId, "EDIT");
      if (!client) return { error: DENIED };
      if (client.version !== input.expectedVersion) return { error: STALE };
      if (typeof data.taxCode === "string" && await tx.client.findFirst({ where: { taxCode: data.taxCode, id: { not: client.id } }, select: { id: true } })) return { error: TAX_TAKEN };
      if (typeof data.acquisitionSource === "string" && data.acquisitionSource !== client.acquisitionSource && !await inCatalog(tx, "client.sources", data.acquisitionSource)) return { error: "Chọn nguồn khách trong danh mục." };
      if (typeof data.parentClientId === "string" && data.parentClientId !== client.parentClientId) {
        const parent = await tx.client.findUnique({ where: { id: data.parentClientId }, select: { archivedAt: true } });
        if (!parent) return { error: "Không tìm thấy công ty mẹ." };
        if (parent.archivedAt) return { error: "Khách đang lưu trữ không chọn làm công ty mẹ được." };
        const tree = await tx.client.findMany({ select: { id: true, parentClientId: true } });
        const problem = validateParentChain({ clientId: client.id, parentId: data.parentClientId, parents: new Map(tree.map((row) => [row.id, row.parentClientId])) });
        if (problem) return { error: problem };
      }
      const changed = await tx.client.updateMany({ where: { id: client.id, version: input.expectedVersion }, data: { ...data, version: { increment: 1 } } });
      if (changed.count !== 1) return { error: STALE };
      const before: Record<string, unknown> = { ...client };
      const after: Record<string, unknown> = {};
      for (const key of CLIENT_IDENTITY_KEYS) if (input[key] !== undefined) after[key] = data[key];
      if (after.parentClientId !== undefined && after.parentClientId !== client.parentClientId) {
        before.parentClientId = await nameRef(tx, client.parentClientId);
        after.parentClientId = await nameRef(tx, after.parentClientId as string | null);
      } else delete after.parentClientId;
      await logClientChanges(tx, client.id, actor, diffClientFields(before, after));
      return { ok: true, version: input.expectedVersion + 1 };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: TAX_TAKEN };
    throw error;
  }
}

const ALIAS_TAKEN = "Tên gọi khác đã thuộc khách khác.";
async function aliasNames(tx: Prisma.TransactionClient, clientId: string) {
  return (await tx.clientAlias.findMany({ where: { clientId }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { name: true } })).map((row) => row.name);
}
/** Alias keys are globally unique and may not equal another client's main-name key. */
export async function addClientAlias(db: PrismaClient, actor: Actor, input: { clientId: string; name: string }): Promise<Result> {
  if (!input || !validId(input.clientId) || typeof input.name !== "string") return { error: INVALID };
  const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 160) return { error: "Tên gọi khác không hợp lệ." };
  const key = clientDuplicateKey(name);
  const lockKey = "crm:alias:" + key;
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const client = await loadLocked(tx, actor, input.clientId, "EDIT");
      if (!client) return { error: DENIED };
      const existing = await tx.clientAlias.findUnique({ where: { key }, select: { clientId: true } });
      if (existing) return { error: existing.clientId === client.id ? "Tên gọi khác đã có." : ALIAS_TAKEN };
      const others = await tx.client.findMany({ where: { id: { not: client.id } }, select: { name: true } });
      const clash = others.find((other) => clientDuplicateKey(other.name) === key);
      if (clash) return { error: `Tên gọi khác trùng tên khách ${clash.name}.` };
      const before = await aliasNames(tx, client.id);
      const alias = await tx.clientAlias.create({ data: { clientId: client.id, name, key } });
      await tx.client.update({ where: { id: client.id }, data: { version: { increment: 1 } } });
      await logClientChanges(tx, client.id, actor, diffClientFields({ aliases: before }, { aliases: await aliasNames(tx, client.id) }));
      return { ok: true, version: client.version + 1, id: alias.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: ALIAS_TAKEN };
    throw error;
  }
}

export async function removeClientAlias(db: PrismaClient, actor: Actor, input: { clientId: string; aliasId: string }): Promise<Result> {
  if (!input || !validId(input.clientId) || !validId(input.aliasId)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "EDIT");
    if (!client) return { error: DENIED };
    const before = await aliasNames(tx, client.id);
    const removed = await tx.clientAlias.deleteMany({ where: { id: input.aliasId, clientId: client.id } });
    if (!removed.count) return { error: INVALID };
    await tx.client.update({ where: { id: client.id }, data: { version: { increment: 1 } } });
    await logClientChanges(tx, client.id, actor, diffClientFields({ aliases: before }, { aliases: await aliasNames(tx, client.id) }));
    return { ok: true, version: client.version + 1 };
  });
}

const sortVi = (values: string[]) => [...values].sort((a, b) => a.localeCompare(b, "vi"));
/** Replaces the tag set. Inactive tags already linked may stay; new links need active tags. */
export async function setClientTags(db: PrismaClient, actor: Actor, input: { clientId: string; expectedVersion: number; tagIds: string[] }): Promise<Result> {
  if (!input || !validId(input.clientId) || !validVersion(input.expectedVersion) || !Array.isArray(input.tagIds) || input.tagIds.length > 50 || !input.tagIds.every(validId)) return { error: INVALID };
  const ids = [...new Set(input.tagIds)];
  return db.$transaction(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "EDIT");
    if (!client) return { error: DENIED };
    if (client.version !== input.expectedVersion) return { error: STALE };
    const current = await tx.clientTagLink.findMany({ where: { clientId: client.id }, select: { tagId: true, tag: { select: { label: true } } } });
    const added = ids.filter((id) => !current.some((link) => link.tagId === id));
    if (added.length && await tx.clientTag.count({ where: { id: { in: added }, active: true } }) !== added.length) return { error: "Chọn nhãn đang dùng." };
    await tx.clientTagLink.deleteMany({ where: { clientId: client.id, tagId: { notIn: ids } } });
    if (added.length) await tx.clientTagLink.createMany({ data: added.map((tagId) => ({ clientId: client.id, tagId })) });
    const changed = await tx.client.updateMany({ where: { id: client.id, version: input.expectedVersion }, data: { version: { increment: 1 } } });
    if (changed.count !== 1) return { error: STALE };
    const after = await tx.clientTagLink.findMany({ where: { clientId: client.id }, select: { tag: { select: { label: true } } } });
    await logClientChanges(tx, client.id, actor, diffClientFields({ tags: sortVi(current.map((link) => link.tag.label)) }, { tags: sortVi(after.map((link) => link.tag.label)) }));
    return { ok: true, version: input.expectedVersion + 1 };
  });
}

async function competitorNames(tx: Prisma.TransactionClient, clientId: string) {
  return sortVi((await tx.clientCompetitor.findMany({ where: { clientId }, select: { competitor: { select: { name: true } } } })).map((row) => row.competitor.name));
}
/** Agency currently serving the client. Adding needs an active catalog item; editing an existing link keeps it. */
export async function saveClientCompetitor(db: PrismaClient, actor: Actor, input: { clientId: string; competitorId: string; note?: string | null; since?: Date | null }): Promise<Result> {
  if (!input || !validId(input.clientId) || !validId(input.competitorId) || !validText(input.note) || (input.since !== undefined && input.since !== null && !(input.since instanceof Date && Number.isFinite(input.since.getTime())))) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "EDIT");
    if (!client) return { error: DENIED };
    const where = { clientId_competitorId: { clientId: client.id, competitorId: input.competitorId } };
    const existing = await tx.clientCompetitor.findUnique({ where, select: { id: true } });
    if (!existing && !await tx.competitor.findFirst({ where: { id: input.competitorId, active: true }, select: { id: true } })) return { error: "Chọn agency đang dùng." };
    const before = await competitorNames(tx, client.id);
    const note = input.note === undefined ? undefined : text(input.note);
    await tx.clientCompetitor.upsert({ where, create: { clientId: client.id, competitorId: input.competitorId, note: note ?? null, since: input.since ?? null }, update: { note, since: input.since } });
    await tx.client.update({ where: { id: client.id }, data: { version: { increment: 1 } } });
    await logClientChanges(tx, client.id, actor, diffClientFields({ competitors: before }, { competitors: await competitorNames(tx, client.id) }));
    return { ok: true, version: client.version + 1 };
  });
}

export async function removeClientCompetitor(db: PrismaClient, actor: Actor, input: { clientId: string; competitorId: string }): Promise<Result> {
  if (!input || !validId(input.clientId) || !validId(input.competitorId)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "EDIT");
    if (!client) return { error: DENIED };
    const before = await competitorNames(tx, client.id);
    const removed = await tx.clientCompetitor.deleteMany({ where: { clientId: client.id, competitorId: input.competitorId } });
    if (!removed.count) return { error: INVALID };
    await tx.client.update({ where: { id: client.id }, data: { version: { increment: 1 } } });
    await logClientChanges(tx, client.id, actor, diffClientFields({ competitors: before }, { competitors: await competitorNames(tx, client.id) }));
    return { ok: true, version: client.version + 1 };
  });
}

/** Agencies bidding on an open Opportunity. Winner flags on kept rows are preserved. */
export async function setOpportunityCompetitors(db: PrismaClient, actor: Actor, input: { opportunityId: string; competitorIds: string[] }): Promise<{ ok: true } | { error: string }> {
  if (!input || !validId(input.opportunityId) || !Array.isArray(input.competitorIds) || input.competitorIds.length > 30 || !input.competitorIds.every(validId)) return { error: INVALID };
  const ids = [...new Set(input.competitorIds)];
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Opportunity" WHERE id = ${input.opportunityId} FOR UPDATE`;
    const resource = await loadOpportunityResource(tx, input.opportunityId);
    if (!resource || !crmCan(actor, "EDIT", resource)) return { error: DENIED };
    const current = await tx.opportunityCompetitor.findMany({ where: { opportunityId: input.opportunityId }, select: { competitorId: true } });
    const added = ids.filter((id) => !current.some((row) => row.competitorId === id));
    if (added.length && await tx.competitor.count({ where: { id: { in: added }, active: true } }) !== added.length) return { error: "Chọn agency đang dùng." };
    await tx.opportunityCompetitor.deleteMany({ where: { opportunityId: input.opportunityId, competitorId: { notIn: ids } } });
    if (added.length) await tx.opportunityCompetitor.createMany({ data: added.map((competitorId) => ({ opportunityId: input.opportunityId, competitorId })) });
    return { ok: true as const };
  });
}

/** Archive keeps every relation and history row; the client leaves Review and new reminders until restored. */
export async function archiveClient(db: PrismaClient, actor: Actor, input: { clientId: string; expectedVersion: number; reason?: string | null }): Promise<Result> {
  if (!input || !validId(input.clientId) || !validVersion(input.expectedVersion) || !validText(input.reason)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "ARCHIVE_CLIENT");
    if (!client) return { error: DENIED };
    if (client.version !== input.expectedVersion) return { error: STALE };
    if (client.archivedAt) return { error: "Khách đã được lưu trữ." };
    const reason = text(input.reason);
    const changed = await tx.client.updateMany({ where: { id: client.id, version: input.expectedVersion }, data: { archivedAt: new Date(), archivedReason: reason, archivedById: actor.id, version: { increment: 1 } } });
    if (changed.count !== 1) return { error: STALE };
    await logClientChanges(tx, client.id, actor, [{ field: "archived", oldValue: null, newValue: { reason } }]);
    return { ok: true, version: input.expectedVersion + 1 };
  });
}

export async function restoreClient(db: PrismaClient, actor: Actor, input: { clientId: string; expectedVersion: number }): Promise<Result> {
  if (!input || !validId(input.clientId) || !validVersion(input.expectedVersion)) return { error: INVALID };
  return db.$transaction(async (tx) => {
    const client = await loadLocked(tx, actor, input.clientId, "ARCHIVE_CLIENT");
    if (!client) return { error: DENIED };
    if (client.version !== input.expectedVersion) return { error: STALE };
    if (!client.archivedAt) return { error: "Khách không ở trạng thái lưu trữ." };
    const changed = await tx.client.updateMany({ where: { id: client.id, version: input.expectedVersion }, data: { archivedAt: null, archivedReason: null, archivedById: null, version: { increment: 1 } } });
    if (changed.count !== 1) return { error: STALE };
    await logClientChanges(tx, client.id, actor, [{ field: "archived", oldValue: { reason: client.archivedReason }, newValue: null }]);
    return { ok: true, version: input.expectedVersion + 1 };
  });
}

// ---- crm51: Thêm khách 3 bước (sketch 006 screen 3). One transaction, no external tax-code lookup. ----
export type DuplicateMatch = { id: string; name: string; reason: "TAX_CODE" | "NAME" | "ALIAS"; exact: boolean; picName: string | null; projectCount: number; archived: boolean };
export type NewClientInput = {
  name: string; taxCode?: string | null; teamName?: string | null;
  industry?: string | null; parentClientId?: string | null; acquisitionSource?: string | null; referredBy?: string | null;
  potentialLevel?: string | null; picAccountId?: string | null; responsibleTeamId?: string | null; tagIds?: string[];
  next?: { title: string; assigneeId: string; dueDate: Date } | null;
  /** Set after the user saw similar-name warnings and chose "Vẫn tạo mới". Exact duplicates stay blocked. */
  allowSimilar?: boolean;
};
export type CreateClientResult = { ok: true; id: string; name: string } | { error: string; field?: string; duplicates?: DuplicateMatch[] };
const NAME_TAKEN = "Khách này đã có trong CRM.";
const SIMILAR = "Có khách tên gần giống. Mở khách đó hoặc chọn Vẫn tạo mới.";

/** Read-only duplicate check by tax code, team name/alias and name. Exact = would be rejected on create. */
export async function findClientDuplicates(db: PrismaClient | Prisma.TransactionClient, input: { name?: string | null; taxCode?: string | null; teamName?: string | null }): Promise<DuplicateMatch[]> {
  const names = [input.name, input.teamName].map((value) => normalizeClientName(value ?? "")).filter((value) => value.length >= 2 && value.length <= CLIENT_NAME_MAX_LENGTH);
  const tax = normalizeTaxCode(input.taxCode ?? null);
  const taxCode = "ok" in tax ? tax.value : null;
  if (!names.length && !taxCode) return [];
  const keys = new Set(names.map(clientDuplicateKey));
  const exactKeys = new Set(names.map(clientNameKey));
  const teamName = normalizeClientName(input.teamName ?? "");
  const mainName = normalizeClientName(input.name ?? "");
  const teamKey = teamName.length >= 2 && clientDuplicateKey(teamName) !== clientDuplicateKey(mainName) ? clientDuplicateKey(teamName) : null;
  const [clients, aliases] = await Promise.all([
    db.client.findMany({ select: { id: true, name: true, taxCode: true, archivedAt: true, picAccount: { select: { name: true } }, _count: { select: { projects: true } } } }),
    db.clientAlias.findMany({ where: { key: { in: [...keys] } }, select: { clientId: true } }),
  ]);
  const aliasIds = new Set(aliases.map((alias) => alias.clientId));
  const out: DuplicateMatch[] = [];
  for (const c of clients) {
    const reason = taxCode && c.taxCode === taxCode ? "TAX_CODE" : aliasIds.has(c.id) ? "ALIAS" : keys.has(clientDuplicateKey(c.name)) ? "NAME" : null;
    if (!reason) continue;
    // Exact = the create would be rejected: same tax code, alias, case-insensitive name, or team name equal to this client's name key.
    const exact = reason === "TAX_CODE" || reason === "ALIAS" || exactKeys.has(clientNameKey(c.name)) || (teamKey !== null && clientDuplicateKey(c.name) === teamKey);
    out.push({ id: c.id, name: c.name, reason, exact, picName: c.picAccount?.name ?? null, projectCount: c._count.projects, archived: !!c.archivedAt });
  }
  const rank = { TAX_CODE: 0, ALIAS: 1, NAME: 2 };
  return out.sort((a, b) => rank[a.reason] - rank[b.reason] || Number(b.exact) - Number(a.exact) || a.name.localeCompare(b.name, "vi")).slice(0, 5);
}

/** PIC and team set at creation follow the same rule as changing them later; picking yourself is always allowed. */
function canAssignAtCreate(actor: Actor, pic: { userId: string | null; teamId: string } | null, accountId: string | null, teamId: string | null) {
  if (actor.role === "ADMIN") return true;
  const resource: CrmOwnerResource = { kind: "CLIENT", picUserId: pic?.userId ?? null, teamId: teamId ?? pic?.teamId ?? null };
  if (crmCan(actor, "CHANGE_PIC_OR_TEAM", resource)) return true;
  const self = !!accountId && accountId === actor.accountId;
  return self && (teamId === null || teamId === pic?.teamId);
}

export async function createClientWithProfile(db: PrismaClient, actor: Actor, input: NewClientInput, effects?: Effects): Promise<CreateClientResult> {
  if (!canCreateClient(actor.role)) return { error: "Chỉ Admin hoặc Account được tạo khách mới." };
  if (!input || typeof input.name !== "string") return { error: INVALID };
  const name = normalizeClientName(input.name);
  const nameError = clientNameError(name);
  if (nameError) return { error: nameError.replace("Client", "khách"), field: "name" };
  const tax = normalizeTaxCode(input.taxCode ?? null);
  if ("error" in tax) return { error: tax.error, field: "taxCode" };
  const teamName = input.teamName ? normalizeClientName(input.teamName) : null;
  if (teamName && teamName.length > 160) return { error: "Tên gọi khác không hợp lệ.", field: "teamName" };
  for (const [key, max] of [["industry", 120], ["acquisitionSource", 80], ["referredBy", 200]] as const) if (!validText(input[key], max)) return { error: INVALID, field: key };
  for (const key of ["parentClientId", "picAccountId", "responsibleTeamId"] as const) if (input[key] != null && !validId(input[key])) return { error: INVALID, field: key };
  if (input.potentialLevel != null && (typeof input.potentialLevel !== "string" || input.potentialLevel.length > 64)) return { error: INVALID, field: "potentialLevel" };
  const tagIds = [...new Set(input.tagIds ?? [])];
  if (tagIds.length > 50 || !tagIds.every(validId)) return { error: INVALID, field: "tagIds" };
  const next = input.next ?? null;
  if (next && (typeof next.title !== "string" || !next.title.trim() || next.title.trim().length > 200 || !validId(next.assigneeId) || !(next.dueDate instanceof Date) || !Number.isFinite(next.dueDate.getTime()))) return { error: "Nhập việc tiếp theo, người làm và hạn.", field: "next" };
  const nameKey = clientDuplicateKey(name);
  const aliasKey = teamName && clientDuplicateKey(teamName) !== nameKey ? clientDuplicateKey(teamName) : null;
  try {
    const result = await db.$transaction(async (tx): Promise<CreateClientResult & { notifyUserId?: string | null }> => {
      // Same advisory keys as addClientAlias, so a parallel alias or client with this key waits for us.
      for (const key of [nameKey, aliasKey].filter((k): k is string => !!k).sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"crm:alias:" + key}))`;
      if (tax.value) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"crm:tax:" + tax.value}))`;
      const duplicates = await findClientDuplicates(tx, { name, taxCode: tax.value, teamName });
      const taxHit = duplicates.find((d) => d.reason === "TAX_CODE");
      if (taxHit) return { error: TAX_TAKEN, field: "taxCode", duplicates };
      const exactName = (await tx.client.findMany({ select: { id: true, name: true } })).find((c) => clientNameKey(c.name) === clientNameKey(name));
      if (exactName) return { error: NAME_TAKEN, field: "name", duplicates };
      if (await tx.clientAlias.findUnique({ where: { key: nameKey }, select: { id: true } })) return { error: NAME_TAKEN, field: "name", duplicates };
      if (aliasKey && (await tx.clientAlias.findUnique({ where: { key: aliasKey }, select: { id: true } }) || duplicates.some((d) => d.reason === "NAME" && clientDuplicateKey(d.name) === aliasKey))) return { error: ALIAS_TAKEN, field: "teamName", duplicates };
      if (duplicates.length && !input.allowSimilar) return { error: SIMILAR, field: "name", duplicates };

      const [pic, team] = await Promise.all([
        input.picAccountId ? tx.account.findUnique({ where: { id: input.picAccountId }, select: { id: true, name: true, userId: true, teamId: true, user: { select: { isActive: true, deletedAt: true } } } }) : null,
        input.responsibleTeamId ? tx.salesTeam.findUnique({ where: { id: input.responsibleTeamId }, select: { id: true, name: true } }) : null,
      ]);
      if ((input.picAccountId && (!pic || (pic.user && (!pic.user.isActive || pic.user.deletedAt)))) || (input.responsibleTeamId && !team)) return { error: INVALID, field: "picAccountId" };
      if ((input.picAccountId || input.responsibleTeamId) && !canAssignAtCreate(actor, pic, input.picAccountId ?? null, input.responsibleTeamId ?? null)) return { error: DENIED, field: "picAccountId" };
      const resource: CrmOwnerResource = { kind: "CLIENT", picUserId: pic?.userId ?? null, teamId: input.responsibleTeamId ?? pic?.teamId ?? null };
      if (input.potentialLevel) {
        if (!crmCan(actor, "SCORE_POTENTIAL", resource)) return { error: DENIED, field: "potentialLevel" };
        const setting = await tx.crmSetting.findUnique({ where: { key: "tier.potentialScale" }, select: { value: true } });
        if (!parsePotentialScale(setting?.value)?.some((level) => level.key === input.potentialLevel)) return { error: "Hãy chọn mức tiềm năng đã cấu hình.", field: "potentialLevel" };
      }
      const industry = text(input.industry), source = text(input.acquisitionSource);
      if (industry && !await inCatalog(tx, "client.industries", industry)) return { error: "Chọn ngành trong danh mục.", field: "industry" };
      if (source && !await inCatalog(tx, "client.sources", source)) return { error: "Chọn nguồn khách trong danh mục.", field: "acquisitionSource" };
      const parent = input.parentClientId ? await tx.client.findUnique({ where: { id: input.parentClientId }, select: { id: true, name: true, archivedAt: true } }) : null;
      if (input.parentClientId && !parent) return { error: "Không tìm thấy công ty mẹ.", field: "parentClientId" };
      if (parent?.archivedAt) return { error: "Khách đang lưu trữ không chọn làm công ty mẹ được.", field: "parentClientId" };
      const tags = tagIds.length ? await tx.clientTag.findMany({ where: { id: { in: tagIds }, active: true }, select: { id: true, label: true } }) : [];
      if (tags.length !== tagIds.length) return { error: "Chọn nhãn đang dùng.", field: "tagIds" };
      if (next && !await tx.user.findFirst({ where: { id: next.assigneeId, isActive: true, deletedAt: null }, select: { id: true } })) return { error: "Chọn người làm đang hoạt động.", field: "next" };
      if (next && await crmDeniedForUser(tx, { id: next.assigneeId })) return { error: "Người này chưa được mở CRM.", field: "next" };

      const now = new Date();
      const client = await tx.client.create({ data: {
        name, taxCode: tax.value, industry, acquisitionSource: source, referredBy: text(input.referredBy), parentClientId: parent?.id ?? null,
        picAccountId: pic?.id ?? null, responsibleTeamId: team?.id ?? null,
        ...(input.potentialLevel ? { potentialLevel: input.potentialLevel, potentialScoredById: actor.id, potentialScoredAt: now } : {}),
      }, select: { id: true, name: true } });
      if (teamName && aliasKey) await tx.clientAlias.create({ data: { clientId: client.id, name: teamName, key: aliasKey } });
      if (tags.length) await tx.clientTagLink.createMany({ data: tags.map((tag) => ({ clientId: client.id, tagId: tag.id })) });
      if (input.potentialLevel) await tx.clientPotentialScore.create({ data: { clientId: client.id, level: input.potentialLevel, scoredById: actor.id, scoredByName: actor.name, createdAt: now } });
      await logClientChanges(tx, client.id, actor, diffClientFields({}, {
        taxCode: tax.value ?? undefined, industry: industry ?? undefined, acquisitionSource: source ?? undefined, referredBy: text(input.referredBy) ?? undefined,
        parentClientId: parent ? { id: parent.id, name: parent.name } : undefined, picAccountId: pic ? { id: pic.id, name: pic.name } : undefined,
        responsibleTeamId: team ? { id: team.id, name: team.name } : undefined, potentialLevel: input.potentialLevel ?? undefined,
        aliases: teamName && aliasKey ? [teamName] : undefined, tags: tags.length ? sortVi(tags.map((tag) => tag.label)) : undefined,
      }));
      if (next) await tx.task.create({ data: { title: next.title.trim(), dueDate: next.dueDate, assigneeId: next.assigneeId, creatorId: actor.id, clientId: client.id, status: "TODO", crmKind: "NEXT_STEP" } });
      return { ok: true, id: client.id, name: client.name, notifyUserId: pic?.userId && pic.userId !== actor.id ? pic.userId : null };
    });
    if (!("ok" in result)) return result;
    if (result.notifyUserId) {
      try {
        const notify = effects?.notify ?? (await import("../notify")).notify;
        await notify([result.notifyUserId], { type: "CRM_PIC_ASSIGNED", message: `Bạn được giao phụ trách ${result.name}.`, clientId: result.id });
      } catch { console.warn("CRM PIC assignment notification could not be delivered."); }
    }
    return { ok: true, id: result.id, name: result.name };
  } catch (error) {
    // Unique name, tax code or alias won by a parallel request: report the existing client instead of failing.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: NAME_TAKEN, field: "name", duplicates: await findClientDuplicates(db, { name, taxCode: tax.value, teamName }) };
    throw error;
  }
}

/** Options for the wizard; PIC/team/potential choices are trimmed to what the actor may set (server re-checks). */
export async function loadNewClientWizardOptions(db: PrismaClient, actor: CrmActor, settings: { potentialScale: { key: string; label: string }[]; industries: { label: string; active: boolean }[]; sources: { label: string; active: boolean }[] }) {
  const [accounts, teams, tags, users, parents] = await Promise.all([
    db.account.findMany({ where: { OR: [{ userId: null }, { user: { isActive: true, deletedAt: null } }] }, select: { id: true, name: true, userId: true, teamId: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    db.salesTeam.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    db.clientTag.findMany({ where: { active: true }, select: { id: true, label: true }, orderBy: [{ order: "asc" }, { label: "asc" }] }),
    db.user.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true, email: true, avatarUrl: true }, orderBy: { name: "asc" } }),
    db.client.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
  ]);
  const admin = actor.role === "ADMIN";
  const own = accounts.find((a) => a.id === actor.accountId) ?? null;
  return {
    picAccounts: accounts.filter((a) => admin || a.id === actor.accountId || actor.managedTeamIds.includes(a.teamId)).map((a) => ({ id: a.id, name: a.name, teamId: a.teamId, userId: a.userId })),
    teams: teams.filter((t) => admin || actor.managedTeamIds.includes(t.id) || t.id === own?.teamId),
    canScore: admin || actor.managedTeamIds.length > 0,
    potentialScale: settings.potentialScale.map((p) => ({ key: p.key, label: p.label })),
    industries: settings.industries.filter((i) => i.active).map((i) => i.label),
    sources: settings.sources.filter((s) => s.active).map((s) => s.label),
    tags, users, parents,
    defaults: { picAccountId: own?.id ?? null, teamId: own?.teamId ?? null, assigneeId: actor.id },
  };
}
export type NewClientWizardOptions = Awaited<ReturnType<typeof loadNewClientWizardOptions>>;
