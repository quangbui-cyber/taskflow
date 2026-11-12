"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CRM_DISABLED_MESSAGE } from "@/lib/features";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { updateClientProfile, changeClientPicOrTeam, saveBuyingUnit, scorePotential, confirmImportedClient, updateClientIdentity, addClientAlias, removeClientAlias, setClientTags, saveClientCompetitor, removeClientCompetitor, archiveClient, restoreClient, CLIENT_IDENTITY_KEYS, createClientWithProfile, findClientDuplicates, type ClientIdentityInput } from "@/lib/crm/clientService";
import { canCreateClient } from "@/lib/clientCatalog";
import { parseVnDateKey } from "@/lib/crm/opportunityInput";
import { getCrmSettings } from "@/lib/crm/settings";
import { loadClientRevenue24m } from "@/lib/crm/clientData";
import { computeTier, revenueBandFor, revenuePercentiles } from "@/lib/crm/tier";
import { crmViewCookieName, crmViewCookieValue, isCrmView } from "@/lib/crm/viewPreference";

const INVALID = "Thông tin khách hàng không hợp lệ.";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.length <= 64;
const version = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const optionalText = (value: unknown): value is string | null | undefined => value === null || value === undefined || typeof value === "string";
function refresh(clientId: string) {
  revalidatePath("/crm/clients");
  revalidatePath(`/crm/clients/${clientId}`);
  revalidatePath("/crm");
}

export async function updateClientProfileAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId) || !version(raw.expectedVersion) || !optionalText(raw.industry) || !optionalText(raw.budgetSeason) || !optionalText(raw.vendorSelection) || !optionalText(raw.valuedMost) || (raw.budgetSeasonMonth !== undefined && raw.budgetSeasonMonth !== null && typeof raw.budgetSeasonMonth !== "number")) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await updateClientProfile(prisma, actor, { clientId: raw.clientId, expectedVersion: raw.expectedVersion, industry: raw.industry, budgetSeason: raw.budgetSeason, budgetSeasonMonth: raw.budgetSeasonMonth as number | null | undefined, vendorSelection: raw.vendorSelection, valuedMost: raw.valuedMost });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã lưu thông tin khách hàng.", version: result.version };
}

export async function changeClientPicOrTeamAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId) || !id(raw.picAccountId) || !version(raw.expectedVersion) || (raw.responsibleTeamId !== null && !id(raw.responsibleTeamId))) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await changeClientPicOrTeam(prisma, actor, { clientId: raw.clientId, expectedVersion: raw.expectedVersion, picAccountId: raw.picAccountId, responsibleTeamId: raw.responsibleTeamId as string | null });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã đổi PIC hoặc team.", version: result.version };
}

export async function saveBuyingUnitAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId) || (raw.id !== undefined && !id(raw.id)) || typeof raw.name !== "string" || typeof raw.active !== "boolean") return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await saveBuyingUnit(prisma, actor, { clientId: raw.clientId, id: raw.id as string | undefined, name: raw.name, active: raw.active });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã lưu đơn vị mua.", id: result.id, version: result.version };
}

export async function scorePotentialAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId) || typeof raw.level !== "string" || !optionalText(raw.note)) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await scorePotential(prisma, actor, { clientId: raw.clientId, level: raw.level, note: raw.note });
  if ("error" in result) return result;
  const [settings, revenue, client] = await Promise.all([
    getCrmSettings(prisma), loadClientRevenue24m(prisma, new Date()),
    prisma.client.findUnique({ where: { id: raw.clientId }, select: { potentialLevel: true } }),
  ]);
  const band = revenueBandFor(revenuePercentiles(revenue).get(raw.clientId) ?? null, settings.tierMatrix.revenueBands);
  const { tier } = computeTier({ potentialLevel: client?.potentialLevel ?? null, revenueBand: band?.key ?? null, matrix: settings.tierMatrix, scale: settings.potentialScale });
  refresh(raw.clientId);
  return { success: tier === "UNRATED" ? "Đã lưu tiềm năng." : `Đã xếp hạng ${tier}.`, version: result.version };
}

export async function confirmImportedClientAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId)) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await confirmImportedClient(prisma, actor, { clientId: raw.clientId });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã xác nhận khách của bạn.", version: result.version };
}

