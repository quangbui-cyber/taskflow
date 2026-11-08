"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { crmEnabled, CRM_DISABLED_MESSAGE } from "@/lib/features";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { CRM_SETTING_KEYS, saveCrmSetting, saveReason, saveProgramType, setTeamManagers, setCrmDataStewards, type CrmSettingKey } from "@/lib/crm/settings";
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const INVALID = "Cấu hình không hợp lệ.";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const idsValid = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every((id) => typeof id === "string" && !!id && id.length <= 64);
function saved() {
  revalidatePath("/admin");
  revalidatePath("/crm", "layout");
  return { success: "Đã lưu cấu hình." };
}

export async function saveCrmSettingAction(key: unknown, value: unknown, expectedVersion: unknown) {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "CONFIGURE")) return { error: DENIED };
  if (typeof key !== "string" || !CRM_SETTING_KEYS.includes(key as CrmSettingKey) || typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 0) return { error: INVALID };
  const result = await saveCrmSetting(prisma, { key: key as CrmSettingKey, value, expectedVersion, actor: user });
  return "error" in result ? result : saved();
}
export async function saveReasonAction(input: unknown) {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "CONFIGURE")) return { error: DENIED };
  if (!record(input) || (input.id !== undefined && (typeof input.id !== "string" || !input.id || input.id.length > 64)) || typeof input.group !== "string" || typeof input.label !== "string" || typeof input.requiresNote !== "boolean" || typeof input.active !== "boolean" || typeof input.order !== "number" || !Number.isSafeInteger(input.order)) return { error: INVALID };
  const result = await saveReason(prisma, { id: input.id as string | undefined, group: input.group, label: input.label, requiresNote: input.requiresNote, active: input.active, order: input.order }, user);
  return "error" in result ? result : saved();
}
export async function saveProgramTypeAction(input: unknown) {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "CONFIGURE")) return { error: DENIED };
  if (!record(input) || typeof input.code !== "string" || typeof input.label !== "string" || typeof input.color !== "string" || typeof input.active !== "boolean" || typeof input.order !== "number" || !Number.isSafeInteger(input.order)) return { error: INVALID };
  const result = await saveProgramType(prisma, { code: input.code, label: input.label, color: input.color, active: input.active, order: input.order }, user);
  return "error" in result ? result : saved();
}
export async function setTeamManagersAction(teamId: unknown, userIds: unknown) {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "CONFIGURE")) return { error: DENIED };
  if (typeof teamId !== "string" || !teamId || teamId.length > 64 || !idsValid(userIds)) return { error: INVALID };
  const result = await setTeamManagers(prisma, teamId, userIds, user);
  return "error" in result ? result : saved();
}
export async function setCrmDataStewardsAction(userIds: unknown) {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "CONFIGURE")) return { error: DENIED };
  if (!idsValid(userIds)) return { error: INVALID };
  const result = await setCrmDataStewards(prisma, userIds, user);
  return "error" in result ? result : saved();
}
