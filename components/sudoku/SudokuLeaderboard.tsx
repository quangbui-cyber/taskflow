"use client";

import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import Avatar from "@/components/Avatar";
import { monthLabel, shiftMonth } from "@/lib/sudokuLeaderboard";
import { getSudokuLeaderboard, type SudokuLeaderboard as Board } from "@/app/actions/sudokuOnline";

const TOP = 10;

const RANK_STYLE: Record<number, string> = {
  1: "bg-brand-400 text-zinc-950",
  2: "bg-brand-200 text-brand-900",
  3: "bg-brand-100 text-brand-800",
};

interface SudokuLeaderboardProps {
  /** Đổi giá trị này để tải lại (ví dụ khi vừa xong một ván online). */
  refreshKey?: string | null;
}

export default function SudokuLeaderboard({ refreshKey = null }: SudokuLeaderboardProps) {
  const [month, setMonth] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSudokuLeaderboard(month ?? undefined).then((res) => {
      if (!alive) return;
      if (res.success && res.leaderboard) {
        setBoard(res.leaderboard);
        setError(null);
      } else setError(res.error || "Không thể tải bảng xếp hạng.");
    });
    return () => {
      alive = false;
    };
  }, [month, refreshKey]);

  const shownMonth = board?.month ?? month;
  const atCurrent = !board || board.month >= board.currentMonth;
  const rows = board?.rows ?? [];
  const top = rows.slice(0, TOP);
  const me = rows.find((r) => r.isMe);
  const showMeBelow = me && !top.includes(me);

  return (
    <section className="mx-auto mt-10 max-w-3xl rounded-[18px] border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <Trophy size={18} />
          </span>
          <h2 className="text-sm font-bold text-zinc-900">Bảng xếp hạng thi đấu</h2>
        </div>

        <div className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 p-0.5">
          <button
            type="button"
            aria-label="Tháng trước"
            onClick={() => board && setMonth(shiftMonth(board.month, -1))}
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[92px] text-center text-xs font-semibold text-zinc-800">
            {shownMonth ? monthLabel(shownMonth) : "Tháng này"}
          </span>
          <button
            type="button"
            aria-label="Tháng sau"
            disabled={atCurrent}
            onClick={() => board && setMonth(shiftMonth(board.month, 1))}
            className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {error ? (
        <p className="py-6 text-center text-xs text-red-600">{error}</p>
      ) : !board ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((k) => (
            <div key={k} className="h-12 rounded-[12px] bg-zinc-50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm font-semibold text-zinc-500">Chưa có trận nào</p>
        </div>
      ) : (
        <>
          <ol className="divide-y divide-zinc-100">
            {top.map((row) => (
              <Row key={row.userId} row={row} />
            ))}
          </ol>
          {showMeBelow && me && (
            <ol className="mt-2 border-t border-dashed border-zinc-200 pt-2">
              <Row row={me} />
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function Row({ row }: { row: Board["rows"][number] }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-[12px] px-2 py-2.5 ${row.isMe ? "bg-brand-50" : ""}`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          RANK_STYLE[row.rank] ?? "bg-zinc-100 text-zinc-600"
        }`}
      >
        {row.rank}
      </span>
      <Avatar id={row.userId} name={row.name} avatarUrl={row.avatarUrl} className="h-8 w-8 text-xs" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-900">
          {row.name}
          {row.isMe && <span className="ml-1 text-xs font-normal text-zinc-400">(bạn)</span>}
        </div>
        <div className="text-[11px] text-zinc-500">
          {row.played} trận · {row.losses} thua{row.draws ? ` · ${row.draws} hoà` : ""} · {row.winRate}% thắng
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-extrabold tabular-nums leading-none text-zinc-950">{row.wins}</div>
        <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">thắng</div>
      </div>
    </li>
  );
}
