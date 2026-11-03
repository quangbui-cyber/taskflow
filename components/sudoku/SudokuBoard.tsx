"use client";

import React from "react";
import { CELLS, boxOf, colOf, rowOf, type Grid } from "@/lib/sudoku";

import type { KillerCage } from "@/lib/killerSudoku";

interface SudokuBoardProps {
  cages?: KillerCage[];
  puzzle: Grid;
  /** Số đang hiển thị ở mỗi ô (0 = trống). */
  values: Grid;
  /** Ô điền sai (tô đỏ). */
  wrong: boolean[];
  /** Ghi chú dạng bitmask: bit n bật = có ghi chú số n. */
  notes: number[];
  selected: number | null;
  disabled?: boolean;
  /** Che số khi chưa bắt đầu để không ai nhìn trước đề. */
  hidden?: boolean;
  onSelect: (index: number) => void;
}

const NOTE_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function SudokuBoard({
  cages = [],
  puzzle,
  values,
  wrong,
  notes,
  selected,
  disabled = false,
  hidden = false,
  onSelect,
}: SudokuBoardProps) {
  const cageByCell = new Map(cages.flatMap((cage) => cage.cells.map((i) => [i, cage] as const)));
  const selectedCage = selected === null ? undefined : cageByCell.get(selected);
  const selectedValue = selected !== null ? values[selected] : 0;

  return (
    <div
      role="grid"
      aria-label="Bàn Sudoku 9x9"
      className="grid aspect-square w-full grid-cols-9 grid-rows-9 overflow-hidden rounded-[14px] border-2 border-zinc-800 bg-white shadow-sm select-none"
    >
      {Array.from({ length: CELLS }, (_, i) => {
        const r = rowOf(i);
        const c = colOf(i);
        const cage = hidden ? undefined : cageByCell.get(i);
        const firstInCage = cage && i === Math.min(...cage.cells);
        const given = puzzle[i] !== 0;
        const value = hidden ? 0 : values[i];
        const isSelected = selected === i;
        const related =
          selected !== null && (rowOf(selected) === r || colOf(selected) === c || boxOf(selected) === boxOf(i));
        const sameValue = !hidden && selectedValue !== 0 && value === selectedValue;
        const isWrong = !hidden && wrong[i];

        let bg = "bg-white";
        if (isWrong) bg = "bg-red-50";
        else if (isSelected) bg = "bg-brand-200";
        else if (sameValue) bg = "bg-brand-100";
        else if (related || (cage && cage === selectedCage)) bg = "bg-zinc-100";

        let text = "text-brand-800";
        if (given) text = "text-zinc-900 font-semibold";
        if (isWrong) text = "text-red-600";

        const borderR = c === 8 ? "" : c % 3 === 2 ? "border-r-2 border-r-zinc-800" : "border-r border-r-zinc-200";
        const borderB = r === 8 ? "" : r % 3 === 2 ? "border-b-2 border-b-zinc-800" : "border-b border-b-zinc-200";

        return (
          <button
            key={i}
            type="button"
            role="gridcell"
            aria-label={`Hàng ${r + 1}, cột ${c + 1}${value ? `, số ${value}` : ", trống"}${cage ? `, vùng ${cage.cells.length} ô tổng ${cage.sum}` : ""}`}
            aria-selected={isSelected}
            disabled={disabled}
            onClick={() => onSelect(i)}
            className={`relative flex items-center justify-center ${bg} ${borderR} ${borderB} text-[clamp(15px,4.6vw,24px)] leading-none transition-colors duration-150 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-default`}
          >
            {cage && <span aria-hidden="true" className="pointer-events-none absolute border-dashed border-zinc-500"
              style={{
                top: cage.cells.includes(i - 9) ? -1 : 3,
                bottom: cage.cells.includes(i + 9) ? -1 : 3,
                left: c > 0 && cage.cells.includes(i - 1) ? -1 : 3,
                right: c < 8 && cage.cells.includes(i + 1) ? -1 : 3,
                borderTopWidth: cage.cells.includes(i - 9) ? 0 : 1,
                borderBottomWidth: cage.cells.includes(i + 9) ? 0 : 1,
                borderLeftWidth: c > 0 && cage.cells.includes(i - 1) ? 0 : 1,
                borderRightWidth: c < 8 && cage.cells.includes(i + 1) ? 0 : 1,
              }} />}
            {firstInCage && <span aria-hidden="true" className="pointer-events-none absolute left-[5px] top-[4px] bg-white/90 px-0.5 text-[clamp(8px,2vw,10px)] font-semibold leading-none text-zinc-700">{cage.sum}</span>}
            {value !== 0 ? (
              <span className={`${text} ${cage ? "translate-y-1" : ""}`}>{value}</span>
            ) : !hidden && notes[i] ? (
              <span className={`grid h-full w-full grid-cols-3 grid-rows-3 p-[2px] ${cage ? "px-1 pb-1 pt-3" : ""}`}>
                {NOTE_DIGITS.map((n) => (
                  <span
                    key={n}
                    className={`flex items-center justify-center text-[clamp(8px,1.9vw,11px)] leading-none ${
                      selectedValue === n ? "font-semibold text-brand-800" : "text-zinc-500"
                    }`}
                  >
                    {notes[i] & (1 << n) ? n : ""}
                  </span>
                ))}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
