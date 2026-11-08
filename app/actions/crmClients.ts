"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled, CRM_DISABLED_MESSAGE } from "@/lib/features";
import { loadCrmActor } from "@/lib/crm/actor";
import { updateClientProfile, changeClientPicOrTeam, saveBuyingUnit, scorePotential, confirmImportedClient } from "@/lib/crm/clientService";
import { getCrmSettings } from "@/lib/crm/settings";
import { loadClientRevenue24m } from "@/lib/crm/clientData";
import { computeTier, revenueBandFor, revenuePercentiles } from "@/lib/crm/tier";

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
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId) || !version(raw.expectedVersion) || !optionalText(raw.industry) || !optionalText(raw.budgetSeason) || !optionalText(raw.vendorSelection) || !optionalText(raw.valuedMost) || (raw.budgetSeasonMonth !== undefined && raw.budgetSeasonMonth !== null && typeof raw.budgetSeasonMonth !== "number")) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await updateClientProfile(prisma, actor, { clientId: raw.clientId, expectedVersion: raw.expectedVersion, industry: raw.industry, budgetSeason: raw.budgetSeason, budgetSeasonMonth: raw.budgetSeasonMonth as number | null | undefined, vendorSelection: raw.vendorSelection, valuedMost: raw.valuedMost });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã lưu thông tin khách hàng.", version: result.version };
}

export async function changeClientPicOrTeamAction(raw: unknown) {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId) || !id(raw.picAccountId) || !version(raw.expectedVersion) || (raw.responsibleTeamId !== null && !id(raw.responsibleTeamId))) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await changeClientPicOrTeam(prisma, actor, { clientId: raw.clientId, expectedVersion: raw.expectedVersion, picAccountId: raw.picAccountId, responsibleTeamId: raw.responsibleTeamId as string | null });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã đổi PIC hoặc team.", version: result.version };
}

export async function saveBuyingUnitAction(raw: unknown) {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId) || (raw.id !== undefined && !id(raw.id)) || typeof raw.name !== "string" || typeof raw.active !== "boolean") return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await saveBuyingUnit(prisma, actor, { clientId: raw.clientId, id: raw.id as string | undefined, name: raw.name, active: raw.active });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã lưu đơn vị mua.", id: result.id, version: result.version };
}

export async function scorePotentialAction(raw: unknown) {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
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
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId)) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await confirmImportedClient(prisma, actor, { clientId: raw.clientId });
  if ("error" in result) return result;
  refresh(raw.clientId);
  return { success: "Đã xác nhận khách của bạn.", version: result.version };
}
