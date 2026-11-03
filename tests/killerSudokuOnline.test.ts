import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SudokuGame } from "@prisma/client";
import * as sudoku from "../lib/sudoku";
import * as killer from "../lib/killerSudoku";
import type * as Actions from "../app/actions/sudokuOnline";

/** Exercise the real server actions with isolated auth and an in-memory Prisma boundary. */
function roomHarness() {
  let userId: string | null = "host";
  let row: SudokuGame | null = null;
  let beforeUpdate: (() => void) | null = null;
  const matches: unknown[] = [];
  const db = {
    sudokuGame: {
      findUnique: async ({ where }: { where: { code?: string; id?: string } }) =>
        row && (where.code === row.code || where.id === row.id) ? structuredClone(row) : null,
      create: async ({ data }: { data: Partial<SudokuGame> }) => {
        row = { id: "room", code: "SDTEST", hostUserId: "host", hostName: "Host", guestUserId: null,
          guestName: null, difficulty: "medium", variant: "classic", cages: null, timerEnabled: false,
          timeLimitSec: 900, puzzle: null, solution: null, hostValues: null, guestValues: null,
          hostMistakes: 0, guestMistakes: 0, status: "WAITING", winner: null, finishReason: null,
          scoreHost: 0, scoreGuest: 0, startedAt: null, finishedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        return structuredClone(row);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<SudokuGame> }) => {
        beforeUpdate?.(); beforeUpdate = null;
        if (!row) return { count: 0 };
        for (const [key, value] of Object.entries(where)) {
          const actual = row[key as keyof SudokuGame];
          if (value && typeof value === "object" && "not" in value) {
            if (actual === value.not) return { count: 0 };
          } else if (value instanceof Date ? !(actual instanceof Date) || +actual !== +value : actual !== value) return { count: 0 };
        }
        row = { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1) };
        return { count: 1 };
      },
    },
    sudokuMatch: { create: async (record: unknown) => { matches.push(record); } },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  const output = ts.transpileModule(readFileSync(resolve("app/actions/sudokuOnline.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  runInNewContext(output, { exports, Date, console, require: (name: string) => {
    if (name === "@/lib/prisma") return { prisma: db };
    if (name === "@/lib/auth") return { getCurrentUser: async () => userId ? { id: userId, name: userId } : null };
    if (name === "@/lib/sudoku") return sudoku;
    if (name === "@/lib/killerSudoku") return killer;
    if (name === "@/lib/gameLeaderboardData") return {};
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return {
    actions: exports as typeof Actions,
    user: (id: string | null) => { userId = id; },
    row: () => row!, matches,
    race: (fn: () => void) => { beforeUpdate = fn; },
  };
}

test("killer online: both players receive identical cages, server keeps the solution and records a win once", async () => {
  const h = roomHarness();
  const created = await h.actions.createSudokuRoom("easy", false, "killer");
  assert.equal(created.game?.variant, "killer");
  const code = created.game!.code;
  h.user("guest");
  assert.equal((await h.actions.joinSudokuRoom(code)).game?.status, "READY");
  assert.equal((await h.actions.updateSudokuRoomSettings(code, "hard", false, "classic")).success, false);
  h.user("host");
  const started = await h.actions.startSudokuRound(code);
  assert.equal(started.game?.status, "PLAYING");
  assert.ok(killer.isKillerCages(started.game?.cages));
  assert.ok(started.game!.puzzle!.every((n) => n === 0));
  assert.equal("solution" in started.game!, false);
  assert.ok(started.game!.cages.every((c) => Object.keys(c).sort().join() === "cells,sum"));
  h.user("guest");
  const guest = await h.actions.getSudokuRoom(code);
  assert.deepEqual(guest.game?.cages, started.game?.cages);
  assert.deepEqual(guest.game?.puzzle, started.game?.puzzle);
  assert.equal((await h.actions.updateSudokuRoomSettings(code, "easy", false, "classic")).success, false);
  h.user("host");
  const solution = h.row().solution as number[];
  for (let i = 0; i < 81; i++) {
    const moved = await h.actions.submitSudokuCell(code, i, solution[i]);
    assert.equal(moved.correct, true);
  }
  assert.equal(h.row().winner, "HOST");
  assert.equal(h.row().status, "FINISHED");
  assert.equal(h.matches.length, 1);
  await h.actions.submitSudokuCell(code, 80, solution[80]);
  assert.equal(h.matches.length, 1);
  await h.actions.updateSudokuRoomSettings(code, "easy", false, "classic");
  const classic = await h.actions.startSudokuRound(code);
  assert.equal(classic.game?.variant, "classic");
  assert.equal(classic.game?.cages.length, 0);
  assert.ok(classic.game?.puzzle?.some(Boolean));
});

test("killer online: no login cannot create; third mistake loses; settings cannot overwrite a started round", async () => {
  const h = roomHarness();
  h.user(null);
  assert.equal((await h.actions.createSudokuRoom("easy", false, "killer")).success, false);
  h.user("host");
  const { game } = await h.actions.createSudokuRoom("easy", false, "killer");
  const code = game!.code;
  h.user("guest"); await h.actions.joinSudokuRoom(code);
  h.user("host");
  h.race(() => { h.row().status = "PLAYING"; });
  await h.actions.updateSudokuRoomSettings(code, "hard", true, "classic");
  assert.equal(h.row().variant, "killer");
  assert.equal(h.row().difficulty, "easy");
  h.row().status = "READY";
  await h.actions.startSudokuRound(code);
  const wrong = (h.row().solution as number[])[0] % 9 + 1;
  for (let i = 0; i < 3; i++) assert.equal((await h.actions.submitSudokuCell(code, 0, wrong)).correct, false);
  assert.equal(h.row().winner, "GUEST");
  assert.equal(h.row().finishReason, "MISTAKES");
});
