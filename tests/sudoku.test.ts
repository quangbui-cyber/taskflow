import test from "node:test";
import assert from "node:assert/strict";
import {
  CELLS,
  DIFFICULTIES,
  canPlace,
  countClues,
  countCorrect,
  countSolutions,
  formatClock,
  generatePuzzle,
  isSolved,
  pickHintCell,
  remainingCounts,
  solve,
} from "../lib/sudoku";

function isValidSolution(grid: number[]): boolean {
  if (grid.length !== CELLS) return false;
  for (let i = 0; i < CELLS; i++) {
    const n = grid[i];
    if (n < 1 || n > 9) return false;
    const copy = [...grid];
    copy[i] = 0;
    if (!canPlace(copy, i, n)) return false;
  }
  return true;
}

test("sudoku: every difficulty yields a valid, uniquely solvable puzzle", () => {
  for (const difficulty of DIFFICULTIES) {
    const { puzzle, solution } = generatePuzzle(difficulty);
    assert.ok(isValidSolution(solution), `${difficulty}: solution is valid`);
    assert.equal(countSolutions(puzzle, 2), 1, `${difficulty}: unique solution`);
    puzzle.forEach((n, i) => {
      if (n !== 0) assert.equal(n, solution[i]);
    });
    assert.deepEqual(solve(puzzle), solution);
  }
});

test("sudoku: harder puzzles keep fewer clues", () => {
  const easy = countClues(generatePuzzle("easy").puzzle);
  const hard = countClues(generatePuzzle("hard").puzzle);
  assert.ok(easy >= 39, `easy has ${easy} clues`);
  assert.ok(hard < easy, `hard (${hard}) < easy (${easy})`);
});

test("sudoku: progress helpers", () => {
  const { puzzle, solution } = generatePuzzle("medium");
  assert.equal(isSolved(puzzle, solution), false);
  assert.equal(isSolved(solution, solution), true);
  assert.equal(countCorrect(solution, solution), CELLS);
  assert.equal(countCorrect(puzzle, solution), countClues(puzzle));
  const counts = remainingCounts(solution, solution);
  for (let n = 1; n <= 9; n++) assert.equal(counts[n], 0);
});

test("sudoku: hint picks the selected wrong cell, else an empty one", () => {
  const { puzzle, solution } = generatePuzzle("easy");
  const empty = puzzle.findIndex((n) => n === 0);
  const values = [...puzzle];
  values[empty] = solution[empty] === 9 ? 1 : 9;
  assert.equal(pickHintCell(values, solution, empty), empty);
  const auto = pickHintCell(puzzle, solution, null);
  assert.ok(auto !== null && puzzle[auto] === 0);
  assert.equal(pickHintCell(solution, solution, null), null);
});

test("sudoku: formatClock", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(65), "01:05");
  assert.equal(formatClock(-3), "00:00");
});
