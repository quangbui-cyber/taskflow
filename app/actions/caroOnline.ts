"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { loadLeaderboard } from "@/lib/gameLeaderboardData";
import type { GameLeaderboard } from "@/lib/gameLeaderboard";
import { BOARD_SIZE, checkWin, createEmptyBoard, isBoardFull, type Board, type Player, type Point } from "@/lib/caro";

/** Máy chủ chấp nhận báo hết giờ khi lượt đã kéo dài từng này (15 giây, trừ độ trễ mạng). */
const TIMEOUT_AFTER_MS = 14_000;
const LOGIN_ERROR = "Bạn cần đăng nhập để chơi online.";

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "CR";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export type OnlineGameState = {
  id: string;
  code: string;
  playerXName: string;
  playerOName: string | null;
  board: Board;
  lastMove: Point | null;
  turn: Player;
  winner: Player | "DRAW" | null;
  winningLine: Point[];
  status: "WAITING" | "READY" | "PLAYING" | "FINISHED";
  scoreX: number;
  scoreO: number;
  updatedAt: string;
};

type Row = NonNullable<Awaited<ReturnType<typeof prisma.caroGame.findUnique>>>;
type Result = { success: boolean; game?: OnlineGameState; error?: string };

function formatGameState(game: {
  id: string;
  code: string;
  playerXName: string;
  playerOName: string | null;
  boardState: unknown;
  lastMove: unknown;
  turn: string;
  winner: string | null;
  winningLine: unknown;
  status: string;
  scoreX: number;
  scoreO: number;
  updatedAt?: Date;
}): OnlineGameState {
  return {
    id: game.id,
    code: game.code,
    playerXName: game.playerXName,
    playerOName: game.playerOName,
    board: (game.boardState as Board) || createEmptyBoard(),
    lastMove: (game.lastMove as Point | null) || null,
    turn: (game.turn as Player) || "X",
    winner: (game.winner as Player | "DRAW" | null) || null,
    winningLine: (game.winningLine as Point[]) || [],
    status: (game.status as "WAITING" | "READY" | "PLAYING" | "FINISHED") || "WAITING",
    scoreX: game.scoreX,
    scoreO: game.scoreO,
    updatedAt: game.updatedAt ? game.updatedAt.toISOString() : new Date().toISOString(),
  };
}

/** X là chủ phòng, O là người vào sau. Người ngoài phòng không có vai. */
function roleOf(game: Row, userId: string): Player | null {
  if (game.hostUserId === userId) return "X";
  if (game.guestUserId === userId) return "O";
  return null;
}

type GameWhere = Parameters<typeof prisma.caroGame.updateMany>[0]["where"];
type GameData = Parameters<typeof prisma.caroGame.updateMany>[0]["data"];

/**
 * Ghi cập nhật có điều kiện. Nếu cập nhật này kết thúc ván thì lưu luôn kết quả trận cho
 * bảng xếp hạng trong cùng một giao dịch, nên mỗi ván chỉ được ghi đúng một lần.
 */
async function commitUpdate(game: Row, where: GameWhere, data: GameData, finishReason?: "FIVE" | "TIMEOUT" | "DRAW") {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.caroGame.updateMany({ where: { ...where, id: game.id }, data });
    if (count && data.status === "FINISHED" && finishReason && game.hostUserId && game.guestUserId) {
      const winner = data.winner as Player | "DRAW";
      await tx.caroMatch.create({
        data: {
          roomCode: game.code,
          hostUserId: game.hostUserId,
          guestUserId: game.guestUserId,
          winnerUserId: winner === "X" ? game.hostUserId : winner === "O" ? game.guestUserId : null,
          finishReason,
          durationSec: Math.max(0, Math.round((Date.now() - (game.startedAt ?? game.createdAt).getTime()) / 1000)),
        },
      });
    }
    return count;
  });
}

/** Tạo phòng chơi mới. Người tạo là quân X. */
export async function createOnlineGame(): Promise<Result & { code?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    let code = generateRoomCode();
    // Đảm bảo không trùng mã phòng
    let exists = await prisma.caroGame.findUnique({ where: { code } });
    let attempts = 0;
    while (exists && attempts < 5) {
      code = generateRoomCode();
      exists = await prisma.caroGame.findUnique({ where: { code } });
      attempts++;
    }

    const game = await prisma.caroGame.create({
      data: {
        code,
        playerXName: (user.name || "Kỳ thủ X").trim().slice(0, 30),
        hostUserId: user.id,
        boardState: createEmptyBoard(),
        status: "WAITING",
        turn: "X",
      },
    });

    return { success: true, code, game: formatGameState(game) };
  } catch (error) {
    console.error("Lỗi tạo phòng Caro:", error);
    return { success: false, error: "Không thể tạo phòng chơi lúc này." };
  }
}

