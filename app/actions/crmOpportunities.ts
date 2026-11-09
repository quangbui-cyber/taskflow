"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled, CRM_DISABLED_MESSAGE } from "@/lib/features";
import { loadCrmActor, loadOpportunityResource } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { notify } from "@/lib/notify";
import { openOpportunity, advanceStage, closeOpportunity } from "@/lib/crm/opportunityWorkflow";
import { editOpportunity, changeOpportunityPicOrTeam } from "@/lib/crm/opportunityService";
import { winOpportunity, winPreview } from "@/lib/crm/opportunityWin";
import { handOverOpportunityDrive } from "@/lib/crm/opportunityDrive";
import { parseOpenOpportunityPayload, parseAdvancePayload, parseClosePayload, parseWinPayload, parseEditPayload, parseChangePicPayload } from "@/lib/crm/opportunityInput";

export type CrmOpportunityActionState = { error?: string; success?: string; fieldErrors?: Record<string, string>; opportunityId?: string; projectId?: string };
const FAILED = "Không lưu được Cơ hội. Vui lòng thử lại.";
async function refresh(opportunityId: string, knownClientId?: string) {
  const clientId = knownClientId ?? (await prisma.opportunity.findUnique({ where: { id: opportunityId }, select: { clientId: true } }))?.clientId;
  revalidatePath("/crm"); revalidatePath("/crm/clients"); revalidatePath("/crm/opportunities"); revalidatePath(`/crm/opportunities/${opportunityId}`); revalidatePath("/tasks");
  if (clientId) revalidatePath(`/crm/clients/${clientId}`);
}

export async function openOpportunityAction(raw: unknown): Promise<CrmOpportunityActionState> {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const parsed = parseOpenOpportunityPayload(raw); if (!("ok" in parsed)) return parsed;
  const actor = { ...await loadCrmActor(user), name: user.name };
  try {
    const result = await openOpportunity(prisma, actor, parsed.value);
    if (!("ok" in result)) return result;
    await refresh(result.opportunityId, parsed.value.clientId);
    return { success: "Đã mở Cơ hội.", opportunityId: result.opportunityId };
  } catch { return { error: FAILED }; }
}
export async function advanceOpportunityStageAction(raw: unknown): Promise<CrmOpportunityActionState> {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const parsed = parseAdvancePayload(raw); if (!("ok" in parsed)) return parsed;
  const actor = { ...await loadCrmActor(user), name: user.name };
  try {
    const result = await advanceStage(prisma, actor, parsed.value);
    if (!("ok" in result)) return result;
    await refresh(parsed.value.opportunityId);
    return { success: parsed.value.to === "BRIEF" ? `Đã chuyển sang Brief.${result.closedReminders > 0 ? ` Đã đóng ${result.closedReminders} nhắc của chương trình này.` : ""}` : "Đã chuyển sang Bidding." };
  } catch { return { error: FAILED }; }
}
export async function closeOpportunityAction(raw: unknown): Promise<CrmOpportunityActionState> {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const parsed = parseClosePayload(raw); if (!("ok" in parsed)) return parsed;
  const actor = { ...await loadCrmActor(user), name: user.name };
  try {
    const result = await closeOpportunity(prisma, actor, parsed.value);
    if (!("ok" in result)) return result;
    await refresh(parsed.value.opportunityId);
    return { success: "Đã lưu kết quả." };
  } catch { return { error: FAILED }; }
}
export async function editOpportunityAction(raw: unknown): Promise<CrmOpportunityActionState> {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const parsed = parseEditPayload(raw); if (!("ok" in parsed)) return parsed;
  const actor = { ...await loadCrmActor(user), name: user.name };
  try {
    const result = await editOpportunity(prisma, actor, parsed.value);
    if (!("ok" in result)) return result;
    await refresh(parsed.value.opportunityId);
    return { success: "Đã lưu thay đổi." };
  } catch { return { error: FAILED }; }
}
export async function changeOpportunityPicOrTeamAction(raw: unknown): Promise<CrmOpportunityActionState> {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const parsed = parseChangePicPayload(raw); if (!("ok" in parsed)) return parsed;
  const actor = { ...await loadCrmActor(user), name: user.name };
  try {
    const result = await changeOpportunityPicOrTeam(prisma, actor, parsed.value);
    if (!("ok" in result)) return result;
    await refresh(parsed.value.opportunityId);
    return { success: "Đã lưu thay đổi." };
  } catch { return { error: FAILED }; }
}
export async function winOpportunityAction(raw: unknown): Promise<CrmOpportunityActionState> {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  const parsed = parseWinPayload(raw); if (!("ok" in parsed)) return parsed;
  const actor = { ...await loadCrmActor(user), name: user.name };
  let result: Awaited<ReturnType<typeof winOpportunity>>;
  try { result = await winOpportunity(prisma, actor, parsed.value); }
  catch { return { error: "Chưa tạo được Project. Cơ hội vẫn ở Bidding, thử lại sau ít phút." }; }
  if (!("ok" in result)) return result;
  // From here the win is committed. A post-commit failure must not report that it is still Bidding.
  const { projectId, projectName } = result;
  if (!result.alreadyWon) {
    try { after(() => handOverOpportunityDrive(parsed.value.opportunityId, projectId)); }
    catch { console.warn("CRM Drive handover scheduling failed; cron will retry."); }
    try {
      const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: parsed.value.opportunityId }, select: { name: true, opportunityMembers: { select: { userId: true } } } });
      await notify(opportunity.opportunityMembers.map((m) => m.userId).filter((id) => id !== user.id), { type: "CRM_STAGE", opportunityId: parsed.value.opportunityId, message: `Cơ hội ${opportunity.name} chuyển sang Thắng.` });
    } catch { console.warn("CRM win notification could not be delivered."); }
  }
  try { await refresh(parsed.value.opportunityId); revalidatePath("/", "layout"); revalidatePath("/projects"); revalidatePath(`/projects/${projectId}`); }
  catch { console.warn("CRM win page refresh failed."); }
  return { success: `Đã tạo Project ${projectName}.`, projectId };
}
export async function winPreviewAction(opportunityId: unknown): Promise<{ error?: string; tasks?: number; files?: number; meetings?: number; budgetMin?: number | null; budgetMax?: number | null }> {
  const user = await requireUser();
  if (!crmEnabled()) return { error: CRM_DISABLED_MESSAGE };
  if (typeof opportunityId !== "string" || !opportunityId.trim() || opportunityId.length > 64) return { error: "Chọn Cơ hội." };
  const actor = { ...await loadCrmActor(user), name: user.name };
  try {
    const resource = await loadOpportunityResource(prisma, opportunityId);
    if (!resource || !crmCan(actor, "VIEW", resource)) return { error: "Không tìm thấy Cơ hội." };
    const result = await winPreview(prisma, opportunityId);
    return { tasks: result.tasks, files: result.files, meetings: result.meetings, budgetMin: result.budgetMin === null ? null : Number(result.budgetMin), budgetMax: result.budgetMax === null ? null : Number(result.budgetMax) };
  } catch { return { error: "Không tải được dữ liệu bàn giao." }; }
}