// ---- crm50 ----
async function actorFor() {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return null;
  return { ...await loadCrmActor(user), name: user.name };
}
const disabled = { error: CRM_DISABLED_MESSAGE };

export async function updateClientIdentityAction(raw: unknown) {
  const actor = await actorFor(); if (!actor) return disabled;
  if (!record(raw) || !id(raw.clientId) || !version(raw.expectedVersion)) return { error: INVALID };
  const input: ClientIdentityInput = { clientId: raw.clientId, expectedVersion: raw.expectedVersion };
  for (const key of CLIENT_IDENTITY_KEYS) {
    if (raw[key] === undefined) continue;
    if (!optionalText(raw[key])) return { error: INVALID };
    input[key] = raw[key] as string | null;
  }
  const result = await updateClientIdentity(prisma, actor, input);
  if ("error" in result) return result;
  refresh(raw.clientId);
  if (typeof raw.parentClientId === "string") revalidatePath(`/crm/clients/${raw.parentClientId}`);
  return { success: "Đã lưu thông tin công ty.", version: result.version };
}

export async function addClientAliasAction(raw: unknown) {
  const actor = await actorFor(); if (!actor) return disabled;
  if (!record(raw) || !id(raw.clientId) || typeof raw.name !== "string") return { error: INVALID };
  const result = await addClientAlias(prisma, actor, { clientId: raw.clientId, name: raw.name });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã thêm tên gọi khác.", version: result.version };
}

export async function removeClientAliasAction(raw: unknown) {
  const actor = await actorFor(); if (!actor) return disabled;
  if (!record(raw) || !id(raw.clientId) || !id(raw.aliasId)) return { error: INVALID };
  const result = await removeClientAlias(prisma, actor, { clientId: raw.clientId, aliasId: raw.aliasId });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã bỏ tên gọi khác.", version: result.version };
}

export async function setClientTagsAction(raw: unknown) {
  const actor = await actorFor(); if (!actor) return disabled;
  if (!record(raw) || !id(raw.clientId) || !version(raw.expectedVersion) || !Array.isArray(raw.tagIds) || !raw.tagIds.every(id)) return { error: INVALID };
  const result = await setClientTags(prisma, actor, { clientId: raw.clientId, expectedVersion: raw.expectedVersion, tagIds: raw.tagIds });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã lưu nhãn.", version: result.version };
}

export async function saveClientCompetitorAction(raw: unknown) {
  const actor = await actorFor(); if (!actor) return disabled;
  if (!record(raw) || !id(raw.clientId) || !id(raw.competitorId) || !optionalText(raw.note) || !optionalText(raw.since)) return { error: INVALID };
  const since = typeof raw.since === "string" && raw.since ? parseVnDateKey(raw.since) : null;
  if (typeof raw.since === "string" && raw.since && !since) return { error: INVALID };
  const result = await saveClientCompetitor(prisma, actor, { clientId: raw.clientId, competitorId: raw.competitorId, note: raw.note as string | null | undefined, since });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã lưu agency.", version: result.version };
}

export async function removeClientCompetitorAction(raw: unknown) {
  const actor = await actorFor(); if (!actor) return disabled;
  if (!record(raw) || !id(raw.clientId) || !id(raw.competitorId)) return { error: INVALID };
  const result = await removeClientCompetitor(prisma, actor, { clientId: raw.clientId, competitorId: raw.competitorId });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã bỏ agency.", version: result.version };
}

export async function archiveClientAction(raw: unknown) {
  const actor = await actorFor(); if (!actor) return disabled;
  if (!record(raw) || !id(raw.clientId) || !version(raw.expectedVersion) || !optionalText(raw.reason)) return { error: INVALID };
  const result = await archiveClient(prisma, actor, { clientId: raw.clientId, expectedVersion: raw.expectedVersion, reason: raw.reason as string | null | undefined });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã lưu trữ khách.", version: result.version };
}

