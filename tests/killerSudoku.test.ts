import test from "node:test";
import assert from "node:assert/strict";
import { DIFFICULTIES, canPlace, generateSolved } from "../lib/sudoku";
import { cageProgress, clearKillerPeerNotes, countKillerSolutions, generateKillerPuzzle, isKillerCages } from "../lib/killerSudoku";

function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

test("killer: every level produces an empty board with connected, distinct-digit cages and one solution", () => {
  for (const [level, difficulty] of DIFFICULTIES.entries()) {
    for (let sample = 0; sample < 3; sample++) {
      const { puzzle, solution, cages } = generateKillerPuzzle(difficulty, seeded(42 + level * 100 + sample));
      assert.equal(puzzle.length, 81);
      assert.ok(puzzle.every((v) => v === 0));
      assert.ok(isKillerCages(cages));
      assert.ok(cages.length < 60, `${difficulty}: should contain multi-cell cages`);
      for (const cage of cages) {
        assert.ok(cage.cells.length <= 5);
        const digits = cage.cells.map((i) => solution[i]);
        assert.equal(new Set(digits).size, digits.length);
        assert.equal(digits.reduce((a, b) => a + b, 0), cage.sum);
      }
      solution.forEach((digit, i) => {
        const copy = [...solution]; copy[i] = 0;
        assert.ok(digit >= 1 && digit <= 9 && canPlace(copy, i, digit));
      });
      assert.equal(countKillerSolutions(cages, 1_000_000), 1, difficulty);
    }
  }
});

test("killer solver rejects contradictions and detects multiple solutions", () => {
  const solution = generateSolved(seeded(7));
  const singles = solution.map((sum, i) => ({ cells: [i], sum }));
  assert.equal(countKillerSolutions(singles), 1);
  const bad = singles.map((c) => ({ ...c }));
  bad[0].sum = bad[1].sum;
  assert.equal(countKillerSolutions(bad), 0);
  const rows = Array.from({ length: 9 }, (_, r) => ({ cells: Array.from({ length: 9 }, (_, c) => r * 9 + c), sum: 45 }));
  assert.equal(countKillerSolutions(rows), 2);
  assert.equal(countKillerSolutions(singles, 0), 2, "budget exhaustion must never certify uniqueness");
});

test("killer cage validation rejects missing, overlapping, disconnected and impossible cages", () => {
  const cages = generateSolved(seeded(1)).map((sum, i) => ({ cells: [i], sum }));
  assert.equal(isKillerCages(cages.slice(1)), false);
  assert.equal(isKillerCages([...cages, cages[0]]), false);
  assert.equal(isKillerCages([{ cells: [0, 80], sum: 10 }, ...cages.slice(1, 80)]), false);
  assert.equal(isKillerCages([{ cells: [0], sum: 10 }, ...cages.slice(1)]), false);
});

test("killer cage progress detects repeats, exceeded sums and impossible remaining digits", () => {
  const cage = { cells: [0, 1], sum: 4 };
  const values = new Array(81).fill(0);
  values[0] = 1;
  assert.deepEqual(cageProgress(cage, values), { sum: 1, remaining: 3, empty: 1, invalid: false });
  values[1] = 1;
  assert.equal(cageProgress(cage, values).invalid, true);
  values[1] = 3;
  assert.equal(cageProgress(cage, values).invalid, false);
  values[0] = 2; values[1] = 0;
  assert.equal(cageProgress(cage, values).invalid, true, "2+2 would repeat");
  values[0] = 5;
  assert.equal(cageProgress(cage, values).invalid, true);
});

test("killer notes are removed across the cage, without mutating unrelated cells", () => {
  const notes = new Array(81).fill((1 << 3) | (1 << 5));
  const next = clearKillerPeerNotes(notes, 0, 3, [{ cells: [0, 9, 10], sum: 12 }]);
  assert.equal(next[10], 1 << 5);
  assert.equal(next[80], notes[80]);
  assert.equal(notes[10], (1 << 3) | (1 << 5));
});
