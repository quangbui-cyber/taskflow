import type { PrismaClient } from "@prisma/client";
import { loadCrmActorFrom } from "./actor";
import { formatCrmDate } from "./dates";
import { loadWeeklyReviewGroups } from "./reviewData";

export const HOME_FOCUS_LIMIT = 2;
export type MyCrmFocus = {
  isPic: boolean;
  rows: { clientId: string; clientName: string; reason: string; dueLabel: string | null }[];
};

export async function loadMyCrmFocus(db: PrismaClient, user: { id: string; role: string }, now = new Date()): Promise<MyCrmFocus> {
  // Merged sources are deleted by mergeClients, so only current Client rows count.
  if (!await db.client.count({ where: { picAccount: { userId: user.id } } })) return { isPic: false, rows: [] };
  const actor = await loadCrmActorFrom(db, user);
  const review = await loadWeeklyReviewGroups(db, actor, { team: "all", pic: "me" }, now);
  const rows = [...review.groups.OVERDUE, ...review.groups.DUE_THIS_WEEK, ...review.groups.NO_NEXT_STEP]
    .filter((row) => row.pic?.userId === user.id)
    .slice(0, HOME_FOCUS_LIMIT)
    .map((row) => ({
      clientId: row.client.id, clientName: row.client.name,
      reason: row.group === "NO_NEXT_STEP" ? "Chưa có việc tiếp theo" : row.reason.label,
      dueLabel: row.dueDate ? `hạn ${formatCrmDate(row.dueDate, now)}` : null,
    }));
  return { isPic: true, rows };
}
