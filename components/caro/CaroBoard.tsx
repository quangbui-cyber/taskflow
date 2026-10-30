"use client";

import React, { useMemo } from "react";
import { type Board, type Point, BOARD_SIZE } from "@/lib/caro";

interface CaroBoardProps {
  board: Board;
  lastMove: Point | null;
  winningLine: Point[];
  currentTurn: "X" | "O";
  hoverSymbol?: "X" | "O";
  disabled?: boolean;
  onCellClick: (r: number, c: number) => void;
  /** Lớp phủ (ví dụ hộp "Sẵn sàng chưa?") nằm gọn trên đúng mặt bàn cờ. */
  overlay?: React.ReactNode;
}

// Các điểm thiên nguyên (star points) truyền thống trên bàn cờ 15x15
const STAR_POINTS = new Set(["3,3", "3,11", "7,7", "11,3", "11,11"]);

/** Hình quân cờ dùng chung cho bàn cờ và bảng tỉ số. */
export function CaroPiece({
  symbol,
  className = "",
  ghost = false,
}: {
  symbol: "X" | "O";
  className?: string;
  ghost?: boolean;
}) {
  if (symbol === "X") {
    return (
      <svg
        aria-hidden="true"
        className={`${ghost ? "stroke-zinc-900/35" : "stroke-zinc-900"} ${className}`}
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2.8}
        strokeLinecap="round"
      >
        <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className={`${ghost ? "stroke-brand-600/40" : "stroke-brand-600"} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2.8}
    >
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}

export default function CaroBoard({
  board,
  lastMove,
  winningLine,
  currentTurn,
  hoverSymbol,
  disabled = false,
  onCellClick,
  overlay,
}: CaroBoardProps) {
  const effectiveHover = hoverSymbol || currentTurn;
  const winningSet = useMemo(() => {
    const s = new Set<string>();
    winningLine.forEach((p) => s.add(`${p.r},${p.c}`));
    return s;
  }, [winningLine]);

  return (
    <div className="relative w-full select-none rounded-[18px] border border-[#e7e1d3] bg-[#f7f4ec] p-2.5 shadow-sm sm:p-3.5">
      {/* Lưới 15x15: đường kẻ tạo bởi khoảng hở 1px trên nền màu đường kẻ */}
      <div
        className="grid aspect-square w-full gap-px border border-[#ddd5c3] bg-[#ddd5c3]"
        style={{
          gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
        }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => {
            const key = `${r},${c}`;
            const isLast = lastMove?.r === r && lastMove?.c === c;
            const isWinning = winningSet.has(key);
            const isStar = STAR_POINTS.has(key);
            const canPlay = cell === null && !disabled;

            return (
              <button
                key={key}
                type="button"
                disabled={!canPlay}
                onClick={() => onCellClick(r, c)}
                className={`group relative flex items-center justify-center transition-colors duration-150 ease-out focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand-600 motion-reduce:transition-none ${
                  isWinning ? "bg-brand-200" : "bg-[#faf8f2]"
                } ${canPlay ? "cursor-pointer hover:bg-[#efe9d8]" : "cursor-default"} ${
                  isLast && !isWinning ? "shadow-[inset_0_0_0_2px_#a8d431]" : ""
                }`}
                aria-label={`Ô hàng ${r + 1}, cột ${c + 1}${cell ? `, quân ${cell}` : ""}`}
              >
                {/* Dấu chấm thiên nguyên (Star points) */}
                {isStar && cell === null && (
                  <span className="pointer-events-none absolute h-[5px] w-[5px] rounded-full bg-[#b5ab96]" />
                )}

                {/* Quân cờ đã đánh */}
                {cell && <CaroPiece symbol={cell} className="h-[70%] w-[70%]" />}

                {/* Xem trước khi hover vào ô trống (ai nắm X thấy X, ai nắm O thấy O) */}
                {canPlay && (
                  <CaroPiece
                    symbol={effectiveHover}
                    ghost
                    className="pointer-events-none absolute h-[66%] w-[66%] opacity-0 transition-opacity duration-150 group-hover:opacity-100 motion-reduce:transition-none"
                  />
                )}
              </button>
            );
          })
        )}
      </div>

      {overlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[18px] bg-[#faf8f2]/70 p-6 backdrop-blur-[2px]">
          {overlay}
        </div>
      )}
    </div>
  );
}
