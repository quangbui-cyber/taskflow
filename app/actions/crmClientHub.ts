"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CRM_DISABLED_MESSAGE } from "@/lib/features";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { saveClientPlaybookSection } from "@/lib/crm/clientPlaybook";
import { saveProjectFeedback, type CaseStudy } from "@/lib/crm/projectFeedback";
import { PLAYBOOK_SECTIONS, type PlaybookSection } from "@/lib/crm/clientHub";

const INVALID = "Thông tin không hợp lệ.";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && !!value && value.length <= 64;

export async function saveClientPlaybookAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.clientId) || typeof raw.expectedVersion !== "number" || typeof raw.section !== "string" || !Object.hasOwn(PLAYBOOK_SECTIONS, raw.section) || !record(raw.fields)) return { error: INVALID };
  const actor = { ...await loadCrmActor(user), name: user.name };
  const result = await saveClientPlaybookSection(prisma, actor, { clientId: raw.clientId, expectedVersion: raw.expectedVersion, section: raw.section as PlaybookSection, fields: raw.fields });
  if ("error" in result) return result;
  revalidatePath(`/crm/clients/${raw.clientId}`);
  return { success: result.changed ? "Đã lưu sổ tay." : "Không có thay đổi.", version: result.version };
}

export async function saveProjectFeedbackAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  if (!record(raw) || !id(raw.projectId) || !id(raw.clientId) || typeof raw.rating !== "number" || typeof raw.caseStudy !== "string" || (raw.note !== undefined && raw.note !== null && typeof raw.note !== "string")) return { error: INVALID };
  const actor = await loadCrmActor(user);
  const result = await saveProjectFeedback(prisma, actor, { projectId: raw.projectId, rating: raw.rating, note: raw.note as string | null | undefined, caseStudy: raw.caseStudy as CaseStudy });
  if ("error" in result) return result;
  revalidatePath(`/crm/clients/${raw.clientId}`);
  return { success: "Đã lưu đánh giá của khách." };
}
