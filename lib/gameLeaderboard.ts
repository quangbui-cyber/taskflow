// Bảng xếp hạng thi đấu online theo tháng, dùng chung cho Sudoku và Caro.
// Tháng tính theo giờ Việt Nam (UTC+7, không đổi giờ mùa hè).

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Khoá tháng dạng "YYYY-MM". */
export type MonthKey = string;

export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthKeyOf(date: Date): MonthKey {
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Khoảng [start, end) của tháng theo giờ Việt Nam, đổi ra giờ UTC để truy vấn. */
export function monthRange(key: MonthKey): { start: Date; end: Date } {
  const [y, m] = key.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - VN_OFFSET_MS),
    end: new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS),
  };
}

export function monthLabel(key: MonthKey): string {
  const [y, m] = key.split("-").map(Number);
  return `Tháng ${m}/${y}`;
}

export type MatchResult = {
  hostUserId: string;
  guestUserId: string;
  /** null = hoà. */
  winnerUserId: string | null;
};

export type LeaderboardRow = {
  userId: string;
  rank: number;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  /** Tỉ lệ thắng 0–100, làm tròn. */
  winRate: number;
};

/**
 * Xếp theo số trận thắng; bằng nhau thì ai đấu ít trận hơn (tỉ lệ thắng cao hơn) đứng trên.
 * Người bằng cả hai chỉ số được cùng hạng.
 */
export function buildLeaderboard(matches: MatchResult[]): LeaderboardRow[] {
  const stats = new Map<string, { wins: number; losses: number; draws: number }>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { wins: 0, losses: 0, draws: 0 }));
    return s;
  };

  for (const m of matches) {
    for (const id of [m.hostUserId, m.guestUserId]) {
      const s = get(id);
      if (m.winnerUserId === null) s.draws++;
      else if (m.winnerUserId === id) s.wins++;
      else s.losses++;
    }
  }

  const rows = [...stats.entries()]
    .map(([userId, s]) => {
      const played = s.wins + s.losses + s.draws;
      return { userId, ...s, played, winRate: played ? Math.round((s.wins / played) * 100) : 0, rank: 0 };
    })
    .sort((a, b) => b.wins - a.wins || a.played - b.played || a.userId.localeCompare(b.userId));

  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank = prev && prev.wins === row.wins && prev.played === row.played ? prev.rank : i + 1;
  });
  return rows;
}

export type GameLeaderboardEntry = LeaderboardRow & {
  name: string;
  avatarUrl: string | null;
  isMe: boolean;
};

export type GameLeaderboard = {
  month: MonthKey;
  currentMonth: MonthKey;
  totalMatches: number;
  rows: GameLeaderboardEntry[];
};
