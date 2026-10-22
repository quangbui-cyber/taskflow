import type { Prisma, PrismaClient } from "@prisma/client";
import { RECAP_ACTION_ITEMS_MAX, type RecapActionItemRow } from "./meetingRecap";
import { newRecapSuggestions, readRecapSuggestions, toRecapActionView } from "./recapPublication";

export const recapActionViewInclude = {
  owner: { select: { id: true, name: true, avatarUrl: true } },
  task: { select: { id: true, status: true, projectId: true, project: { select: { name: true } } } },
} satisfies Prisma.MeetingRecapActionItemInclude;

/** All draft writers and publication take this lock before reading mutable state. */
export async function lockRecap(tx: Prisma.TransactionClient, recapId: string) {
  await tx.$queryRaw`SELECT id FROM "MeetingRecap" WHERE id = ${recapId} FOR UPDATE`;
}

export async function publishRecap(db: PrismaClient, recapId: string, sentAt: Date) {
  return db.$transaction(async (tx) => {
    await lockRecap(tx, recapId);
    const recap = await tx.meetingRecap.findUnique({
      where: { id: recapId },
      include: { actionItems: { include: recapActionViewInclude, orderBy: [{ order: "asc" }, { createdAt: "asc" }] } },
    });
    if (!recap || recap.status !== "READY" || !recap.content?.trim()) return null;
    const snapshot = { content: recap.content, actionItems: recap.actionItems.map(toRecapActionView) };
    await tx.meetingRecap.update({ where: { id: recapId }, data: { sentAt, publishedSnapshot: snapshot } });
    return snapshot;
  });
}

/** Commit one AI result without touching existing action rows or the published version. */
export async function completeRecapDraft(
  db: PrismaClient, recapId: string, startedAt: Date, content: string,
  rows: RecapActionItemRow[], makeId: () => string,
) {
  return db.$transaction(async (tx) => {
    await lockRecap(tx, recapId);
    const recap = await tx.meetingRecap.findFirst({
      where: { id: recapId, status: "PROCESSING", processingStartedAt: startedAt },
      include: { actionItems: { select: { title: true } } },
    });
    if (!recap) return false;
    const rewrite = Boolean(recap.content || recap.publishedSnapshot) || recap.actionItems.length > 0;
    await tx.meetingRecap.update({
      where: { id: recapId },
      data: { status: "READY", stage: null, error: null, content,
        actionSuggestions: rewrite ? newRecapSuggestions(rows, recap.actionItems, makeId) : [] },
    });
    if (!rewrite && rows.length) {
      await tx.meetingRecapActionItem.createMany({ data: rows.map((row) => ({ ...row, recapId })) });
    }
    return true;
  });
}

/** Accept/discard uses the same row lock: repeat clicks cannot create duplicate rows. */
export async function resolveRecapSuggestion(db: PrismaClient, recapId: string, suggestionId: string, accept: boolean) {
  return db.$transaction(async (tx) => {
    await lockRecap(tx, recapId);
    const recap = await tx.meetingRecap.findUnique({ where: { id: recapId } });
    if (!recap || recap.status !== "READY") return { error: "Biên bản chưa sẵn sàng để sửa." };
    const suggestions = readRecapSuggestions(recap.actionSuggestions);
    const suggestion = suggestions.find((row) => row.id === suggestionId);
    if (!suggestion) return { error: "Đề xuất đã được xử lý hoặc thay bằng lần viết lại mới." };
    if (accept) {
      const existing = await tx.meetingRecapActionItem.findMany({ where: { recapId }, select: { title: true, order: true } });
      if (existing.length >= RECAP_ACTION_ITEMS_MAX) return { error: `Mỗi biên bản có tối đa ${RECAP_ACTION_ITEMS_MAX} việc.` };
      const normalize = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
      if (!existing.some((row) => normalize(row.title) === normalize(suggestion.title))) {
        // The assignee must still be active and invited when a suggestion is accepted.
        const meeting = await tx.meeting.findUniqueOrThrow({ where: { id: recap.meetingId }, select: { organizerId: true, attendees: { select: { userId: true } } } });
        const invited = [meeting.organizerId, ...meeting.attendees.map((row) => row.userId)];
        const owner = suggestion.ownerId && invited.includes(suggestion.ownerId)
          ? await tx.user.findFirst({ where: { id: suggestion.ownerId, isActive: true }, select: { id: true } }) : null;
        await tx.meetingRecapActionItem.create({ data: {
          recapId, title: suggestion.title, ownerId: owner?.id ?? null, ownerName: suggestion.ownerName,
          dueDate: suggestion.dueDate ? new Date(suggestion.dueDate) : null, dueText: suggestion.dueText,
          order: Math.max(-1, ...existing.map((row) => row.order)) + 1,
        } });
      }
    }
    await tx.meetingRecap.update({ where: { id: recapId }, data: { actionSuggestions: suggestions.filter((row) => row.id !== suggestionId) } });
    return { success: accept ? "Đã bổ sung việc vào danh sách." : "Đã bỏ qua đề xuất." };
  });
}

/** Read the reviewed row under the lock, so edits and double clicks cannot create stale/duplicate tasks. */
export async function createLinkedRecapTask(
  db: PrismaClient, recapId: string, itemId: string, projectId: string, creatorId: string, description: string,
) {
  return db.$transaction(async (tx) => {
    await lockRecap(tx, recapId);
    const recap = await tx.meetingRecap.findUnique({ where: { id: recapId }, select: { status: true } });
    if (recap?.status !== "READY") throw new Error("RECAP_BUSY");
    const item = await tx.meetingRecapActionItem.findFirst({ where: { id: itemId, recapId } });
    if (!item || item.taskId) throw new Error("ALREADY_LINKED");
    const membership = item.ownerId ? await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: item.ownerId } }, select: { userId: true },
    }) : null;
    const last = await tx.task.findFirst({ where: { projectId, status: "TODO" }, orderBy: { order: "desc" }, select: { order: true } });
    const created = await tx.task.create({
      data: { title: item.title, description, projectId, creatorId, status: "TODO", priority: "MEDIUM",
        dueDate: item.dueDate, assigneeId: membership?.userId ?? null, order: (last?.order ?? 0) + 1 },
      select: { id: true, title: true, assigneeId: true, assignee: { select: { name: true } } },
    });
    await tx.meetingRecapActionItem.update({ where: { id: item.id }, data: { taskId: created.id } });
    return created;
  });
}
