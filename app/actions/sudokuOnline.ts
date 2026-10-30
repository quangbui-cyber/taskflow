"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  CELLS,
  MAX_MISTAKES,
  TIME_LIMIT_SEC,
  countCorrect,
  generatePuzzle,
  isDifficulty,
  isSolved,
  type Grid,
  type SudokuDifficulty,
} from "@/lib/sudoku";
import {
  buildLeaderboard,
  isMonthKey,
  monthKeyOf,
  monthRange,
  type LeaderboardRow,
  type MonthKey,
} from "@/lib/sudokuLeaderboard";

export type SudokuSide = "HOST" | "GUEST";
export type SudokuStatus = "WAITING" | "READY" | "PLAYING" | "FINISHED";

/** Trạng thái phòng gửi về trình duyệt. Không chứa lời giải hay bảng của đối thủ. */
export type SudokuOnlineState = {
  code: string;
  mySide: SudokuSide | "SPECTATOR";
  hostName: string;
  guestName: string | null;
  difficulty: SudokuDifficulty;
  timerEnabled: boolean;
  timeLimitSec: number;
  status: SudokuStatus;
  puzzle: Grid | null;
  myValues: Grid | null;
  myMistakes: number;
  opponentMistakes: number;
  /** Số ô đúng (kể cả đề) của mỗi bên, 0–81. */
  hostProgress: number;
  guestProgress: number;
  winner: SudokuSide | "DRAW" | null;
  finishReason: "SOLVED" | "MISTAKES" | "TIMEOUT" | "FORFEIT" | null;
  scoreHost: number;
  scoreGuest: number;
  startedAt: string | null;
  serverNow: string;
};

type Result = { success: boolean; game?: SudokuOnlineState; error?: string };
type Row = NonNullable<Awaited<ReturnType<typeof prisma.sudokuGame.findUnique>>>;

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "SD";
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

const asGrid = (v: unknown): Grid | null => (Array.isArray(v) && v.length === CELLS ? (v as Grid) : null);

function sideOf(game: Row, userId: string): SudokuSide | "SPECTATOR" {
  if (game.hostUserId === userId) return "HOST";
  if (game.guestUserId === userId) return "GUEST";
  return "SPECTATOR";
}

function toState(game: Row, userId: string): SudokuOnlineState {
  const side = sideOf(game, userId);
  const solution = asGrid(game.solution);
  const hostValues = asGrid(game.hostValues);
  const guestValues = asGrid(game.guestValues);
  const progress = (values: Grid | null) => (values && solution ? countCorrect(values, solution) : 0);
  return {
    code: game.code,
    mySide: side,
    hostName: game.hostName,
    guestName: game.guestName,
    difficulty: isDifficulty(game.difficulty) ? game.difficulty : "medium",
    timerEnabled: game.timerEnabled,
    timeLimitSec: game.timeLimitSec,
    status: game.status as SudokuStatus,
    puzzle: asGrid(game.puzzle),
    myValues: side === "HOST" ? hostValues : side === "GUEST" ? guestValues : null,
    myMistakes: side === "GUEST" ? game.guestMistakes : game.hostMistakes,
    opponentMistakes: side === "GUEST" ? game.hostMistakes : game.guestMistakes,
    hostProgress: progress(hostValues),
    guestProgress: progress(guestValues),
    winner: (game.winner as SudokuSide | "DRAW" | null) ?? null,
    finishReason: (game.finishReason as SudokuOnlineState["finishReason"]) ?? null,
    scoreHost: game.scoreHost,
    scoreGuest: game.scoreGuest,
    startedAt: game.startedAt ? game.startedAt.toISOString() : null,
    serverNow: new Date().toISOString(),
  };
}

function scoreUpdate(game: Row, winner: SudokuSide | "DRAW") {
  return {
    scoreHost: game.scoreHost + (winner === "HOST" ? 1 : 0),
    scoreGuest: game.scoreGuest + (winner === "GUEST" ? 1 : 0),
  };
}

type GameWhere = Parameters<typeof prisma.sudokuGame.updateMany>[0]["where"];
type GameData = Parameters<typeof prisma.sudokuGame.updateMany>[0]["data"];

/**
 * Ghi cập nhật có điều kiện. Nếu cập nhật này kết thúc ván thì lưu luôn kết quả
 * trận cho bảng xếp hạng, trong cùng một giao dịch để không ghi thiếu hay ghi trùng.
 */