/** Tham gia vào phòng chơi bằng mã phòng */
export async function joinOnlineGame(code: string): Promise<Result & { role?: Player }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const cleanCode = (code || "").trim().toUpperCase();
    const game = await prisma.caroGame.findUnique({ where: { code: cleanCode } });

    if (!game) {
      return { success: false, error: "Không tìm thấy phòng chơi này. Hãy kiểm tra lại mã phòng." };
    }
    if (!game.hostUserId) {
      return { success: false, error: "Phòng này tạo từ phiên bản cũ. Hãy tạo phòng mới." };
    }

    const existing = roleOf(game, user.id);
    if (existing) return { success: true, game: formatGameState(game), role: existing };

    if (game.guestUserId) return { success: false, error: "Phòng đã đủ 2 người." };

    // Hai người vào cùng lúc: chỉ người đến trước được giữ chỗ.
    const { count } = await prisma.caroGame.updateMany({
      where: { id: game.id, guestUserId: null },
      data: { guestUserId: user.id, playerOName: (user.name || "Kỳ thủ O").trim().slice(0, 30), status: "READY" },
    });
    if (!count) return { success: false, error: "Phòng vừa có người khác vào." };
    const updated = (await prisma.caroGame.findUnique({ where: { id: game.id } }))!;
    return { success: true, game: formatGameState(updated), role: "O" };
  } catch (error) {
    console.error("Lỗi vào phòng Caro:", error);
    return { success: false, error: "Không thể vào phòng lúc này." };
  }
}

/** Lấy trạng thái bàn cờ hiện tại */
export async function getOnlineGame(code: string): Promise<Result> {
  try {
    const cleanCode = (code || "").trim().toUpperCase();
    const game = await prisma.caroGame.findUnique({ where: { code: cleanCode } });
    if (!game) {
      return { success: false, error: "Phòng không tồn tại." };
    }
    return { success: true, game: formatGameState(game) };
  } catch {
    return { success: false, error: "Không thể tải trạng thái phòng." };
  }
}

/** Đánh một nước đi. Vai quân do máy chủ xác định từ tài khoản đăng nhập. */
export async function makeOnlineMove(code: string, r: number, c: number): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const cleanCode = (code || "").trim().toUpperCase();
    const game = await prisma.caroGame.findUnique({ where: { code: cleanCode } });

    if (!game) return { success: false, error: "Phòng không tồn tại." };
    const player = roleOf(game, user.id);
    if (!player) return { success: false, error: "Bạn không ở trong phòng này." };
    if (game.status === "FINISHED") return { success: false, error: "Ván đấu đã kết thúc." };
    if (game.status !== "PLAYING") return { success: false, error: "Ván đấu chưa bắt đầu." };
    if (game.turn !== player) return { success: false, error: "Chưa tới lượt của bạn." };

    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) {
      return { success: false, error: "Nước đi không hợp lệ." };
    }
    const board = (game.boardState as Board) || createEmptyBoard();
    if (board[r]?.[c] !== null) {
      return { success: false, error: "Ô này đã có quân cờ." };
    }

    board[r][c] = player;
    const winResult = checkWin(board, r, c, player);

    const data: GameData = {
      boardState: board,
      lastMove: { r, c },
      turn: player === "X" ? "O" : "X",
      turnStartedAt: new Date(),
    };
    let reason: "FIVE" | "DRAW" | undefined;

    if (winResult.won) {
      reason = "FIVE";
      Object.assign(data, {
        status: "FINISHED",
        winner: player,
        winningLine: winResult.line as unknown as Prisma.InputJsonValue,
        scoreX: game.scoreX + (player === "X" ? 1 : 0),
        scoreO: game.scoreO + (player === "O" ? 1 : 0),
      });
    } else if (isBoardFull(board)) {
      reason = "DRAW";
      Object.assign(data, { status: "FINISHED", winner: "DRAW", winningLine: Prisma.JsonNull });
    }

    // Chỉ ghi khi ván chưa đổi từ lúc đọc, tránh hai thao tác ghi đè nhau.
    const count = await commitUpdate(game, { status: "PLAYING", updatedAt: game.updatedAt }, data, reason);
    if (!count) return { success: false, error: "Ván đấu vừa thay đổi. Hãy thử lại." };

    const updated = (await prisma.caroGame.findUnique({ where: { id: game.id } }))!;
    return { success: true, game: formatGameState(updated) };
  } catch (error) {
    console.error("Lỗi đánh nước đi Caro:", error);
    return { success: false, error: "Không thể thực hiện nước đi." };
  }
}

