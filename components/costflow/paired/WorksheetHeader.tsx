"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Plus, ChevronsDownUp, ChevronsUpDown, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { displayMoney } from "@/lib/costflow/money";
import type { Quotation } from "@/lib/costflow/types";
import { PairedInsertMenu } from "./WorksheetHelpers";

export interface WorksheetHeaderProps {
  mode: "quote" | "paired" | "ic";
  title: string;
  source?: Quotation;
  clientId: string;
  clientName?: string;
  targetRevenue?: number;
  embedded?: boolean;
  versionAction?: ReactNode;
  roundTripAction?: ReactNode;
  pending: boolean;
  locked: boolean;
  viewFilter: "ALL" | "SELL" | "BUY";
  onViewFilterChange: (filter: "ALL" | "SELL" | "BUY") => void;
  visibleRowsCount: number;
  totalRowsCount: number;
  groupRowsCount: number;
  selectedCount: number;
  globalEvidenceCount: number;
  projectId: string;
  onCollapseGroups: () => void;
  onExpandAll: () => void;
  onAddRow: (rowType: "GROUP" | "ITEM") => void;
  onOpenEvidenceTargets: (targets: string[]) => void;
  onOpenGlobalEvidence: () => void;
  onOpenSettings: () => void;
  onFinalize: () => void;
  onBack: () => void;
}