async function commitUpdate(game: Row, where: GameWhere, data: GameData): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.sudokuGame.updateMany({ where: { ...where, id: game.id }, data });
    if (count && data.status === "FINISHED" && game.guestUserId) {
      const winner = data.winner as SudokuSide | "DRAW";
      const startedAt = game.startedAt ?? new Date();
      await tx.sudokuMatch.create({
        data: {
          roomCode: game.code,
          hostUserId: game.hostUserId,
          guestUserId: game.guestUserId,
          winnerUserId: winner === "HOST" ? game.hostUserId : winner === "GUEST" ? game.guestUserId : null,
          difficulty: game.difficulty,
          finishReason: String(data.finishReason),
          durationSec: Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)),
        },
      });
    }
    return count;
  });
}

/** Hết giờ thì bên nhiều ô đúng hơn thắng, bằng nhau là hoà. Đồng hồ do máy chủ quyết định. */
async function settleTimeout(game: Row): Promise<Row> {
  if (game.status !== "PLAYING" || !game.timerEnabled || !game.startedAt) return game;
  const deadline = game.startedAt.getTime() + game.timeLimitSec * 1000;
  if (Date.now() < deadline) return game;

  const solution = asGrid(game.solution);
  const host = solution ? countCorrect(asGrid(game.hostValues) ?? [], solution) : 0;
  const guest = solution ? countCorrect(asGrid(game.guestValues) ?? [], solution) : 0;
  const winner: SudokuSide | "DRAW" = host === guest ? "DRAW" : host > guest ? "HOST" : "GUEST";

  const count = await commitUpdate(
    game,
    { status: "PLAYING" },
    { status: "FINISHED", winner, finishReason: "TIMEOUT", finishedAt: new Date(), ...scoreUpdate(game, winner) }
  );
  return count ? (await prisma.sudokuGame.findUnique({ where: { id: game.id } }))! : game;
}

async function loadGame(code: string): Promise<Row | null> {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return null;
  const game = await prisma.sudokuGame.findUnique({ where: { code: clean } });
  return game ? settleTimeout(game) : null;
}

const LOGIN_ERROR = "Bạn cần đăng nhập để chơi online.";

/** Tạo phòng mới. Chủ phòng chọn độ khó và có bật đếm giờ hay không. */
export async function createSudokuRoom(difficulty: SudokuDifficulty, timerEnabled: boolean): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const level = isDifficulty(difficulty) ? difficulty : "medium";
    let code = generateRoomCode();
    for (let i = 0; i < 5 && (await prisma.sudokuGame.findUnique({ where: { code } })); i++) {
      code = generateRoomCode();
    }
    const game = await prisma.sudokuGame.create({
      data: {
        code,
        hostUserId: user.id,
        hostName: (user.name || "Người chơi 1").slice(0, 30),
        difficulty: level,
        timerEnabled: Boolean(timerEnabled),
        timeLimitSec: TIME_LIMIT_SEC[level],
      },
    });
    return { success: true, game: toState(game, user.id) };
  } catch (error) {
    console.error("Lỗi tạo phòng Sudoku:", error);
    return { success: false, error: "Không thể tạo phòng lúc này." };
  }
}

export async function joinSudokuRoom(code: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const game = await loadGame(code);
    if (!game) return { success: false, error: "Không tìm thấy phòng này. Hãy kiểm tra lại mã phòng." };
    if (sideOf(game, user.id) !== "SPECTATOR") return { success: true, game: toState(game, user.id) };
    if (game.guestUserId) return { success: false, error: "Phòng đã đủ 2 người." };

    const { count } = await prisma.sudokuGame.updateMany({
      where: { id: game.id, guestUserId: null },
      data: { guestUserId: user.id, guestName: (user.name || "Người chơi 2").slice(0, 30), status: "READY" },
    });
    if (!count) return { success: false, error: "Phòng vừa có người khác vào." };
    const updated = (await prisma.sudokuGame.findUnique({ where: { id: game.id } }))!;
    return { success: true, game: toState(updated, user.id) };
  } catch (error) {
    console.error("Lỗi vào phòng Sudoku:", error);
    return { success: false, error: "Không thể vào phòng lúc này." };
  }
}

