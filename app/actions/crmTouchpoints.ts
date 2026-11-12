"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CRM_DISABLED_MESSAGE } from "@/lib/features";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { dismissDraft, logTouchpoint, validateTouchpointInput } from "@/lib/crm/touchpoints";

function refresh(clientId: string, opportunityId: string | null) {
  revalidatePath("/crm");
  revalidatePath("/crm/clients");
  revalidatePath(`/crm/clients/${clientId}`);
  if (opportunityId) revalidatePath(`/crm/opportunities/${opportunityId}`);
}

export async function logTouchpointAction(payload: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  const parsed = validateTouchpointInput(payload);
  if ("errors" in parsed) return { error: Object.values(parsed.errors)[0], fieldErrors: parsed.errors };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await logTouchpoint(prisma, actor, parsed.value);
  if ("error" in result) return result;
  refresh(parsed.value.clientId, result.openedOpportunityId ?? parsed.value.opportunityId);
  return { success: result.openedOpportunityId ? "Đã lưu điểm chạm và mở Cơ hội." : "Đã lưu điểm chạm.", touchpointId: result.touchpointId, openedOpportunityId: result.openedOpportunityId };
}

export async function dismissDraftAction(draftId: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (typeof draftId !== "string" || !draftId.trim() || draftId.length > 64) return { error: "Thông tin điểm chạm không hợp lệ." };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await dismissDraft(prisma, actor, draftId);
  if ("error" in result) return result;
  refresh(result.clientId, result.opportunityId);
  return { success: "Đã bỏ qua điểm chạm nháp." };
}
