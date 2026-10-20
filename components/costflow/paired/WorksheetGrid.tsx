"use client";

import { useState, type DragEvent } from "react";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Paperclip,
  GripVertical,
  Settings2
} from "lucide-react";
import { displayMoney } from "@/lib/costflow/money";
import { childrenOf, groupAmount } from "@/lib/costflow/pairedPricing";
import type { PairedRow } from "@/lib/costflow/types";
import { PairedPriceInput, calcRowMargin } from "./WorksheetHelpers";

export interface WorksheetGridProps {
  rows: PairedRow[];
  visibleRows: { row: PairedRow; depth: number }[];
  outlineById: Map<string, { numberLabel: string; role: string }>;
  mode: "quote" | "paired" | "ic";
  viewFilter: "ALL" | "SELL" | "BUY";
  locked: boolean;
  selected: string[];
  onSelectAll: (checked: boolean) => void;
  onSelectRow: (id: string, checked: boolean) => void;
  collapsed: string[];
  onToggleCollapse: (id: string) => void;
  onOpenDetail: (id: string, target?: "general" | "buy") => void;
  onSide: (row: PairedRow, scope: "sell" | "buy", field: string, value: string) => void;
  onAdd: (rowType: "GROUP" | "ITEM", parent?: string | null, after?: string) => void;
  onOpenEvidence: (targets: string[]) => void;
  displayedTotals: {
    id: string;
    label: string;
    sell?: string;
    buy?: string;
    incompleteSell?: boolean;
    incompleteBuy?: boolean;
  }[];
  marginPercent: string | null;
  marginReady: boolean;
  estimatedMargin: { numerator: bigint; denominator: bigint };
  drop: { id: string; position: "before" | "inside" | "after" } | null;
  dragId: string | null;
  onDragOver: (e: DragEvent, id: string) => void;
  onPerformDrop: (e: DragEvent, target: PairedRow) => void;
  onDragStart: (id: string, e: DragEvent) => void;
  onDragEnd: () => void;
  focusNextPrice: (rowId: string, scope: "sell" | "buy") => void;
}