export async function restoreClientAction(raw: unknown) {
  const actor = await actorFor(); if (!actor) return disabled;
  if (!record(raw) || !id(raw.clientId) || !version(raw.expectedVersion)) return { error: INVALID };
  const result = await restoreClient(prisma, actor, { clientId: raw.clientId, expectedVersion: raw.expectedVersion });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã khôi phục khách.", version: result.version };
}

// ---- crm51: view choice per user, kept in a cookie; nothing is written to the database ----
export async function saveCrmViewPreferenceAction(page: unknown, view: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return disabled;
  if ((page !== "clients" && page !== "opportunities") || !isCrmView(page, view)) return { error: INVALID };
  (await cookies()).set(crmViewCookieName(page), crmViewCookieValue(user.id, view), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/crm", maxAge: 60 * 60 * 24 * 365 });
  return { success: "ok" };
}

// ---- crm51: Thêm khách 3 bước ----
const DUPLICATE_CHECKS_PER_MINUTE = 40;
const duplicateChecks = new Map<string, number[]>();
/** In-memory, per user and per server instance; enough to stop a runaway typing loop, not a security boundary. */
function allowDuplicateCheck(userId: string, now = Date.now()): boolean {
  const recent = (duplicateChecks.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= DUPLICATE_CHECKS_PER_MINUTE) { duplicateChecks.set(userId, recent); return false; }
  recent.push(now); duplicateChecks.set(userId, recent);
  if (duplicateChecks.size > 5000) duplicateChecks.clear();
  return true;
}

/** Read-only: tax code, team name (alias) and name matches while the user types. */
export async function checkClientDuplicatesAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return disabled;
  if (!canCreateClient(user.role)) return { duplicates: [] };
  if (!record(raw) || !optionalText(raw.name) || !optionalText(raw.taxCode) || !optionalText(raw.teamName)) return { error: INVALID };
  if ([raw.name, raw.taxCode, raw.teamName].some((v) => typeof v === "string" && v.length > 200)) return { error: INVALID };
  if (!allowDuplicateCheck(user.id)) return { error: "Kiểm tra trùng quá nhanh. Đợi một chút rồi thử lại.", limited: true };
  return { duplicates: await findClientDuplicates(prisma, { name: raw.name as string | null, taxCode: raw.taxCode as string | null, teamName: raw.teamName as string | null }) };
}

export async function createClientWizardAction(raw: unknown) {
  const actor = await actorFor(); if (!actor) return disabled;
  if (!record(raw) || typeof raw.name !== "string") return { error: INVALID };
  for (const key of ["taxCode", "teamName", "industry", "parentClientId", "acquisitionSource", "referredBy", "potentialLevel", "picAccountId", "responsibleTeamId"]) if (!optionalText(raw[key])) return { error: INVALID };
  if (raw.tagIds !== undefined && (!Array.isArray(raw.tagIds) || !raw.tagIds.every(id))) return { error: INVALID };
  let next: { title: string; assigneeId: string; dueDate: Date } | null = null;
  if (raw.next != null) {
    if (!record(raw.next) || typeof raw.next.title !== "string" || !id(raw.next.assigneeId) || typeof raw.next.dueDate !== "string") return { error: "Nhập việc tiếp theo, người làm và hạn.", field: "next" };
    const dueDate = parseVnDateKey(raw.next.dueDate);
    if (!dueDate) return { error: "Nhập việc tiếp theo, người làm và hạn.", field: "next" };
    next = { title: raw.next.title, assigneeId: raw.next.assigneeId, dueDate };
  }
  const empty = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
  const result = await createClientWithProfile(prisma, actor, {
    name: raw.name, taxCode: empty(raw.taxCode), teamName: empty(raw.teamName), industry: empty(raw.industry), parentClientId: empty(raw.parentClientId),
    acquisitionSource: empty(raw.acquisitionSource), referredBy: empty(raw.referredBy), potentialLevel: empty(raw.potentialLevel),
    picAccountId: empty(raw.picAccountId), responsibleTeamId: empty(raw.responsibleTeamId), tagIds: (raw.tagIds as string[] | undefined) ?? [], next, allowSimilar: raw.allowSimilar === true,
  });
  if (!("ok" in result)) return result;
  refresh(result.id);
  revalidatePath("/projects/new");
  return { success: `Đã tạo khách ${result.name}.`, id: result.id };
}