export async function getSudokuRoom(code: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const game = await loadGame(code);
    if (!game) return { success: false, error: "Phòng không tồn tại." };
    return { success: true, game: toState(game, user.id) };
  } catch {
    return { success: false, error: "Không thể tải trạng thái phòng." };
  }
}

/** Chủ phòng đổi độ khó / đếm giờ khi chưa vào ván. */
export async function updateSudokuRoomSettings(
  code: string,
  difficulty: SudokuDifficulty,
  timerEnabled: boolean
): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  const game = await loadGame(code);
  if (!game) return { success: false, error: "Phòng không tồn tại." };
  if (game.hostUserId !== user.id) return { success: false, error: "Chỉ chủ phòng được đổi cài đặt." };
  if (game.status === "PLAYING") return { success: false, error: "Không thể đổi cài đặt khi đang thi đấu." };
  const level = isDifficulty(difficulty) ? difficulty : "medium";
  const updated = await prisma.sudokuGame.update({
    where: { id: game.id },
    data: { difficulty: level, timerEnabled: Boolean(timerEnabled), timeLimitSec: TIME_LIMIT_SEC[level] },
  });
  return { success: true, game: toState(updated, user.id) };
}

/** Bắt đầu ván (hoặc ván mới): cả hai nhận cùng một đề vừa sinh. */
export async function startSudokuRound(code: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const game = await loadGame(code);
    if (!game) return { success: false, error: "Phòng không tồn tại." };
    if (sideOf(game, user.id) === "SPECTATOR") return { success: false, error: "Bạn không ở trong phòng này." };
    if (!game.guestUserId) return { success: false, error: "Cần đủ 2 người trước khi bắt đầu." };
    if (game.status === "PLAYING") return { success: true, game: toState(game, user.id) };

    const level = isDifficulty(game.difficulty) ? game.difficulty : "medium";
    const { puzzle, solution } = generatePuzzle(level);
    await prisma.sudokuGame.updateMany({
      where: { id: game.id, status: { not: "PLAYING" } },
      data: {
        puzzle,
        solution,
        hostValues: puzzle,
        guestValues: puzzle,
        hostMistakes: 0,
        guestMistakes: 0,
        status: "PLAYING",
        winner: null,
        finishReason: null,
        startedAt: new Date(),
        finishedAt: null,
      },
    });
    // Hai người bấm cùng lúc: lần bấm sau không ghi đè, chỉ nhận đề đã tạo.
    const updated = (await prisma.sudokuGame.findUnique({ where: { id: game.id } }))!;
    return { success: true, game: toState(updated, user.id) };
  } catch (error) {
    console.error("Lỗi bắt đầu ván Sudoku:", error);
    return { success: false, error: "Không thể bắt đầu ván." };
  }
}

type GameUpdate = Parameters<typeof prisma.sudokuGame.update>[0]["data"];

/** Tính dữ liệu cần ghi cho một nước đi (đúng: lưu số, sai: cộng lỗi). */
function moveUpdate(game: Row, side: SudokuSide, index: number, value: number): { data: GameUpdate; correct: boolean } | null {
  const solution = asGrid(game.solution);
  const puzzle = asGrid(game.puzzle);
  const values = asGrid(side === "HOST" ? game.hostValues : game.guestValues);
  if (!solution || !puzzle || !values) return null;

  const opponent: SudokuSide = side === "HOST" ? "GUEST" : "HOST";
  const finish = (winner: SudokuSide, reason: "SOLVED" | "MISTAKES") => ({
    status: "FINISHED",
    winner,
    finishReason: reason,
    finishedAt: new Date(),
    ...scoreUpdate(game, winner),
  });

  if (solution[index] === value) {
    const next = [...values];
    next[index] = value;
    const data: GameUpdate = side === "HOST" ? { hostValues: next } : { guestValues: next };
    return { correct: true, data: isSolved(next, solution) ? { ...data, ...finish(side, "SOLVED") } : data };
  }
  const mistakes = (side === "HOST" ? game.hostMistakes : game.guestMistakes) + 1;
  const data: GameUpdate = side === "HOST" ? { hostMistakes: mistakes } : { guestMistakes: mistakes };
  return { correct: false, data: mistakes >= MAX_MISTAKES ? { ...data, ...finish(opponent, "MISTAKES") } : data };
}

/**
 * Điền một số. Máy chủ so với lời giải: đúng thì lưu, sai thì cộng 1 lỗi
 * (3 lỗi là thua). Trả về `correct` để trình duyệt tô đỏ ô sai.
 */
