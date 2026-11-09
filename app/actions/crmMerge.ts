"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled, CRM_DISABLED_MESSAGE } from "@/lib/features";
import { loadCrmActor } from "@/lib/crm/actor";
import { mergeClients } from "@/lib/crm/clientMerge";
import { syncOwnerSharingSafe } from "@/lib/driveStorage";

export async function mergeClientsAction(raw: unknown): Promise<{ error?: string; success?: string }> {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Thông tin gộp khách không hợp lệ." };
  const input = raw as Record<string, unknown>;
  const id = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 128;
  const version = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!id(input.sourceClientId) || !id(input.targetClientId) || !version(input.expectedSourceVersion) || !version(input.expectedTargetVersion)) return { error: "Thông tin gộp khách không hợp lệ." };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await mergeClients(prisma, actor, { sourceClientId: input.sourceClientId, targetClientId: input.targetClientId, expectedSourceVersion: input.expectedSourceVersion, expectedTargetVersion: input.expectedTargetVersion });
  if ("error" in result) return result;
  const targetClientId = input.targetClientId;
  after(async () => {
    try { await syncOwnerSharingSafe({ kind: "CLIENT", id: targetClientId }); }
    catch { console.warn("CRM merged client sharing could not be synchronized."); }
  });
  for (const path of ["/admin", "/crm", "/crm/import/duplicates", "/crm/clients", "/projects", "/tasks"]) revalidatePath(path);
  revalidatePath("/crm/clients/[id]", "page");
  return { success: `Đã gộp ${result.sourceClientName} vào ${result.targetClientName}.` };
}
