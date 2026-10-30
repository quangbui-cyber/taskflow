import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildLeaderboard,
  isMonthKey,
  monthKeyOf,
  monthRange,
  type GameLeaderboard,
  type MatchResult,
} from "@/lib/gameLeaderboard";

/** Dựng bảng xếp hạng một tháng (mặc định tháng hiện tại) từ danh sách trận do từng game cung cấp. */
export async function loadLeaderboard(
  findMatches: (range: { start: Date; end: Date }) => Promise<MatchResult[]>,
  viewerId: string,
  month?: string
): Promise<GameLeaderboard> {
  const currentMonth = monthKeyOf(new Date());
  const key = isMonthKey(month) && month <= currentMonth ? month : currentMonth;
  const matches = await findMatches(monthRange(key));
  const rows = buildLeaderboard(matches);
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, name: true, avatarUrl: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    month: key,
    currentMonth,
    totalMatches: matches.length,
    rows: rows.map((r) => ({
      ...r,
      name: byId.get(r.userId)?.name || "Thành viên",
      avatarUrl: byId.get(r.userId)?.avatarUrl ?? null,
      isMe: r.userId === viewerId,
    })),
  };
}