export default function WorksheetHeader({
  mode,
  title,
  source,
  clientName,
  targetRevenue,
  embedded = false,
  versionAction,
  roundTripAction,
  pending,
  locked,
  viewFilter,
  onViewFilterChange,
  visibleRowsCount,
  totalRowsCount,
  groupRowsCount,
  selectedCount,
  globalEvidenceCount,
  projectId,
  onCollapseGroups,
  onExpandAll,
  onAddRow,
  onOpenEvidenceTargets,
  onOpenGlobalEvidence,
  onOpenSettings,
  onFinalize,
  onBack
}: WorksheetHeaderProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      {/* SECTION HEADING */}
      <div className="tf-section-heading tf-paired-workspace-heading">
        <div>
          {mode !== "paired" && (
            <div className="flex items-center gap-2">
              <p className="tf-paired-eyebrow">{mode === "quote" ? "Scope / Báo giá" : "IC từ báo giá"}</p>
            </div>
          )}
          <h2>{title || "Chưa đặt tên báo giá"}</h2>
          {embedded && mode === "quote" && (
            <p className="tf-ui-help">{clientName || "Chưa chọn khách hàng"}</p>
          )}
        </div>
        {embedded && mode === "quote" && source ? (
          <div className="tf-scope-version-actions" aria-label="Thao tác phiên bản báo giá">
            <Button variant="secondary" size="sm" disabled={pending} onClick={onOpenSettings}>
              Thiết lập báo giá
            </Button>
            <Link
              className="tf-button-secondary tf-button-size-sm"
              href={`/projects/${projectId}/costflow/quotations/${source.id}/print`}
            >
              Xuất báo giá
            </Link>
            <Link
              className="tf-button-secondary tf-button-size-sm"
              href={`/projects/${projectId}/costflow/quotations/${source.id}/ic`}
            >
              Lập IC từ Báo giá #{source.number}
            </Link>
            {versionAction}
            <Button size="sm" disabled={pending} onClick={onFinalize}>
              Chốt phiên bản báo giá
            </Button>
          </div>
        ) : !embedded && (
          <div className="tf-scope-version-actions" aria-label="Thao tác worksheet">
            {roundTripAction}
            <Button variant="secondary" size="sm" disabled={pending} onClick={onBack}>
              Quay lại
            </Button>
          </div>
        )}
      </div>

      {/* CLIENT / TARGET REVENUE METADATA */}
      {!(embedded && mode === "quote") && (
        <div className="tf-paired-info-summary">
          <div>
            <span className="tf-paired-info-label">{mode === "ic" ? "Báo giá nguồn" : "Khách hàng"}</span>
            <strong>
              {mode === "ic"
                ? source
                  ? `BG-${source.number} · ${source.title}`
                  : "Chưa chọn báo giá"
                : clientName || "Chưa chọn khách hàng"}
            </strong>
          </div>
          {targetRevenue && (
            <div className="bg-[var(--surface-soft)] border border-[var(--border)] rounded px-3 py-1.5 flex items-center gap-2">
              <span className="text-xs text-[var(--text-secondary)] font-medium">Doanh thu mục tiêu PO:</span>
              <strong className="text-[var(--success)] font-semibold">{displayMoney(String(targetRevenue))}</strong>
            </div>
          )}
          {mode !== "ic" && (
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>
              Thiết lập báo giá
            </Button>
          )}
        </div>
      )}

      {/* WORKSHEET TOOLBAR — SIMPLIFIED 3-ZONE LAYOUT */}
      <div className="tf-worksheet-toolbar">
        {/* Zone 1: View segmented control (mode paired) & Primary Actions */}
        <div className="tf-worksheet-toolbar-group">
          {mode === "paired" && (
            <div className="tf-worksheet-view-segmented" role="radiogroup" aria-label="Góc nhìn">
              <button
                type="button"
                className={`tf-worksheet-view-btn ${viewFilter === "ALL" ? "is-active" : ""}`}
                onClick={() => onViewFilterChange("ALL")}
              >
                Song song
              </button>
              <button
                type="button"
                className={`tf-worksheet-view-btn ${viewFilter === "SELL" ? "is-active" : ""}`}
                onClick={() => onViewFilterChange("SELL")}
              >
                Chỉ Báo giá khách
              </button>
              <button
                type="button"
                className={`tf-worksheet-view-btn ${viewFilter === "BUY" ? "is-active" : ""}`}
                onClick={() => onViewFilterChange("BUY")}
              >
                Chỉ Giá vốn IC
              </button>
            </div>
          )}

          {/* Zone 2: Add row action */}
          {mode !== "ic" && (
            <div className="tf-quotation-add-wrap tf-paired-add-wrap" data-paired-menu>
              <button
                type="button"
                className="tf-worksheet-btn-pill"
                aria-haspopup="menu"
                aria-expanded={addOpen}
                onClick={() => setAddOpen(v => !v)}
              >
                <Plus size={14} aria-hidden="true" /> Thêm dòng
              </button>
              {addOpen && (
                <PairedInsertMenu
                  actions={[
                    {
                      label: "Thêm nhóm",
                      onSelect: () => {
                        onAddRow("GROUP");
                        setAddOpen(false);
                      }
                    },
                    {
                      label: "Thêm hạng mục",
                      onSelect: () => {
                        onAddRow("ITEM");
                        setAddOpen(false);
                      }
                    }
                  ]}
                />
              )}
            </div>
          )}

          {/* Zone 3: Secondary controls & Utilities */}
          <button
            type="button"
            className="tf-worksheet-btn-pill"
            onClick={onCollapseGroups}
            title="Thu gọn nhanh về các nhóm"
          >
            <ChevronsDownUp size={14} aria-hidden="true" /> Thu gọn về nhóm ({groupRowsCount})
          </button>
          <button
            type="button"
            className="tf-worksheet-btn-pill"
            onClick={onExpandAll}
            title="Mở rộng toàn bộ các dòng"
          >
            <ChevronsUpDown size={14} aria-hidden="true" /> Mở rộng tất cả
          </button>

          {selectedCount > 0 && mode !== "quote" && (
            <button
              type="button"
              className="tf-worksheet-btn-pill"
              disabled={locked}
              onClick={() => onOpenEvidenceTargets([])}
            >
              <Paperclip size={14} aria-hidden="true" /> Gắn cho {selectedCount} dòng
            </button>
          )}
          {mode !== "quote" && (
            <button
              type="button"
              className="tf-worksheet-btn-pill"
              onClick={onOpenGlobalEvidence}
            >
              <Paperclip size={14} aria-hidden="true" /> Minh chứng chung ({globalEvidenceCount})
            </button>
          )}
        </div>

        {/* Counter */}
        <div className="tf-worksheet-toolbar-group">
          <span className="text-xs text-[var(--text-secondary)]">
            Hiển thị <strong>{visibleRowsCount}</strong> / <strong>{totalRowsCount}</strong> dòng
          </span>
        </div>
      </div>
    </>
  );
}
