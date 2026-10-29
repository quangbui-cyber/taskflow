"use client";

import React, { useMemo } from "react";
import { type Board, type Cell, type Point, BOARD_SIZE } from "@/lib/caro";

interface CaroBoardProps {
  board: Board;
  lastMove: Point | null;
  winningLine: Point[];
  currentTurn: "X" | "O";
  disabled?: boolean;
  onCellClick: (r: number, c: number) => void;
}

// Các điểm thiên nguyên (star points) truyền thống trên bàn cờ 15x15
const STAR_POINTS = new Set(["3,3", "3,11", "7,7", "11,3", "11,11"]);

export default function CaroBoard({
  board,
  lastMove,
  winningLine,
  currentTurn,
  disabled = false,
  onCellClick,
}: CaroBoardProps) {
  const winningSet = useMemo(() => {
    const s = new Set<string>();
    winningLine.forEach((p) => s.add(`${p.r},${p.c}`));
    return s;
  }, [winningLine]);

  return (
    <div className="relative mx-auto w-full max-w-[min(92vw,540px)] aspect-square rounded-[18px] border-2 border-stone-300/80 bg-[#f7f4ec] p-2 sm:p-3.5 shadow-md select-none">
      {/* Khung lưới 15x15 */}
      <div
        className="grid h-full w-full border border-stone-400/60 bg-[#faf8f2]"
        style={{
          gridTemplateColumns: "repeat(15, minmax(0, 1fr))",
          gridTemplateRows: "repeat(15, minmax(0, 1fr))",
        }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => {
            const key = `${r},${c}`;
            const isLast = lastMove?.r === r && lastMove?.c === c;
            const isWinning = winningSet.has(key);
            const isStar = STAR_POINTS.has(key);

            return (
              <button
                key={key}
                type="button"
                disabled={disabled || cell !== null}
                onClick={() => onCellClick(r, c)}
                className={`group relative flex items-center justify-center border-r border-b border-stone-300/60 focus:outline-none transition-colors ${
                  r === 0 ? "border-t-0" : ""
                } ${c === 0 ? "border-l-0" : ""} ${
                  isWinning
                    ? "bg-lime-200/70"
                    : cell === null && !disabled
                    ? "hover:bg-amber-100/40"
                    : ""
                }`}
                aria-label={`Ô hàng ${r + 1}, cột ${c + 1}`}
              >
                {/* Dấu chấm thiên nguyên (Star points) */}
                {isStar && cell === null && (
                  <span className="pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-stone-400/80" />
                )}

                {/* Quân cờ đã đánh */}
                {cell === "X" && (
                  <svg
                    className={`h-[72%] w-[72%] stroke-[3.2] stroke-zinc-900 transition-transform duration-150 ${
                      isWinning ? "stroke-zinc-950 scale-110" : "scale-100"
                    }`}
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}

                {cell === "O" && (
                  <svg
                    className={`h-[72%] w-[72%] stroke-[3.2] stroke-lime-600 transition-transform duration-150 ${
                      isWinning ? "stroke-lime-700 scale-110" : "scale-100"
                    }`}
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                )}

                {/* Điểm đánh dấu nước đi gần nhất */}
                {isLast && (
                  <span className="pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-red-500 shadow-xs" />
                )}

                {/* Hiệu ứng xem trước khi hover vào ô trống */}
                {cell === null && !disabled && (
                  <span
                    className={`pointer-events-none absolute h-[60%] w-[60%] rounded-full opacity-0 transition-opacity group-hover:opacity-30 ${
                      currentTurn === "X"
                        ? "border-2 border-zinc-900"
                        : "border-2 border-lime-600"
                    }`}
                  />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