/** Bấm nút Bắt đầu ván chơi khi phòng đã đủ 2 người (hoặc ván mới sau khi kết thúc). */
export async function startOnlineGame(code: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const cleanCode = (code || "").trim().toUpperCase();
    const game = await prisma.caroGame.findUnique({ where: { code: cleanCode } });

    if (!game) return { success: false, error: "Phòng không tồn tại." };
    if (!roleOf(game, user.id)) return { success: false, error: "Bạn không ở trong phòng này." };
    if (!game.guestUserId) return { success: false, error: "Cần đủ 2 người chơi trước khi bắt đầu." };
    // Đang đánh dở thì không làm lại ván: người sắp thua không thể thoát bằng cách bấm Ván mới.
    if (game.status === "PLAYING") return { success: true, game: formatGameState(game) };

    // Quy tắc: Nếu ván trước có người thua -> Người thua được đi trước
    // Nếu ván đầu (chưa có người thắng) hoặc hòa -> Bốc thăm ngẫu nhiên 50/50
    let nextFirstTurn: Player;
    if (game.winner === "X") {
      nextFirstTurn = "O";
    } else if (game.winner === "O") {
      nextFirstTurn = "X";
    } else {
      nextFirstTurn = Math.random() < 0.5 ? "X" : "O";
    }

    const now = new Date();
    // Hai người bấm cùng lúc: lần bấm sau không tạo ván thứ hai.
    await prisma.caroGame.updateMany({
      where: { id: game.id, status: { not: "PLAYING" } },
      data: {
        boardState: createEmptyBoard(),
        lastMove: Prisma.JsonNull,
        turn: nextFirstTurn,
        status: "PLAYING",
        winner: null,
        winningLine: Prisma.JsonNull,
        startedAt: now,
        turnStartedAt: now,
      },
    });

    const updated = (await prisma.caroGame.findUnique({ where: { id: game.id } }))!;
    return { success: true, game: formatGameState(updated) };
  } catch (error) {
    console.error("Lỗi bắt đầu ván chơi:", error);
    return { success: false, error: "Không thể bắt đầu ván chơi." };
  }
}

/** Bắt đầu ván mới (tái đấu: người thua ván trước được quyền đi trước) */
export async function resetOnlineGame(code: string): Promise<Result> {
  return startOnlineGame(code);
}

/**
 * Xử thua người đang tới lượt khi họ hết 15 giây. Máy chủ tự kiểm tra đồng hồ,
 * nên không ai báo hết giờ sớm được để ăn thắng.
 */
export async function handleOnlineTimeout(code: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const cleanCode = (code || "").trim().toUpperCase();
    const game = await prisma.caroGame.findUnique({ where: { code: cleanCode } });

    if (!game || !roleOf(game, user.id)) return { success: false, error: "Trạng thái không hợp lệ." };
    if (game.status !== "PLAYING") return { success: false, error: "Trạng thái không hợp lệ." };

    const turnStartedAt = game.turnStartedAt ?? game.updatedAt;
    if (Date.now() - turnStartedAt.getTime() < TIMEOUT_AFTER_MS) {
      return { success: false, error: "Chưa hết giờ." };
    }

    const timedOut = game.turn as Player;
    const winner: Player = timedOut === "X" ? "O" : "X";
    const count = await commitUpdate(
      game,
      { status: "PLAYING", updatedAt: game.updatedAt },
      {
        status: "FINISHED",
        winner,
        winningLine: Prisma.JsonNull,
        scoreX: game.scoreX + (winner === "X" ? 1 : 0),
        scoreO: game.scoreO + (winner === "O" ? 1 : 0),
      },
      "TIMEOUT"
    );
    if (!count) return { success: false, error: "Ván đấu vừa thay đổi." };

    const updated = (await prisma.caroGame.findUnique({ where: { id: game.id } }))!;
    return { success: true, game: formatGameState(updated) };
  } catch (error) {
    console.error("Lỗi xử lý timeout Caro:", error);
    return { success: false, error: "Không thể xử lý hết giờ." };
  }
}

/** Bảng xếp hạng số trận thắng Caro online trong một tháng (mặc định tháng hiện tại). */
export async function getCaroLeaderboard(
  month?: string
): Promise<{ success: boolean; leaderboard?: GameLeaderboard; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: LOGIN_ERROR };
  try {
    const leaderboard = await loadLeaderboard(
      ({ start, end }) =>
        prisma.caroMatch.findMany({
          where: { finishedAt: { gte: start, lt: end } },
          select: { hostUserId: true, guestUserId: true, winnerUserId: true },
        }),
      user.id,
      month
    );
    return { success: true, leaderboard };
  } catch (error) {
    console.error("Lỗi tải bảng xếp hạng Caro:", error);
    return { success: false, error: "Không thể tải bảng xếp hạng." };
  }
}
