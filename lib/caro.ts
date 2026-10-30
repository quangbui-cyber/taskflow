/**
 * Logic cờ Caro 15x15 chuẩn Việt Nam (5 quân liên tiếp)
 */

export const BOARD_SIZE = 15;

export type Player = "X" | "O";
export type Cell = Player | null;
export type Board = Cell[][];

export interface Point {
  r: number;
  c: number;
}

export interface WinResult {
  won: boolean;
  winner: Player | null;
  line: Point[];
}

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

/** 4 hướng kiểm tra: ngang, dọc, chéo chính, chéo phụ */
const DIRECTIONS: [number, number][] = [
  [0, 1],  // ngang
  [1, 0],  // dọc
  [1, 1],  // chéo chính (\)
  [1, -1], // chéo phụ (/)
];

/**
 * Kiểm tra xem nước đi vừa rồi tại (r, c) của `player` có tạo thành chuỗi >= 5 không
 */
export function checkWin(board: Board, r: number, c: number, player: Player): WinResult {
  if (!player || board[r]?.[c] !== player) {
    return { won: false, winner: null, line: [] };
  }

  for (const [dr, dc] of DIRECTIONS) {
    const line: Point[] = [{ r, c }];

    // Đi về hướng dương
    let step = 1;
    while (true) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
      if (board[nr][nc] === player) {
        line.push({ r: nr, c: nc });
        step++;
      } else {
        break;
      }
    }

    // Đi về hướng âm
    step = 1;
    while (true) {
      const nr = r - dr * step;
      const nc = c - dc * step;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
      if (board[nr][nc] === player) {
        line.unshift({ r: nr, c: nc });
        step++;
      } else {
        break;
      }
    }

    // Đạt 5 quân liên tiếp trở lên -> Thắng
    if (line.length >= 5) {
      return { won: true, winner: player, line };
    }
  }

  return { won: false, winner: null, line: [] };
}

/** Kiểm tra bàn cờ đã kín ô chưa (Hòa) */
export function isBoardFull(board: Board): boolean {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === null) return false;
    }
  }
  return true;
}

/** Đánh giá chuỗi theo 1 hướng cho 1 người chơi */
function evaluateDirection(
  board: Board,
  r: number,
  c: number,
  dr: number,
  dc: number,
  player: Player
): number {
  let count = 1;
  let openEnds = 0;

  // Hướng dương
  let step = 1;
  while (true) {
    const nr = r + dr * step;
    const nc = c + dc * step;
    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
    if (board[nr][nc] === player) {
      count++;
      step++;
    } else if (board[nr][nc] === null) {
      openEnds++;
      break;
    } else {
      // Bị chặn bởi quân đối phương
      break;
    }
  }

  // Hướng âm
  step = 1;
  while (true) {
    const nr = r - dr * step;
    const nc = c - dc * step;
    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
    if (board[nr][nc] === player) {
      count++;
      step++;
    } else if (board[nr][nc] === null) {
      openEnds++;
      break;
    } else {
      break;
    }
  }

  if (count >= 5) return 100_000;
  if (count === 4) {
    if (openEnds === 2) return 10_000;
    if (openEnds === 1) return 2_500;
  }
  if (count === 3) {
    if (openEnds === 2) return 1_200;
    if (openEnds === 1) return 200;
  }
  if (count === 2) {
    if (openEnds === 2) return 100;
    if (openEnds === 1) return 10;
  }
  return 1;
}

/**
 * Tìm nước đi tối ưu cho AI (quân O hoặc X)
 * @param board Bàn cờ hiện tại
 * @param aiPlayer Quân của AI (thường là 'O')
 * @param difficulty 'easy' | 'hard'
 */
export function getAiMove(board: Board, aiPlayer: Player = "O", difficulty: "easy" | "hard" = "hard"): Point | null {
  const humanPlayer: Player = aiPlayer === "X" ? "O" : "X";

  // Kiểm tra nếu bàn cờ hoàn toàn trống -> đánh vào giữa bàn cờ (7, 7)
  let isEmpty = true;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) {
        isEmpty = false;
        break;
      }
    }
    if (!isEmpty) break;
  }
  if (isEmpty) {
    return { r: 7, c: 7 };
  }

  const candidates: { r: number; c: number; score: number }[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== null) continue;

      // Tối ưu tốc độ: chỉ xét các ô có quân lân cận trong bán kính 2 ô
      let hasNeighbor = false;
      for (let dr = -2; dr <= 2 && !hasNeighbor; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr][nc] !== null) {
            hasNeighbor = true;
            break;
          }
        }
      }
      if (!hasNeighbor) continue;

      // Điểm tấn công của AI
      let attackScore = 0;
      for (const [dr, dc] of DIRECTIONS) {
        attackScore += evaluateDirection(board, r, c, dr, dc, aiPlayer);
      }

      // Điểm phòng thủ (chặn người chơi)
      let defenseScore = 0;
      for (const [dr, dc] of DIRECTIONS) {
        defenseScore += evaluateDirection(board, r, c, dr, dc, humanPlayer);
      }

      // AI ưu tiên phòng thủ nếu đối thủ sắp thắng, nhưng nếu AI có thể thắng ngay thì tấn công
      let totalScore = attackScore + defenseScore * 1.1;

      // Ưu tiên ô gần trung tâm hơn một chút
      const distFromCenter = Math.abs(r - 7) + Math.abs(c - 7);
      totalScore += (14 - distFromCenter) * 2;

      candidates.push({ r, c, score: totalScore });
    }
  }

  if (candidates.length === 0) return null;

  // Sắp xếp điểm từ cao xuống thấp
  candidates.sort((a, b) => b.score - a.score);

  if (difficulty === "easy") {
    // Chế độ dễ: ngẫu nhiên trong top 3 nước đi tốt nhất
    const topCandidates = candidates.slice(0, Math.min(3, candidates.length));
    const chosen = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    return { r: chosen.r, c: chosen.c };
  }

  // Chế độ khó: chọn nước đi có điểm cao nhất
  return { r: candidates[0].r, c: candidates[0].c };
}
