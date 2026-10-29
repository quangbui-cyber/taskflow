import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyBoard,
  checkWin,
  isBoardFull,
  getAiMove,
  BOARD_SIZE,
} from "../lib/caro";

test("caro: empty board initializes properly", () => {
  const board = createEmptyBoard();
  assert.equal(board.length, BOARD_SIZE);
  assert.equal(board[0].length, BOARD_SIZE);
  assert.equal(isBoardFull(board), false);
});

test("caro: detects horizontal win of 5 stones", () => {
  const board = createEmptyBoard();
  for (let c = 3; c < 7; c++) {
    board[5][c] = "X";
  }
  // Not won yet with 4 stones
  assert.equal(checkWin(board, 5, 6, "X").won, false);

  // Add 5th stone
  board[5][7] = "X";
  const result = checkWin(board, 5, 7, "X");
  assert.equal(result.won, true);
  assert.equal(result.winner, "X");
  assert.equal(result.line.length, 5);
});

test("caro: detects diagonal win", () => {
  const board = createEmptyBoard();
  for (let i = 0; i < 5; i++) {
    board[i + 2][i + 2] = "O";
  }
  const result = checkWin(board, 4, 4, "O");
  assert.equal(result.won, true);
  assert.equal(result.winner, "O");
  assert.equal(result.line.length, 5);
});

test("caro: AI plays first move in center if board empty", () => {
  const board = createEmptyBoard();
  const move = getAiMove(board, "O", "hard");
  assert.deepEqual(move, { r: 7, c: 7 });
});

test("caro: AI blocks immediate win of 4 open stones", () => {
  const board = createEmptyBoard();
  // Player X has 4 stones in a row: (7, 3), (7, 4), (7, 5), (7, 6)
  board[7][3] = "X";
  board[7][4] = "X";
  board[7][5] = "X";
  board[7][6] = "X";

  const aiMove = getAiMove(board, "O", "hard");
  assert.ok(aiMove);
  // AI must block at either (7, 2) or (7, 7)
  const isBlocking = (aiMove.r === 7 && aiMove.c === 2) || (aiMove.r === 7 && aiMove.c === 7);
  assert.equal(isBlocking, true, `AI should block at (7,2) or (7,7) but chose (${aiMove.r}, ${aiMove.c})`);
});
