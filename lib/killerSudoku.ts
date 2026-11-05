import { CELLS, boxOf, colOf, generateSolved, rowOf, type Grid, type SudokuDifficulty } from "./sudoku";

export type SudokuVariant = "classic" | "killer";
export type KillerCage = { cells: number[]; sum: number };
export const VARIANT_LABEL = { classic: "Sudoku thường", killer: "Killer Sudoku" };
export const isSudokuVariant = (value: unknown): value is SudokuVariant => value === "classic" || value === "killer";

// All distinct-digit combinations, indexed by cell count and target sum.
const combinations = new Map<string, number[]>();
for (let mask = 2; mask < 1024; mask += 2) {
  let size = 0, sum = 0;
  for (let n = 1; n <= 9; n++) if (mask & (1 << n)) { size++; sum += n; }
  const key = `${size}:${sum}`;
  combinations.set(key, [...(combinations.get(key) ?? []), mask]);
}

export function isKillerCages(value: unknown): value is KillerCage[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set<number>();
  for (const cage of value) {
    if (!cage || !Array.isArray(cage.cells) || !Number.isInteger(cage.sum) ||
        !combinations.has(`${cage.cells.length}:${cage.sum}`)) return false;
    for (const i of cage.cells) {
      if (!Number.isInteger(i) || i < 0 || i >= CELLS || seen.has(i)) return false;
      seen.add(i);
    }
    const connected = new Set<number>([cage.cells[0]]);
    for (let pass = 0; pass < cage.cells.length; pass++) {
      for (const i of cage.cells) if (cage.cells.some((j: number) => connected.has(j) && adjacent(i, j))) connected.add(i);
    }
    if (connected.size !== cage.cells.length) return false;
  }
  return seen.size === CELLS;
}

const adjacent = (a: number, b: number) => Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b)) === 1;

/** Counts up to two solutions. Budget exhaustion is conservative: never report uniqueness. */
export function countKillerSolutions(cages: KillerCage[], nodeBudget = 20_000): number {
  if (!isKillerCages(cages)) return 0;
  const grid = new Array<number>(CELLS).fill(0);
  const rows = new Array<number>(9).fill(0), cols = [...rows], boxes = [...rows];
  const used = new Array<number>(cages.length).fill(0);
  const cageOf = new Array<number>(CELLS);
  cages.forEach((cage, k) => cage.cells.forEach((i) => { cageOf[i] = k; }));
  const combos = cages.map((c) => combinations.get(`${c.cells.length}:${c.sum}`)!);
  let count = 0, nodes = 0, exhausted = false;
  const walk = () => {
    if (count >= 2 || exhausted) return;
    if (++nodes > nodeBudget) { exhausted = true; return; }
    const allowed = combos.map((options, k) => options.reduce((mask, option) =>
      (option & used[k]) === used[k] ? mask | option : mask, 0) & ~used[k]);
    let best = -1, bestMask = 0, min = 10;
    for (let i = 0; i < CELLS; i++) {
      if (grid[i]) continue;
      const mask = allowed[cageOf[i]] & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      let size = 0;
      for (let bits = mask; bits; bits &= bits - 1) size++;
      if (!size) return;
      if (size < min) { best = i; bestMask = mask; min = size; }
    }
    if (best === -1) { count++; return; }
    const r = rowOf(best), c = colOf(best), b = boxOf(best), k = cageOf[best];
    for (let n = 1; n <= 9; n++) {
      const bit = 1 << n;
      if (!(bestMask & bit)) continue;
      grid[best] = n; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit; used[k] |= bit;
      walk();
      grid[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit; used[k] &= ~bit;
      if (count >= 2 || exhausted) return;
    }
  };
  walk();
  return exhausted ? 2 : count;
}

/** Start with singleton cages; merge connected cages only while uniqueness is proven. */
export function generateKillerPuzzle(difficulty: SudokuDifficulty, rng: () => number = Math.random) {
  const solution = generateSolved(rng);
  let cages: KillerCage[] = solution.map((sum, i) => ({ cells: [i], sum }));
  const target = { easy: 44, medium: 39, hard: 34, expert: 29 }[difficulty];
  const edges: [number, number][] = [];
  for (let i = 0; i < CELLS; i++) {
    if (colOf(i) < 8) edges.push([i, i + 1]);
    if (rowOf(i) < 8) edges.push([i, i + 9]);
  }
  for (let pass = 0; pass < 2 && cages.length > target; pass++) {
    for (let i = edges.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [edges[i], edges[j]] = [edges[j], edges[i]];
    }
    for (const [a, b] of edges) {
      if (cages.length <= target) break;
      const left = cages.find((c) => c.cells.includes(a))!;
      const right = cages.find((c) => c.cells.includes(b))!;
      if (left === right || left.cells.length + right.cells.length > 5) continue;
      const cells = [...left.cells, ...right.cells].sort((a, b) => a - b);
      if (new Set(cells.map((i) => solution[i])).size !== cells.length) continue;
      const merged = [...cages.filter((c) => c !== left && c !== right), { cells, sum: left.sum + right.sum }];
      if (countKillerSolutions(merged, 2_000) === 1) cages = merged;
    }
  }
  return { puzzle: new Array<number>(CELLS).fill(0), solution, cages, difficulty };
}

export function cageProgress(cage: KillerCage, values: Grid) {
  const digits = cage.cells.map((i) => values[i]).filter(Boolean);
  const sum = digits.reduce((a, b) => a + b, 0);
  const options = combinations.get(`${cage.cells.length}:${cage.sum}`) ?? [];
  const mask = digits.reduce((m, n) => m | (1 << n), 0);
  const invalid = new Set(digits).size !== digits.length || !options.some((option) => (option & mask) === mask);
  return { sum, remaining: cage.sum - sum, empty: cage.cells.length - digits.length, invalid };
}

export function clearKillerPeerNotes(notes: number[], index: number, digit: number, cages: KillerCage[]) {
  const next = [...notes];
  const cage = cages.find((c) => c.cells.includes(index));
  cage?.cells.forEach((i) => { next[i] &= ~(1 << digit); });
  return next;
}
