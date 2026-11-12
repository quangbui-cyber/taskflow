"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CRM_DISABLED_MESSAGE } from "@/lib/features";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { canManageCampaign, previewCampaign } from "@/lib/crm/campaignData";
import { validateCampaignDraft } from "@/lib/crm/campaignPlan";
import { addSuggestedCampaignTemplates, changeCampaignStatus, deleteCampaignDraft, launchCampaign, saveCampaignDraft, saveCampaignTemplate } from "@/lib/crm/campaignService";

const INVALID = "Thông tin chiến dịch không hợp lệ.";
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v && v.length <= 64;
const version = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** crm52: every campaign action re-checks per-person CRM access (crm54) and loads the actor from the database. */
async function campaignActor() {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return null;
  return { ...await loadCrmActor(user), name: user.name };
}
function refresh(campaignId?: string) {
  revalidatePath("/crm/campaigns");
  if (campaignId) revalidatePath(`/crm/campaigns/${campaignId}`);
  revalidatePath("/crm");
}

export async function saveCampaignDraftAction(raw: unknown) {
  const actor = await campaignActor();
  if (!actor) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || (raw.id != null && !id(raw.id)) || (raw.expectedVersion != null && !version(raw.expectedVersion))) return { error: INVALID };
  const result = await saveCampaignDraft(prisma, actor, { id: raw.id as string | null | undefined, expectedVersion: raw.expectedVersion as number | undefined, draft: raw.draft });
  if ("error" in result) return result;
  refresh(result.id);
  return { success: "Đã lưu bản nháp.", id: result.id, version: result.version };
}

export async function previewCampaignAction(raw: unknown) {
  const actor = await campaignActor();
  if (!actor) return { error: CRM_DISABLED_MESSAGE };
  const parsed = validateCampaignDraft(raw);
  if ("errors" in parsed) return { error: Object.values(parsed.errors)[0] };
  if (!canManageCampaign(actor, parsed.value.teamId)) return { error: DENIED };
  const preview = await previewCampaign(prisma, parsed.value, new Date());
  return { preview: {
    selection: preview.selection, blockers: preview.blockers, threshold: preview.threshold,
    scheduled: preview.scheduled.map((s) => ({ stepIndex: s.stepIndex, dueKey: s.dueKey, title: s.title, kind: s.kind, offsetDays: s.offsetDays })),
    load: preview.plan.load, suggestions: preview.plan.suggestions, taskCount: preview.plan.tasks.length,
    pics: preview.pics.map((p) => ({ accountId: p.accountId, userId: p.userId, name: p.name })),
  } };
}

export async function launchCampaignAction(raw: unknown) {
  const actor = await campaignActor();
  if (!actor) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.id) || !version(raw.expectedVersion)) return { error: INVALID };
  const result = await launchCampaign(prisma, actor, { id: raw.id, expectedVersion: raw.expectedVersion });
  if ("error" in result) return result;
  refresh(raw.id);
  revalidatePath("/tasks");
  return { success: result.alreadyLaunched ? "Chiến dịch đã chạy trước đó." : `Đã tạo ${result.tasks} việc cho ${result.targets} khách.` };
}

export async function changeCampaignStatusAction(raw: unknown) {
  const actor = await campaignActor();
  if (!actor) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.id) || !version(raw.expectedVersion) || !["PAUSE", "RESUME", "CANCEL", "FINISH"].includes(raw.action as string)) return { error: INVALID };
  const action = raw.action as "PAUSE" | "RESUME" | "CANCEL" | "FINISH";
  const result = await changeCampaignStatus(prisma, actor, { id: raw.id, expectedVersion: raw.expectedVersion, action });
  if ("error" in result) return result;
  refresh(raw.id);
  if (action === "CANCEL") revalidatePath("/tasks");
  const messages = { PAUSE: "Đã tạm dừng chiến dịch.", RESUME: "Chiến dịch chạy tiếp.", CANCEL: `Đã hủy chiến dịch và ${result.cancelledTasks} việc chưa làm.`, FINISH: "Đã kết thúc chiến dịch." };
  return { success: messages[action], version: result.version };
}

export async function deleteCampaignDraftAction(raw: unknown) {
  const actor = await campaignActor();
  if (!actor) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.id) || !version(raw.expectedVersion)) return { error: INVALID };
  const result = await deleteCampaignDraft(prisma, actor, { id: raw.id, expectedVersion: raw.expectedVersion });
  if ("error" in result) return result;
  refresh();
  return { success: "Đã xóa bản nháp." };
}

export async function saveCampaignTemplateAction(raw: unknown) {
  const actor = await campaignActor();
  if (!actor) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || (raw.id !== undefined && !id(raw.id)) || typeof raw.name !== "string" || (raw.description !== null && typeof raw.description !== "string") || typeof raw.active !== "boolean" || typeof raw.order !== "number") return { error: INVALID };
  const result = await saveCampaignTemplate(prisma, actor, { id: raw.id as string | undefined, name: raw.name, description: raw.description as string | null, steps: raw.steps, active: raw.active, order: raw.order });
  if ("error" in result) return result;
  revalidatePath("/admin");
  revalidatePath("/crm/campaigns/new");
  return { success: "Đã lưu mẫu chiến dịch.", id: result.id };
}

export async function addSuggestedCampaignTemplatesAction() {
  const actor = await campaignActor();
  if (!actor) return { error: CRM_DISABLED_MESSAGE };
  const result = await addSuggestedCampaignTemplates(prisma, actor);
  if ("error" in result) return result;
  revalidatePath("/admin");
  return { success: result.added ? `Đã thêm ${result.added} mẫu gợi ý.` : "Các mẫu gợi ý đã có sẵn." };
}
