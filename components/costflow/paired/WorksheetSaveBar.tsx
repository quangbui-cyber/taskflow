"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert } from "@/components/ui/Presentation";
import { displayMoney, source as moneySource } from "@/lib/costflow/money";
import { workspaceSaveLabel, type PairedSaveScope } from "@/lib/costflow/workspaceFlow";
import type { CostFlowActionState } from "@/app/actions/costflow";

export interface WorksheetSaveBarProps {
  mode: "quote" | "paired" | "ic";
  locked: boolean;
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
  state: CostFlowActionState;
  capabilities: { previewCustomer?: boolean; finalizeQuotation?: boolean; configureQuotationTotals?: boolean };
  embedded?: boolean;
  projectId: string;
  onSave: (scope: PairedSaveScope) => void;
  onPreview: () => void;
  onFinalize: () => void;
  onStartPairedFromQuote: () => void;
  onDismissSuccess: () => void;
}

export default function WorksheetSaveBar({
  mode,
  locked,
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
  state,
  capabilities,
  embedded = false,
  projectId,
  onSave,
  onPreview,
  onFinalize,
  onStartPairedFromQuote,
  onDismissSuccess
}: WorksheetSaveBarProps) {
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const defaultScope: PairedSaveScope = mode === "quote" || locked ? "QUOTE" : mode === "ic" ? "IC" : "BOTH";

  const runSave = (scope: PairedSaveScope) => {
    setSaveMenuOpen(false);
    if (
      scope === "QUOTE" && mode === "paired" && hasBuyInputs && typeof window !== "undefined" &&
      !window.confirm("Lần lưu này chỉ lưu Báo giá. Dữ liệu Giá vốn và minh chứng đang nhập sẽ không được lưu. Tiếp tục?")
    ) return;
    onSave(scope);
  };

  return (
    <div className="tf-paired-save-bar">
      <div className="tf-paired-totals">
        {mode !== "ic" && (
          <span title={`Báo giá sau VAT: ${saleTotal.incomplete ? "Chưa đủ dữ liệu" : displayMoney(saleTotal.gross)}`}>
            Báo giá · sau VAT <strong>{saleTotal.incomplete ? "Chưa đủ dữ liệu" : displayMoney(saleTotal.gross)}</strong>
          </span>
        )}
        {mode !== "quote" && (
          <span title={`IC sau VAT: ${buyTotal.incomplete ? "Chưa đủ dữ liệu" : displayMoney(buyTotal.gross)}`}>
            IC · sau VAT <strong>{buyTotal.incomplete ? "Chưa đủ dữ liệu" : displayMoney(buyTotal.gross)}</strong>
          </span>
        )}
        {mode === "paired" && (
          <span className="tf-paired-margin" title="Báo giá trước VAT − IC trước VAT; tỷ lệ trên báo giá trước VAT">
            <span>Margin{marginPercent !== null ? " · " + marginPercent : ""}</span>
            <strong>{marginReady ? displayMoney(moneySource(estimatedMargin)) : "Chưa đủ dữ liệu"}</strong>
          </span>
        )}
      </div>

      <div className="tf-paired-save-actions">
        <div className="tf-paired-save-buttons">
          {capabilities.previewCustomer && (
            <Button variant="secondary" size="sm" disabled={pending} onClick={onPreview}>Xem bản khách</Button>
          )}
          {mode === "paired" && !locked ? (
            <div className="tf-paired-split-save" onKeyDown={event => event.key === "Escape" && setSaveMenuOpen(false)}>
              <Button size="sm" onClick={() => runSave("BOTH")} loading={pending} loadingLabel="Đang lưu…">Lưu Báo giá & IC</Button>
              <div className="tf-paired-save-menu">
                <button
                  type="button"
                  className="tf-paired-save-menu-toggle"
                  aria-label="Chọn hướng lưu"
                  aria-haspopup="menu"
                  aria-expanded={saveMenuOpen}
                  disabled={pending}
                  onClick={() => setSaveMenuOpen(value => !value)}
                ><ChevronDown size={15} aria-hidden="true" /></button>
                {saveMenuOpen && (
                  <div className="tf-paired-save-menu-popover" role="menu" aria-label="Hướng lưu">
                    <button type="button" role="menuitem" onClick={() => runSave("BOTH")}>Lưu Báo giá & IC</button>
                    <button type="button" role="menuitem" onClick={() => runSave("QUOTE")}>Chỉ lưu Báo giá</button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!draftId}
                      title={!draftId ? "Lưu Báo giá & IC lần đầu để tạo nền Báo giá" : undefined}
                      onClick={() => runSave("IC")}
                    >Chỉ lưu IC</button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => runSave(defaultScope)} loading={pending} loadingLabel="Đang lưu…">
              {workspaceSaveLabel(mode, defaultScope)}
            </Button>
          )}
          {mode === "quote" && !embedded && draftId && (
            <Button variant="secondary" size="sm" disabled={pending || dirty} onClick={onStartPairedFromQuote}>Thêm IC song song</Button>
          )}
          {!embedded && capabilities.finalizeQuotation && (
            <Button variant="secondary" size="sm" disabled={pending} onClick={onFinalize}>Chốt phiên bản báo giá</Button>
          )}
        </div>
      </div>

      {state.error && <Alert tone="danger" title={state.error} />}
      <Dialog
        open={!!state.success}
        onClose={onDismissSuccess}
        title={state.success ?? "Lưu thành công"}
        description="Dữ liệu đã được hệ thống xác nhận."
        footer={<Button onClick={onDismissSuccess}>Đóng</Button>}
      >
        {mode !== "quote" && state.revisionId ? (
          <div className="tf-paired-next-actions">
            <Link href={`/projects/${projectId}/costflow?tab=ic`}>Mở Internal Cost</Link>
            {state.requestId && <Link href={`/workflow#request-${state.requestId}`}>Mở hồ sơ IC</Link>}
          </div>
        ) : (
          <p className="tf-ui-help">Bạn có thể tiếp tục chỉnh sửa hoặc đóng cửa sổ này.</p>
        )}
      </Dialog>
      {quotationId && (
        <a className="tf-link" target="_blank" rel="noopener" href={`/projects/${projectId}/costflow/quotations/${quotationId}/print`}>
          Mở báo giá đã xuất / lưu PDF ↗
        </a>
      )}
    </div>
  );
}