export default function WorksheetGrid({
  rows,
  visibleRows,
  outlineById,
  mode,
  viewFilter,
  locked,
  selected,
  onSelectAll,
  onSelectRow,
  collapsed,
  onToggleCollapse,
  onOpenDetail,
  onSide,
  onAdd,
  onOpenEvidence,
  displayedTotals,
  marginPercent,
  marginReady,
  estimatedMargin,
  drop,
  onDragOver,
  onPerformDrop,
  onDragStart,
  onDragEnd,
  focusNextPrice
}: WorksheetGridProps) {
  const [insertMenuId, setInsertMenuId] = useState<string | null>(null);

  return (
    <div className="tf-worksheet-table-container">
      <table className="w-full border-collapse text-sm tf-quotation-hierarchy-table">
        <caption className="sr-only">Bảng tính Báo giá và IC song song</caption>
        <thead>
          <tr className="text-xs font-semibold text-[var(--color-brand-900)] bg-[var(--primary)] border-b border-[var(--border-strong)]">
            {/* Checkbox select all */}
            <th scope="col" className="p-2 text-center w-16">
              <label className="inline-flex items-center cursor-pointer" title="Chọn tất cả">
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả các dòng"
                  checked={rows.length > 0 && selected.length === rows.length}
                  onChange={e => onSelectAll(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--focus-ring)] h-3.5 w-3.5"
                />
              </label>
            </th>
            <th scope="col" className="p-2 text-center w-12">STT</th>
            <th scope="col" className="p-2 text-left">Hạng mục & Mô tả chi tiết</th>

            {/* Sell Columns */}
            {viewFilter !== "BUY" && (
              <>
                <th scope="col" className="p-2 text-center w-20 border-l border-[var(--border)]">ĐVT</th>
                <th scope="col" className="p-2 text-center w-16">SL</th>
                <th scope="col" className="p-2 text-right w-28">Đơn giá bán</th>
                <th scope="col" className="p-2 text-right w-32 font-bold">Thành tiền bán</th>
              </>
            )}

            {/* Buy Columns */}
            {viewFilter !== "SELL" && (
              <>
                <th scope="col" className="p-2 text-right w-28 border-l border-[var(--border)]">
                  {mode === "ic" ? "Đơn giá vốn" : "Giá vốn"}
                </th>
                <th scope="col" className="p-2 text-right w-32 font-bold">
                  Thành tiền vốn (IC)
                </th>
                {mode === "ic" && (
                  <th scope="col" className="p-2 text-center w-24">
                    Minh chứng
                  </th>
                )}
              </>
            )}

            {/* Margin Column */}
            {((mode === "paired" && viewFilter === "ALL") || mode === "ic") && (
              <th scope="col" className="p-2 text-right w-28 border-l border-[var(--border)]">
                Margin
              </th>
            )}

            <th scope="col" className="p-2 text-center w-12 border-l border-[var(--border)]">Chi tiết</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 && (
            <tr>
              <td
                colSpan={viewFilter === "ALL" ? 10 : 7}
                className="p-8 text-center text-xs text-[var(--text-secondary)] bg-[var(--surface)]"
              >
                Chưa có hạng mục nào trong bảng tính. Bấm &ldquo;Thêm dòng&rdquo; để bắt đầu lập báo giá.
              </td>
            </tr>
          )}
          {visibleRows.map(({ row }, i) => {
            const group = childrenOf(rows, row.itemId).length > 0;
            const structuralGroup = row.rowType === "GROUP";
            const outlineEntry = outlineById.get(row.itemId);
            const numberLabel = outlineEntry?.numberLabel ?? "";
            const role = outlineEntry?.role ?? (structuralGroup ? "GROUP" : "ITEM");
            const sellAmount = groupAmount(rows, row, "sell")?.net;
            const buyAmount = groupAmount(rows, row, "buy")?.net;
            const collapsedRow = collapsed.includes(row.itemId);
            const rowMargin = calcRowMargin(groupAmount(rows, row, "sell"), groupAmount(rows, row, "buy"));

            // ==========================================
            // CASE 1: GROUP LEVEL 1 (A, B, C...)
            // ==========================================
            if (structuralGroup) {
              return (
                <tr
                  key={row.itemId}
                  className="bg-[var(--primary-soft)] font-bold border-t-2 border-[var(--color-brand-300)] border-b border-[var(--border)] group hover:bg-[var(--color-brand-100)] transition-colors"
                  data-drop-position={drop?.id === row.itemId ? drop.position : undefined}
                  onDragOver={event => onDragOver(event, row.itemId)}
                  onDrop={event => onPerformDrop(event, row)}
                >
                  <td className="p-1 text-center w-16">
                    <div className="flex items-center justify-center gap-1">
                      {mode !== "ic" && (
                        <div className="relative inline-block" data-paired-menu>
                          <button
                            type="button"
                            className={`p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-opacity ${
                              insertMenuId === row.itemId ? "opacity-100 bg-[var(--surface-muted)]" : "opacity-0 group-hover:opacity-100"
                            }`}
                            title={`Thêm dòng trong nhóm ${row.name || numberLabel}`}
                            aria-label={`Thêm dòng trong nhóm ${row.name || numberLabel}`}
                            aria-haspopup="menu"
                            aria-expanded={insertMenuId === row.itemId}
                            onClick={() => setInsertMenuId(insertMenuId === row.itemId ? null : row.itemId)}
                          >
                            <Plus size={14} aria-hidden="true" />
                          </button>
                          {insertMenuId === row.itemId && (
                            <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[210px] text-left text-xs whitespace-nowrap">
                              <button
                                type="button"
                                className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                                onClick={() => {
                                  onAdd("GROUP", null, row.itemId);
                                  setInsertMenuId(null);
                                }}
                              >
                                <Plus size={13} className="text-[var(--muted)]" aria-hidden="true" /> Thêm nhóm bên dưới
                              </button>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                                onClick={() => {
                                  onAdd("ITEM", row.itemId);
                                  setInsertMenuId(null);
                                }}
                              >
                                <Plus size={13} className="text-[var(--muted)]" aria-hidden="true" /> Thêm hạng mục trong nhóm
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        className="p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] cursor-grab active:cursor-grabbing transition-opacity opacity-40 group-hover:opacity-100"
                        draggable={!locked && mode !== "ic"}
                        onDragStart={event => onDragStart(row.itemId, event)}
                        onDragEnd={onDragEnd}
                        title="Kéo để sắp xếp nhóm"
                        aria-label={`Kéo để sắp xếp nhóm ${row.name || numberLabel}`}
                      >
                        <GripVertical size={14} aria-hidden="true" />
                      </button>
                      <label className="inline-flex items-center cursor-pointer p-0.5">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={selected.includes(row.itemId)}
                          onChange={e => onSelectRow(row.itemId, e.target.checked)}
                          className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--focus-ring)] h-3.5 w-3.5 transition-opacity opacity-40 group-hover:opacity-100"
                        />
                      </label>
                    </div>
                  </td>
                  <td className="p-2 text-center text-xs font-mono font-bold text-[var(--color-brand-900)]">
                    <span className="tf-worksheet-outline-badge tf-worksheet-outline-level-1">{numberLabel}</span>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        className="p-1 hover:bg-[var(--surface-muted)] rounded text-[var(--foreground)]"
                        aria-label={(collapsedRow ? "Mở rộng nhóm " : "Thu gọn nhóm ") + row.name}
                        onClick={() => onToggleCollapse(row.itemId)}
                      >
                        {collapsedRow ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      </button>
                      <button
                        type="button"
                        className="font-bold text-[var(--foreground)] text-sm hover:underline text-left uppercase"
                        onClick={() => onOpenDetail(row.itemId)}
                      >
                        {row.name || "Tên nhóm…"}
                      </button>
                      {row.description && (
                        <span className="text-xs text-[var(--text-secondary)] italic ml-1">
                          ({row.description})
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Sell Columns */}
                  {viewFilter !== "BUY" && (
                    <>
                      <td className="p-2 text-center text-xs text-[var(--muted)] border-l border-[var(--border)]">—</td>
                      <td className="p-2 text-center text-xs text-[var(--muted)]">—</td>
                      <td className="p-2 text-right text-xs text-[var(--muted)]">—</td>
                      <td className="p-2 text-right font-bold text-[var(--foreground)]">
                        {sellAmount === undefined ? "—" : displayMoney(sellAmount)}
                      </td>
                    </>
                  )}

                  {/* Buy Columns */}
                  {viewFilter !== "SELL" && (
                    <>
                      <td className="p-2 text-right text-xs text-[var(--muted)] border-l border-[var(--border)]">—</td>
                      <td className="p-2 text-right font-bold text-[var(--foreground)]">
                        {buyAmount === undefined ? "—" : displayMoney(buyAmount)}
                      </td>
                      {mode === "ic" && <td className="p-2 text-center text-xs text-[var(--muted)]">—</td>}
                    </>
                  )}

                  {/* Margin Group Indicator */}
                  {((mode === "paired" && viewFilter === "ALL") || mode === "ic") && (
                    <td className="p-2 text-right font-mono text-xs border-l border-[var(--border)]">
                      {rowMargin && rowMargin.hasData ? (
                        <span
                          className={`tf-worksheet-margin-badge ${
                            rowMargin.percentNum >= 30
                              ? "is-high"
                              : rowMargin.percentNum >= 15
                              ? "is-medium"
                              : "is-low"
                          }`}
                        >
                          {rowMargin.percentDisplay}
                        </span>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                  )}

                  <td className="p-2 text-center border-l border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(row.itemId)}
                      className="p-1 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] rounded transition-colors"
                      title="Thiết lập nhóm"
                      aria-label="Thiết lập nhóm"
                    >
                      <Settings2 size={15} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            }

            // ==========================================
            // CASE 2: ITEM WITH CHILDREN (LEVEL 2)
            // ==========================================
            if (group) {
              return (
                <tr
                  key={row.itemId}
                  className="bg-[var(--surface-soft)] font-semibold border-t border-[var(--border)] hover:bg-[var(--surface-muted)] group transition-colors"
                  data-drop-position={drop?.id === row.itemId ? drop.position : undefined}
                  onDragOver={event => onDragOver(event, row.itemId)}
                  onDrop={event => onPerformDrop(event, row)}
                >
                  <td className="p-1 text-center w-16">
                    <div className="flex items-center justify-center gap-1">
                      {mode !== "ic" && (
                        <div className="relative inline-block" data-paired-menu>
                          <button
                            type="button"
                            className={`p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-opacity ${
                              insertMenuId === row.itemId ? "opacity-100 bg-[var(--surface-muted)]" : "opacity-0 group-hover:opacity-100"
                            }`}
                            title={`Thêm dòng tại ${row.name || numberLabel}`}
                            aria-label={`Thêm dòng tại ${row.name || numberLabel}`}
                            aria-haspopup="menu"
                            aria-expanded={insertMenuId === row.itemId}
                            onClick={() => setInsertMenuId(insertMenuId === row.itemId ? null : row.itemId)}
                          >
                            <Plus size={14} aria-hidden="true" />
                          </button>
                          {insertMenuId === row.itemId && (
                            <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[210px] text-left text-xs whitespace-nowrap">
                              <button
                                type="button"
                                className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                                onClick={() => {
                                  onAdd("GROUP", null, row.itemId);
                                  setInsertMenuId(null);
                                }}
                              >
                                <Plus size={13} className="text-[var(--muted)]" aria-hidden="true" /> Thêm nhóm bên dưới
                              </button>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                                onClick={() => {
                                  onAdd("ITEM", row.parentItemId, row.itemId);
                                  setInsertMenuId(null);
                                }}
                              >
                                <Plus size={13} className="text-[var(--muted)]" aria-hidden="true" /> Thêm hạng mục cùng cấp
                              </button>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                                onClick={() => {
                                  onAdd("ITEM", row.itemId);
                                  setInsertMenuId(null);
                                }}
                              >
                                <Plus size={13} className="text-[var(--muted)]" aria-hidden="true" /> Thêm chi tiết con
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        className="p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] cursor-grab active:cursor-grabbing transition-opacity opacity-40 group-hover:opacity-100"
                        draggable={!locked && mode !== "ic"}
                        onDragStart={event => onDragStart(row.itemId, event)}
                        onDragEnd={onDragEnd}
                        title="Kéo để sắp xếp hạng mục"
                        aria-label={`Kéo để sắp xếp ${row.name || numberLabel}`}
                      >
                        <GripVertical size={14} aria-hidden="true" />
                      </button>
                      <label className="inline-flex items-center cursor-pointer p-0.5">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={selected.includes(row.itemId)}
                          onChange={e => onSelectRow(row.itemId, e.target.checked)}
                          className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--focus-ring)] h-3.5 w-3.5 transition-opacity opacity-40 group-hover:opacity-100"
                        />
                      </label>
                    </div>
                  </td>
                  <td className="p-2 text-center text-xs font-mono font-semibold text-[var(--foreground)]">
                    <span className="tf-worksheet-outline-badge tf-worksheet-outline-level-2">{numberLabel}</span>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5 flex-wrap" style={{ paddingLeft: "16px" }}>
                      <button
                        type="button"
                        className="p-1 hover:bg-[var(--surface-muted)] rounded text-[var(--foreground)]"
                        aria-label={(collapsedRow ? "Mở rộng " : "Thu gọn ") + row.name}
                        onClick={() => onToggleCollapse(row.itemId)}
                      >
                        {collapsedRow ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      </button>
                      <button
                        type="button"
                        className="font-semibold text-[var(--foreground)] text-sm hover:underline text-left"
                        onClick={() => onOpenDetail(row.itemId)}
                      >
                        {row.name || "Tên hạng mục…"}
                      </button>
                      {row.description && (
                        <span className="text-xs text-[var(--text-secondary)] truncate max-w-sm ml-1">
                          ({row.description})
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Sell Columns */}
                  {viewFilter !== "BUY" && (
                    <>
                      <td className="p-2 text-center text-xs text-[var(--muted)] border-l border-[var(--border)]">—</td>
                      <td className="p-2 text-center text-xs text-[var(--muted)]">—</td>
                      <td className="p-2 text-right text-xs text-[var(--muted)]">—</td>
                      <td className="p-2 text-right font-bold text-[var(--foreground)]">
                        {sellAmount === undefined ? "—" : displayMoney(sellAmount)}
                      </td>
                    </>
                  )}

                  {/* Buy Columns */}
                  {viewFilter !== "SELL" && (
                    <>
                      <td className="p-2 text-right text-xs text-[var(--muted)] border-l border-[var(--border)]">—</td>
                      <td className="p-2 text-right font-bold text-[var(--foreground)]">
                        {buyAmount === undefined ? "—" : displayMoney(buyAmount)}
                      </td>
                      {mode === "ic" && <td className="p-2 text-center text-xs text-[var(--muted)]">—</td>}
                    </>
                  )}

                  {/* Margin Item Indicator */}
                  {((mode === "paired" && viewFilter === "ALL") || mode === "ic") && (
                    <td className="p-2 text-right font-mono text-xs border-l border-[var(--border)]">
                      {rowMargin && rowMargin.hasData ? (
                        <span
                          className={`tf-worksheet-margin-badge ${
                            rowMargin.percentNum >= 30
                              ? "is-high"
                              : rowMargin.percentNum >= 15
                              ? "is-medium"
                              : "is-low"
                          }`}
                        >
                          {rowMargin.percentDisplay}
                        </span>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                  )}

                  <td className="p-2 text-center border-l border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(row.itemId)}
                      className="p-1 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] rounded transition-colors"
                      title={`Mở chi tiết ${row.name || ""}`}
                      aria-label={`Mở chi tiết ${row.name || ""}`}
                    >
                      <Settings2 size={15} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            }

            // ==========================================
            // CASE 3: LEAF DETAIL ITEM (LEVEL 3 OR STANDALONE)
            // ==========================================
            const indentPx = role === "DETAIL" ? "36px" : "16px";
            const usesParameterBinding =
              (!!row.sell.parameterBinding && row.sell.parameterBinding.mode !== "MANUAL") ||
              (!!row.buy.parameterBinding && row.buy.parameterBinding.mode !== "MANUAL");
            return (
              <tr
                key={row.itemId}
                className="border-b border-[var(--border)] hover:bg-[var(--surface-soft)] transition-colors group"
                data-drop-position={drop?.id === row.itemId ? drop.position : undefined}
                onDragOver={event => onDragOver(event, row.itemId)}
                onDrop={event => onPerformDrop(event, row)}
              >
                <td className="p-1 text-center w-16">
                  <div className="flex items-center justify-center gap-1">
                    {mode !== "ic" && (
                      <div className="relative inline-block" data-paired-menu>
                        <button
                          type="button"
                          className={`p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-opacity ${
                            insertMenuId === row.itemId ? "opacity-100 bg-[var(--surface-muted)]" : "opacity-0 group-hover:opacity-100"
                          }`}
                          title={`Thêm dòng tại ${row.name || numberLabel}`}
                          aria-label={`Thêm dòng tại ${row.name || numberLabel}`}
                          aria-haspopup="menu"
                          aria-expanded={insertMenuId === row.itemId}
                          onClick={() => setInsertMenuId(insertMenuId === row.itemId ? null : row.itemId)}
                        >
                          <Plus size={14} aria-hidden="true" />
                        </button>
                        {insertMenuId === row.itemId && (
                          <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[210px] text-left text-xs whitespace-nowrap">
                            <button
                              type="button"
                              className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                              onClick={() => {
                                onAdd("GROUP", null, row.itemId);
                                setInsertMenuId(null);
                              }}
                            >
                              <Plus size={13} className="text-[var(--muted)]" aria-hidden="true" /> Thêm nhóm bên dưới
                            </button>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                              onClick={() => {
                                onAdd("ITEM", row.parentItemId, row.itemId);
                                setInsertMenuId(null);
                              }}
                            >
                              <Plus size={13} className="text-[var(--muted)]" aria-hidden="true" /> Thêm hạng mục cùng cấp
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] cursor-grab active:cursor-grabbing transition-opacity opacity-40 group-hover:opacity-100"
                      draggable={!locked && mode !== "ic"}
                      onDragStart={event => onDragStart(row.itemId, event)}
                      onDragEnd={onDragEnd}
                      title="Kéo để sắp xếp dòng"
                      aria-label={`Kéo để sắp xếp ${row.name || numberLabel}`}
                    >
                      <GripVertical size={14} aria-hidden="true" />
                    </button>
                    <label className="inline-flex items-center cursor-pointer p-0.5">
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={selected.includes(row.itemId)}
                        onChange={e => onSelectRow(row.itemId, e.target.checked)}
                        className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--focus-ring)] h-3.5 w-3.5 transition-opacity opacity-40 group-hover:opacity-100"
                      />
                    </label>
                  </div>
                </td>
                <td className="p-2 text-center text-xs font-mono text-[var(--text-secondary)]">
                  <span className="tf-worksheet-outline-badge tf-worksheet-outline-level-3">{numberLabel}</span>
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-1.5 flex-wrap" style={{ paddingLeft: indentPx }}>
                    <button
                      type="button"
                      className="text-[var(--foreground)] text-sm hover:text-[var(--primary)] text-left font-normal"
                      onClick={() => onOpenDetail(row.itemId)}
                    >
                      {row.name || "Tên chi tiết…"}
                    </button>
                    {row.description && (
                      <span className="text-xs text-[var(--text-secondary)] truncate max-w-sm ml-1" title={row.description}>
                        ({row.description})
                      </span>
                    )}
                    {row.saleRemoved && (
                      <span className="text-xs text-[var(--warning)] bg-[var(--warning-soft)] rounded px-1.5 py-0.5 border border-[var(--warning)] ml-1">
                        Đã bỏ khỏi báo giá
                      </span>
                    )}
                  </div>
                </td>

                {/* Sell Columns */}
                {viewFilter !== "BUY" && (
                  <>
                    <td className="p-1 border-l border-[var(--border)] text-center text-xs">
                      <input
                        aria-label={"ĐVT bán " + (i + 1)}
                        value={row.sell.unit}
                        disabled={mode === "ic" || !!row.saleRemoved}
                        placeholder="—"
                        className="w-full text-center text-xs py-1 px-1 rounded border border-transparent hover:border-[var(--border)] focus:border-[var(--focus-ring)] focus:bg-[var(--surface)] bg-transparent transition-colors"
                        onChange={e => onSide(row, "sell", "unit", e.target.value)}
                      />
                    </td>
                    <td className="p-1 text-center text-xs">
                      <input
                        aria-label={"Số lượng bán " + (i + 1)}
                        inputMode="decimal"
                        value={row.sell.quantity}
                        disabled={mode === "ic" || !!row.saleRemoved}
                        placeholder="—"
                        title={usesParameterBinding ? "Dòng dùng tham số cấu hình quy mô" : undefined}
                        className={`w-full text-center text-xs py-1 px-1 rounded border border-transparent hover:border-[var(--border)] focus:border-[var(--focus-ring)] focus:bg-[var(--surface)] bg-transparent transition-colors tabular-nums ${usesParameterBinding ? "tf-worksheet-parameter-quantity" : ""}`}
                        onChange={e => onSide(row, "sell", "quantity", e.target.value)}
                      />
                    </td>
                    <td className="p-1 text-right">
                      <div className="w-28 ml-auto flex items-center justify-end gap-1">
                        <PairedPriceInput
                          label={"Đơn giá bán " + (i + 1)}
                          value={row.sell.unitPrice}
                          disabled={mode === "ic" || !!row.saleRemoved}
                          rowId={row.itemId}
                          scope="sell"
                          onChange={val => onSide(row, "sell", "unitPrice", val)}
                          onNext={() => focusNextPrice(row.itemId, "sell")}
                        />
                      </div>
                    </td>
                    <td className="p-2 text-right text-xs font-bold text-[var(--color-brand-800)]">
                      {sellAmount === undefined ? "—" : displayMoney(sellAmount)}
                    </td>
                  </>
                )}

                {/* Buy Columns */}
                {viewFilter !== "SELL" && (
                  <>
                    <td className="p-1 text-right border-l border-[var(--border)]">
                      <div className="w-32 ml-auto flex items-center justify-end gap-1">
                        <PairedPriceInput
                          label={"Giá vốn " + (i + 1)}
                          value={row.buy.unitPrice}
                          disabled={locked}
                          rowId={row.itemId}
                          scope="buy"
                          onChange={val => onSide(row, "buy", "unitPrice", val)}
                          onNext={() => focusNextPrice(row.itemId, "buy")}
                        />
                      </div>
                    </td>
                    <td className="p-2 text-right text-xs font-bold text-[var(--info)]">
                      {buyAmount === undefined ? "—" : displayMoney(buyAmount)}
                    </td>
                    {mode === "ic" && (
                      <td className="p-1 text-center">
                        <button
                          type="button"
                          onClick={() => onOpenEvidence([row.itemId])}
                          className={`p-1 rounded text-xs inline-flex items-center gap-1 ${
                            row.buy.evidenceIds.length
                              ? "text-[var(--info)] bg-[var(--info-soft)]"
                              : row.buy.evidenceReason
                              ? "text-[var(--warning)] bg-[var(--warning-soft)]"
                              : "text-[var(--muted)] hover:text-[var(--foreground)]"
                          }`}
                          title={
                            row.buy.evidenceIds.length
                              ? `${row.buy.evidenceIds.length} file minh chứng`
                              : row.buy.evidenceReason
                              ? `Lý do: ${row.buy.evidenceReason}`
                              : "Gắn minh chứng"
                          }
                          aria-label={
                            row.buy.evidenceIds.length
                              ? `${row.buy.evidenceIds.length} file minh chứng`
                              : row.buy.evidenceReason
                              ? `Lý do: ${row.buy.evidenceReason}`
                              : "Gắn minh chứng"
                          }
                        >
                          <Paperclip size={13} aria-hidden="true" />
                          {row.buy.evidenceIds.length > 0 && <span>{row.buy.evidenceIds.length}</span>}
                        </button>
                      </td>
                    )}
                  </>
                )}

                {/* Margin Leaf Indicator */}
                {((mode === "paired" && viewFilter === "ALL") || mode === "ic") && (
                  <td className="p-2 text-right font-mono text-xs border-l border-[var(--border)]">
                    {rowMargin && rowMargin.hasData ? (
                      <span
                        className={`tf-worksheet-margin-badge ${
                          rowMargin.percentNum >= 30
                            ? "is-high"
                            : rowMargin.percentNum >= 15
                            ? "is-medium"
                            : "is-low"
                        }`}
                      >
                        {rowMargin.percentDisplay}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}
                  </td>
                )}

                {/* Edit Trigger */}
                <td className="p-2 text-center border-l border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => onOpenDetail(row.itemId)}
                    className="p-1 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] rounded transition-colors"
                    title={`Mở chi tiết ${row.name || ""}`}
                    aria-label={`Mở chi tiết ${row.name || ""}`}
                  >
                    <Settings2 size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {displayedTotals.map(row => {
            return (
              <tr
                key={row.id}
                className={
                  row.id === "SYSTEM_GROSS"
                    ? "bg-[var(--surface-soft)] font-bold border-t-2 border-[var(--border-strong)]"
                    : "bg-[var(--surface)] border-t border-[var(--border)]"
                }
              >
                <td colSpan={3} className="py-2.5 px-3 text-[var(--foreground)] font-semibold text-right">
                  {row.label}:
                </td>
                {viewFilter !== "BUY" && (
                  <>
                    <td colSpan={3} className="border-l border-[var(--border)]" />
                    <td className="text-right font-bold text-xs py-2.5 px-3 text-[var(--color-brand-900)]">
                      {row.incompleteSell || row.sell === undefined ? (
                        <span className="text-[var(--warning)] text-xs font-normal">Chưa đủ dữ liệu</span>
                      ) : (
                        displayMoney(row.sell)
                      )}
                    </td>
                  </>
                )}
                {viewFilter !== "SELL" && (
                  <>
                    <td className="border-l border-[var(--border)]" />
                    <td className="text-right font-bold text-xs py-2.5 px-3 text-[var(--info)]">
                      {row.buy === undefined ? (
                        "—"
                      ) : row.incompleteBuy ? (
                        <span className="text-[var(--warning)] text-xs font-normal">Chưa đủ dữ liệu</span>
                      ) : (
                        displayMoney(row.buy)
                      )}
                    </td>
                    {mode === "ic" && <td className="border-l border-[var(--border)]" />}
                  </>
                )}
                {((mode === "paired" && viewFilter === "ALL") || mode === "ic") && (
                  <td className="text-right font-mono font-bold text-xs py-2.5 px-3 border-l border-[var(--border)]">
                    {row.id === "SYSTEM_NET" && marginPercent !== null ? (
                      <span
                        className={`tf-worksheet-margin-badge ${
                          marginReady && estimatedMargin.numerator >= BigInt(0) ? "is-high" : "is-low"
                        }`}
                      >
                        {marginPercent}
                      </span>
                    ) : null}
                  </td>
                )}
                <td className="border-l border-[var(--border)]" />
              </tr>
            );
          })}
        </tfoot>
      </table>
    </div>
  );
}
