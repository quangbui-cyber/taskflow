import { Prisma, type PrismaClient } from "@prisma/client";
import { KPI_RECOGNIZED_STATUSES } from "../kpi";
import { crmCanRateProject, type CrmActor, type CrmOwnerResource } from "./policy";
import { CASE_STUDY_OPTIONS, FEEDBACK_NOTE_MAX, type CaseStudy } from "./clientHubLabels";
export { CASE_STUDY_OPTIONS, FEEDBACK_NOTE_MAX, type CaseStudy } from "./clientHubLabels";
export type FeedbackInput = { projectId: string; rating: number; note?: string | null; caseStudy: CaseStudy };
type Result = { ok: true } | { error: string };
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const INVALID = "Đánh giá không hợp lệ.";

export function validateFeedbackInput(input: FeedbackInput): string | null {
  if (!input || typeof input.projectId !== "string" || !input.projectId || input.projectId.length > 64) return INVALID;
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) return "Chọn mức đánh giá từ 1 đến 5.";
  if (input.note !== undefined && input.note !== null && (typeof input.note !== "string" || input.note.trim().length > FEEDBACK_NOTE_MAX)) return `Ghi chú tối đa ${FEEDBACK_NOTE_MAX} ký tự.`;
  if (!CASE_STUDY_OPTIONS.some((option) => option.key === input.caseStudy)) return INVALID;
  return null;
}

/** Feedback belongs to the Project, never to a named client person; one row per Project, last save wins. */
export async function saveProjectFeedback(db: PrismaClient, actor: CrmActor, input: FeedbackInput): Promise<Result> {
  const problem = validateFeedbackInput(input);
  if (problem) return { error: problem };
  const project = await db.project.findUnique({ where: { id: input.projectId }, select: {
    id: true, category: true, status: true, ownerId: true, clientId: true,
    members: { where: { userId: actor.id }, select: { id: true }, take: 1 },
    client: { select: { responsibleTeamId: true, picAccount: { select: { userId: true, teamId: true } } } },
  } });
  if (!project?.client || project.category !== "CLIENT") return { error: DENIED };
  const resource: CrmOwnerResource = { kind: "CLIENT", picUserId: project.client.picAccount?.userId ?? null, teamId: project.client.responsibleTeamId ?? project.client.picAccount?.teamId ?? null };
  if (!crmCanRateProject(actor, resource, project.ownerId === actor.id || project.members.length > 0)) return { error: DENIED };
  if (!KPI_RECOGNIZED_STATUSES.includes(project.status)) return { error: "Chỉ đánh giá dự án đang chạy hoặc đã xong." };
  const data = { rating: input.rating, note: input.note?.trim() || null, caseStudy: input.caseStudy };
  const write = () => db.projectFeedback.upsert({ where: { projectId: project.id }, create: { ...data, projectId: project.id, createdById: actor.id }, update: data });
  try { await write(); } catch (error) {
    // Two first saves at once: the loser retries as an update.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") await write();
    else throw error;
  }
  return { ok: true };
}
