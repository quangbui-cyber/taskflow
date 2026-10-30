// Logic Sudoku 9x9: sinh đề có lời giải duy nhất, kiểm tra đáp án, gợi ý.
// Bàn cờ lưu dạng mảng 81 số (hàng theo hàng), 0 = ô trống.

export type Grid = number[];
export type SudokuDifficulty = "easy" | "medium" | "hard" | "expert";

export const SIZE = 9;
export const CELLS = 81;
export const MAX_MISTAKES = 3;
export const MAX_HINTS = 3;

export const DIFFICULTIES: SudokuDifficulty[] = ["easy", "medium", "hard", "expert"];

export const DIFFICULTY_LABEL: Record<SudokuDifficulty, string> = {
  easy: "Dễ",
  medium: "Vừa",
  hard: "Khó",
  expert: "Chuyên gia",
};

/** Số ô gợi sẵn mục tiêu cho từng độ khó. */
const TARGET_CLUES: Record<SudokuDifficulty, number> = {
  easy: 40,
  medium: 32,
  hard: 27,
  expert: 24,
};

/** Giới hạn thời gian (giây) khi bật đếm giờ. */
export const TIME_LIMIT_SEC: Record<SudokuDifficulty, number> = {
  easy: 15 * 60,
  medium: 15 * 60,
  hard: 25 * 60,
  expert: 40 * 60,
};

export function isDifficulty(value: unknown): value is SudokuDifficulty {
  return typeof value === "string" && (DIFFICULTIES as string[]).includes(value);
}

export const rowOf = (i: number) => Math.floor(i / SIZE);
export const colOf = (i: number) => i % SIZE;
export const boxOf = (i: number) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

/** 20 ô cùng hàng, cột hoặc khối với ô i. */
const PEERS: number[][] = Array.from({ length: CELLS }, (_, i) => {
  const peers: number[] = [];
  for (let j = 0; j < CELLS; j++) {
    if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) {
      peers.push(j);
    }
  }
  return peers;
});

export function peersOf(i: number): number[] {
  return PEERS[i];
}

export function canPlace(grid: Grid, i: number, n: number): boolean {
  for (const p of PEERS[i]) if (grid[p] === n) return false;
  return true;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Chọn ô trống có ít ứng viên nhất (giúp giải nhanh). */
function pickCell(grid: Grid): { index: number; options: number[] } | null {
  let best: { index: number; options: number[] } | null = null;
  for (let i = 0; i < CELLS; i++) {
    if (grid[i] !== 0) continue;
    const options: number[] = [];
    for (let n = 1; n <= 9; n++) if (canPlace(grid, i, n)) options.push(n);
    if (!best || options.length < best.options.length) {
      best = { index: i, options };
      if (options.length <= 1) break;
    }
  }
  return best;
}

/** Đếm số lời giải, dừng khi đạt `limit`. */
export function countSolutions(input: Grid, limit = 2): number {
  const grid = [...input];
  let count = 0;
  const walk = () => {
    if (count >= limit) return;
    const cell = pickCell(grid);
    if (!cell) {
      count++;
      return;
    }
    for (const n of cell.options) {
      grid[cell.index] = n;
      walk();
      grid[cell.index] = 0;
      if (count >= limit) return;
    }
  };
  walk();
  return count;
}

export function solve(input: Grid): Grid | null {
  const grid = [...input];
  const walk = (): boolean => {
    const cell = pickCell(grid);
    if (!cell) return true;
    for (const n of cell.options) {
      grid[cell.index] = n;
      if (walk()) return true;
    }
    grid[cell.index] = 0;
    return false;
  };
  return walk() ? grid : null;
}

function generateSolved(rng: () => number): Grid {
  const grid: Grid = new Array(CELLS).fill(0);
  const walk = (): boolean => {
    const cell = pickCell(grid);
    if (!cell) return true;
    for (const n of shuffle(cell.options, rng)) {
      grid[cell.index] = n;
      if (walk()) return true;
    }
    grid[cell.index] = 0;
    return false;
  };
  walk();
  return grid;
}

export type SudokuPuzzle = {
  puzzle: Grid;
  solution: Grid;
  difficulty: SudokuDifficulty;
};

/** Sinh đề mới: xoá dần từng cặp ô đối xứng, chỉ giữ thay đổi nếu đề vẫn có 1 lời giải. */
export function generatePuzzle(difficulty: SudokuDifficulty, rng: () => number = Math.random): SudokuPuzzle {
  const target = TARGET_CLUES[difficulty];
  // Đề khó đôi khi không xoá được tới mục tiêu: thử vài lần, giữ đề ít gợi ý nhất.
  const attempts = difficulty === "expert" ? 8 : difficulty === "hard" ? 4 : 1;
  let best: SudokuPuzzle | null = null;
  for (let a = 0; a < attempts; a++) {
    const solution = generateSolved(rng);
    const puzzle = carve(solution, target, rng);
    if (!best || countClues(puzzle) < countClues(best.puzzle)) best = { puzzle, solution, difficulty };
    if (countClues(puzzle) <= target) break;
  }
  return best!;
}

/** Xoá ô theo cặp đối xứng trước cho đề đẹp, sau đó xoá lẻ từng ô. */
function carve(solution: Grid, target: number, rng: () => number): Grid {
  const puzzle = [...solution];
  let clues = CELLS;
  const order = shuffle(Array.from({ length: CELLS }, (_, k) => k), rng);

  const tryRemove = (cells: number[]) => {
    const backup = cells.map((k) => puzzle[k]);
    cells.forEach((k) => (puzzle[k] = 0));
    if (countSolutions(puzzle, 2) === 1) {
      clues -= cells.length;
    } else {
      cells.forEach((k, idx) => (puzzle[k] = backup[idx]));
    }
  };

  for (const i of order) {
    if (clues <= target) return puzzle;
    const mirror = CELLS - 1 - i;
    if (puzzle[i] === 0) continue;
    tryRemove(mirror !== i && puzzle[mirror] !== 0 ? [i, mirror] : [i]);
  }
  for (const i of order) {
    if (clues <= target) return puzzle;
    if (puzzle[i] !== 0) tryRemove([i]);
  }
  return puzzle;
}

export function countClues(grid: Grid): number {
  return grid.filter((n) => n !== 0).length;
}

/** Ván đã giải xong khi mọi ô trùng với lời giải. */
export function isSolved(values: Grid, solution: Grid): boolean {
  for (let i = 0; i < CELLS; i++) if (values[i] !== solution[i]) return false;
  return true;
}

/** Số ô đã điền đúng (kể cả đề), dùng cho thanh tiến độ. */
export function countCorrect(values: Grid, solution: Grid): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (values[i] !== 0 && values[i] === solution[i]) n++;
  return n;
}

/** Mỗi số còn thiếu bao nhiêu lần (chỉ tính ô đúng). */
export function remainingCounts(values: Grid, solution: Grid): Record<number, number> {
  const counts: Record<number, number> = {};
  for (let n = 1; n <= 9; n++) counts[n] = 9;
  for (let i = 0; i < CELLS; i++) {
    if (values[i] !== 0 && values[i] === solution[i]) counts[values[i]]--;
  }
  return counts;
}

/** Ô nên gợi ý: ô đang chọn nếu còn trống/sai, nếu không thì ô trống có ít ứng viên nhất. */
export function pickHintCell(values: Grid, solution: Grid, selected: number | null): number | null {
  if (selected !== null && values[selected] !== solution[selected]) return selected;
  const working = values.map((v, i) => (v === solution[i] ? v : 0));
  const cell = pickCell(working);
  return cell ? cell.index : null;
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
