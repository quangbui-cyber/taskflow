"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkWin, createEmptyBoard, isBoardFull, type Board, type Player, type Point } from "@/lib/caro";

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
  status: "WAITING" | "PLAYING" | "FINISHED";
  scoreX: number;
  scoreO: number;
  updatedAt: string;
};

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
    status: (game.status as "WAITING" | "PLAYING" | "FINISHED") || "WAITING",
    scoreX: game.scoreX,
    scoreO: game.scoreO,
    updatedAt: game.updatedAt ? game.updatedAt.toISOString() : new Date().toISOString(),
  };
}

/** Tạo phòng chơi mới */
export async function createOnlineGame(playerName: string): Promise<{ success: boolean; code?: string; game?: OnlineGameState; error?: string }> {
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

    const cleanName = (playerName || "Kỳ thủ X").trim().slice(0, 30);
    const emptyBoard = createEmptyBoard();

    const game = await prisma.caroGame.create({
      data: {
        code,
        playerXName: cleanName,
        boardState: emptyBoard,
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
export async function joinOnlineGame(code: string, playerName: string): Promise<{ success: boolean; game?: OnlineGameState; role?: Player; error?: string }> {
  try {
    const cleanCode = (code || "").trim().toUpperCase();
    const game = await prisma.caroGame.findUnique({ where: { code: cleanCode } });

    if (!game) {
      return { success: false, error: "Không tìm thấy phòng chơi này. Hãy kiểm tra lại mã phòng." };
    }

    const cleanName = (playerName || "Kỳ thủ O").trim().slice(0, 30);

    // Nếu người chơi là chủ phòng
    if (game.playerXName === cleanName) {
      return { success: true, game: formatGameState(game), role: "X" };
    }

    // Nếu phòng chưa có người chơi thứ 2
    if (!game.playerOName) {
      // Ván đầu tiên: Bốc thăm ngẫu nhiên người đi đầu (50/50 X hoặc O)
      const randomFirstTurn: Player = Math.random() < 0.5 ? "X" : "O";
      const updated = await prisma.caroGame.update({
        where: { id: game.id },
        data: {
          playerOName: cleanName,
          status: "PLAYING",
          turn: randomFirstTurn,
        },
      });
      return { success: true, game: formatGameState(updated), role: "O" };
    }

    // Nếu người chơi thứ 2 đã vào trước đó
    if (game.playerOName === cleanName) {
      return { success: true, game: formatGameState(game), role: "O" };
    }

    // Phòng đã đủ 2 người
    return { success: true, game: formatGameState(game), role: "X" };
  } catch (error) {
    console.error("Lỗi vào phòng Caro:", error);
    return { success: false, error: "Không thể vào phòng lúc này." };
  }
}

/** Lấy trạng thái bàn cờ hiện tại */
export async function getOnlineGame(code: string): Promise<{ success: boolean; game?: OnlineGameState; error?: string }> {
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

/** Đánh một nước đi */
export async function makeOnlineMove(
  code: string,
  r: number,
  c: number,
  player: Player
): Promise<{ success: boolean; game?: OnlineGameState; error?: string }> {
  try {
    const cleanCode = (code || "").trim().toUpperCase();
    const game = await prisma.caroGame.findUnique({ where: { code: cleanCode } });

    if (!game) {
      return { success: false, error: "Phòng không tồn tại." };
    }

    if (game.status === "FINISHED") {
      return { success: false, error: "Ván đấu đã kết thúc." };
    }

    if (game.turn !== player) {
      return { success: false, error: "Chưa tới lượt của bạn." };
    }

    const board = (game.boardState as Board) || createEmptyBoard();
    if (board[r]?.[c] !== null) {
      return { success: false, error: "Ô này đã có quân cờ." };
    }

    // Đặt quân cờ
    board[r][c] = player;
    const winResult = checkWin(board, r, c, player);

    let nextStatus = game.status;
    let nextWinner = null;
    let nextWinningLine = null;
    let newScoreX = game.scoreX;
    let newScoreO = game.scoreO;

    if (winResult.won) {
      nextStatus = "FINISHED";
      nextWinner = player;
      nextWinningLine = winResult.line;
      if (player === "X") newScoreX += 1;
      else newScoreO += 1;
    } else if (isBoardFull(board)) {
      nextStatus = "FINISHED";
      nextWinner = "DRAW";
    }

    const nextTurn: Player = player === "X" ? "O" : "X";

    const updated = await prisma.caroGame.update({
      where: { id: game.id },
      data: {
        boardState: board,
        lastMove: { r, c },
        turn: nextTurn,
        status: nextStatus,
        winner: nextWinner,
        winningLine: nextWinningLine ? (nextWinningLine as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        scoreX: newScoreX,
        scoreO: newScoreO,
      },
    });

    return { success: true, game: formatGameState(updated) };
  } catch (error) {
    console.error("Lỗi đánh nước đi Caro:", error);
    return { success: false, error: "Không thể thực hiện nước đi." };
  }
}

/** Bắt đầu ván mới (tái đấu: người thua ván trước được quyền đi trước) */
export async function resetOnlineGame(code: string): Promise<{ success: boolean; game?: OnlineGameState; error?: string }> {
  try {
    const cleanCode = (code || "").trim().toUpperCase();
    const game = await prisma.caroGame.findUnique({ where: { code: cleanCode } });

    if (!game) {
      return { success: false, error: "Phòng không tồn tại." };
    }

    // Quy tắc: Nếu ván trước có người thua -> Người thua được đi trước ván này.
    // Nếu hòa hoặc ván đầu: Bốc thăm ngẫu nhiên 50/50.
    let nextFirstTurn: Player;
    if (game.winner === "X") {
      nextFirstTurn = "O"; // X thắng thì O (thua) được đi trước
    } else if (game.winner === "O") {
      nextFirstTurn = "X"; // O thắng thì X (thua) được đi trước
    } else {
      nextFirstTurn = Math.random() < 0.5 ? "X" : "O";
    }

    const emptyBoard = createEmptyBoard();
    const updated = await prisma.caroGame.update({
      where: { id: game.id },
      data: {
        boardState: emptyBoard,
        lastMove: Prisma.JsonNull,
        turn: nextFirstTurn,
        status: game.playerOName ? "PLAYING" : "WAITING",
        winner: null,
        winningLine: Prisma.JsonNull,
      },
    });

    return { success: true, game: formatGameState(updated) };
  } catch {
    return { success: false, error: "Không thể làm mới bàn cờ." };
  }
}

/** Xử lý khi người chơi hết 15s đếm giờ (xử thua người hết giờ, người kia thắng) */
export async function handleOnlineTimeout(
  code: string,
  timedOutPlayer: Player
): Promise<{ success: boolean; game?: OnlineGameState; error?: string }> {
  try {
    const cleanCode = (code || "").trim().toUpperCase();
    const game = await prisma.caroGame.findUnique({ where: { code: cleanCode } });

    if (!game || game.status !== "PLAYING" || game.turn !== timedOutPlayer) {
      return { success: false, error: "Trạng thái không hợp lệ." };
    }

    const winner: Player = timedOutPlayer === "X" ? "O" : "X";
    const newScoreX = winner === "X" ? game.scoreX + 1 : game.scoreX;
    const newScoreO = winner === "O" ? game.scoreO + 1 : game.scoreO;

    const updated = await prisma.caroGame.update({
      where: { id: game.id },
      data: {
        status: "FINISHED",
        winner,
        winningLine: Prisma.JsonNull,
        scoreX: newScoreX,
        scoreO: newScoreO,
      },
    });

    return { success: true, game: formatGameState(updated) };
  } catch (error) {
    console.error("Lỗi xử lý timeout Caro:", error);
    return { success: false, error: "Không thể xử lý hết giờ." };
  }
}
