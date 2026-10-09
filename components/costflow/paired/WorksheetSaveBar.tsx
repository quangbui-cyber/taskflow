"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Presentation";
import { displayMoney, source as moneySource } from "@/lib/costflow/money";
import { workspaceSaveLabel } from "@/lib/costflow/workspaceFlow";
import type { CostFlowActionState } from "@/app/actions/costflow";
import type { PairedDraft } from "@/lib/costflow/types";

export interface WorksheetSaveBarProps {
  mode: "quote" | "paired" | "ic";
  locked: boolean;
  saveIc: boolean;
  onSaveIcChange: (saveIc: boolean) => void;
  saleTotal: { gross: string; incomplete: boolean; net: string; rawNet: string };
  buyTotal: { gross: string; incomplete: boolean; net: string; rawNet: string };
  marginReady: boolean;
  estimatedMargin: { numerator: bigint; denominator: bigint };
  marginPercent: string | null;
  hasBuyInputs: boolean;
  dirty: boolean;
  pending: boolean;
  draftId: string;
  quotationId: string;
  uncompletedRowCount: number;
  initial?: PairedDraft;
  priceReviewed: boolean;
  onPriceReviewedChange: (reviewed: boolean) => void;
  state: CostFlowActionState;
  capabilities: {
    previewCustomer?: boolean;
    finalizeQuotation?: boolean;
    configureQuotationTotals?: boolean;
  };
  embedded?: boolean;
  projectId: string;
  onSave: (command?: string) => void;
  onPreview: () => void;
  onFinalize: () => void;
  onStartPairedFromQuote: () => void;
}

export default function WorksheetSaveBar({
  mode,
  locked,
  saveIc,
  onSaveIcChange,
  saleTotal,
  buyTotal,
  marginReady,
  estimatedMargin,
  marginPercent,
  hasBuyInputs,
  dirty,
  pending,
  draftId,
  quotationId,
  uncompletedRowCount,
  initial,
  priceReviewed,
  onPriceReviewedChange,
  state,
  capabilities,
  embedded = false,
  projectId,
  onSave,
  onPreview,
  onFinalize,
  onStartPairedFromQuote
}: WorksheetSaveBarProps) {
  const statusSentence = dirty
    ? `Chưa lưu thay đổi${uncompletedRowCount > 0 ? ` · ${uncompletedRowCount} dòng chưa đủ dữ liệu` : ""}`
    : `Đã lưu nháp${uncompletedRowCount > 0 ? ` · ${uncompletedRowCount} dòng chưa đủ dữ liệu` : " · Sẵn sàng"}`;

  return (
    <div className="tf-paired-save-bar">
      <div className="tf-paired-totals">
        <div className="text-xs text-[var(--text-secondary)] font-medium pr-2 border-r border-[var(--border)] mr-1 hidden sm:block">
          {statusSentence}
        </div>
        {mode !== "ic" && (
          <span>
            Báo giá · sau VAT{" "}
            <strong>{saleTotal.incomplete ? "Chưa đủ dữ liệu" : displayMoney(saleTotal.gross)}</strong>
          </span>
        )}
        {mode !== "quote" && (
          <span>
            IC · sau VAT{" "}
            <strong>{buyTotal.incomplete ? "Chưa đủ dữ liệu" : displayMoney(buyTotal.gross)}</strong>
          </span>
        )}
        {mode === "paired" && (
          <span className="tf-paired-margin" title="Báo giá trước VAT − IC trước VAT; tỷ lệ trên báo giá trước VAT">
            <span>Margin dự toán{marginPercent !== null ? " · " + marginPercent : ""}</span>
            <strong>{marginReady ? displayMoney(moneySource(estimatedMargin)) : "Chưa đủ dữ liệu"}</strong>
          </span>
        )}
      </div>

      <div className="tf-paired-save-actions">
        {mode === "paired" && !locked && (
          <fieldset className="tf-paired-save-scope-group">
            <legend>Lần lưu này</legend>
            <label>
              <input type="radio" name="save-scope" checked={saveIc} onChange={() => onSaveIcChange(true)} /> Báo giá & IC
            </label>
            <label>
              <input type="radio" name="save-scope" checked={!saveIc} onChange={() => onSaveIcChange(false)} /> Chỉ Báo giá
            </label>
            {initial?.priceReviewRequired && (
              <label className="tf-paired-price-review">
                <input
                  type="checkbox"
                  checked={priceReviewed}
                  onChange={event => onPriceReviewedChange(event.target.checked)}
                />
                Đã rà giá bán, VAT và phí từ nguồn
              </label>
            )}
          </fieldset>
        )}
        <div className="tf-paired-save-buttons">
          {capabilities.previewCustomer && (
            <Button variant="secondary" size="sm" disabled={pending} onClick={onPreview}>
              Xem bản khách
            </Button>
          )}
          <Button size="sm" onClick={() => onSave()} loading={pending} loadingLabel="Đang lưu…">
            {workspaceSaveLabel(mode, saveIc)}
          </Button>
          {mode === "quote" && !embedded && draftId && (
            <Button variant="secondary" size="sm" disabled={pending || dirty} onClick={onStartPairedFromQuote}>
              Thêm IC song song
            </Button>
          )}
          {!embedded && capabilities.finalizeQuotation && (
            <Button variant="secondary" size="sm" disabled={pending} onClick={onFinalize}>
              Chốt phiên bản BG
            </Button>
          )}
        </div>
      </div>

      {mode === "paired" && !saveIc && hasBuyInputs && (
        <Alert tone="warning" title="Giá vốn và minh chứng chưa được lưu">
          Lần lưu này chỉ lưu Báo giá. Chọn “Báo giá & IC” để lưu dữ liệu mua đang nhập.
        </Alert>
      )}
      {state.error && <Alert tone="danger" title={state.error} />}
      {state.success && (
        <Alert tone="success" title={state.success}>
          {mode !== "quote" && state.revisionId && (
            <span className="tf-paired-next-actions">
              <Link href={`/projects/${projectId}/costflow?tab=ic`}>Mở Internal Cost</Link>
              {state.requestId && <Link href={`/workflow#request-${state.requestId}`}>Mở hồ sơ IC</Link>}
            </span>
          )}
        </Alert>
      )}
      {quotationId && (
        <a
          className="tf-link"
          target="_blank"
          rel="noopener"
          href={"/projects/" + projectId + "/costflow/quotations/" + quotationId + "/print"}
        >
          Mở báo giá đã xuất / lưu PDF ↗
        </a>
      )}
    </div>
  );
}