export async function submitSudokuCell(
  code: string,
  index: number,
  value: number
): Promise<Result & { correct?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  if (!Number.isInteger(index) || index < 0 || index >= CELLS || !Number.isInteger(value) || value < 1 || value > 9) {
    return { success: false, error: "Nước đi không hợp lệ." };
  }
  try {
    // Hai người cùng ghi một dòng: chỉ ghi khi dữ liệu chưa đổi, nếu đổi thì đọc lại và thử tiếp.
    for (let attempt = 0; attempt < 4; attempt++) {
      const game = await loadGame(code);
      if (!game) return { success: false, error: "Phòng không tồn tại." };
      const side = sideOf(game, user.id);
      if (side === "SPECTATOR") return { success: false, error: "Bạn không ở trong phòng này." };
      if (game.status !== "PLAYING") return { success: true, game: toState(game, user.id) };

      const puzzle = asGrid(game.puzzle);
      const values = asGrid(side === "HOST" ? game.hostValues : game.guestValues);
      const solution = asGrid(game.solution);
      if (puzzle?.[index] !== 0 || (values && solution && values[index] === solution[index])) {
        return { success: true, correct: true, game: toState(game, user.id) };
      }

      const move = moveUpdate(game, side, index, value);
      if (!move) return { success: false, error: "Ván đấu bị lỗi dữ liệu." };
      const count = await commitUpdate(game, { status: "PLAYING", updatedAt: game.updatedAt }, move.data as GameData);
      if (count) {
        const updated = (await prisma.sudokuGame.findUnique({ where: { id: game.id } }))!;
        return { success: true, correct: move.correct, game: toState(updated, user.id) };
      }
    }
    return { success: false, error: "Máy chủ đang bận, hãy thử lại." };
  } catch (error) {
    console.error("Lỗi điền ô Sudoku:", error);
    return { success: false, error: "Không thể ghi nước đi." };
  }
}

/** Bỏ cuộc: đối thủ thắng ngay. */
export async function forfeitSudokuRound(code: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  const game = await loadGame(code);
  if (!game) return { success: false, error: "Phòng không tồn tại." };
  const side = sideOf(game, user.id);
  if (side === "SPECTATOR" || game.status !== "PLAYING") return { success: true, game: toState(game, user.id) };
  const winner: SudokuSide = side === "HOST" ? "GUEST" : "HOST";
  await commitUpdate(
    game,
    { status: "PLAYING" },
    { status: "FINISHED", winner, finishReason: "FORFEIT", finishedAt: new Date(), ...scoreUpdate(game, winner) }
  );
  const updated = (await prisma.sudokuGame.findUnique({ where: { id: game.id } }))!;
  return { success: true, game: toState(updated, user.id) };
}

export type SudokuLeaderboardEntry = LeaderboardRow & {
  name: string;
  avatarUrl: string | null;
  isMe: boolean;
};

export type SudokuLeaderboard = {
  month: MonthKey;
  currentMonth: MonthKey;
  totalMatches: number;
  rows: SudokuLeaderboardEntry[];
};

/** Bảng xếp hạng số trận thắng online trong một tháng (mặc định tháng hiện tại). */
export async function getSudokuLeaderboard(
  month?: string
): Promise<{ success: boolean; leaderboard?: SudokuLeaderboard; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const currentMonth = monthKeyOf(new Date());
    const key = isMonthKey(month) && month <= currentMonth ? month : currentMonth;
    const { start, end } = monthRange(key);
    const matches = await prisma.sudokuMatch.findMany({
      where: { finishedAt: { gte: start, lt: end } },
      select: { hostUserId: true, guestUserId: true, winnerUserId: true },
    });
    const rows = buildLeaderboard(matches);
    const users = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, name: true, avatarUrl: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      success: true,
      leaderboard: {
        month: key,
        currentMonth,
        totalMatches: matches.length,
        rows: rows.map((r) => ({
          ...r,
          name: byId.get(r.userId)?.name || "Thành viên",
          avatarUrl: byId.get(r.userId)?.avatarUrl ?? null,
          isMe: r.userId === user.id,
        })),
      },
    };
  } catch (error) {
    console.error("Lỗi tải bảng xếp hạng Sudoku:", error);
    return { success: false, error: "Không thể tải bảng xếp hạng." };
  }
}
