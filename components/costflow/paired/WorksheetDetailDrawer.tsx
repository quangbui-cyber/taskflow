"use client";

import type { RefObject } from "react";
import { Paperclip, ArrowUp, ArrowDown } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { formatPriceInput, ungroupPriceInput } from "@/lib/costflow/inputFormat";
import { rowCompletion } from "@/lib/costflow/workspaceFlow";
import { childrenOf, orderedRows, groupAmount } from "@/lib/costflow/pairedPricing";
import { displayMoney } from "@/lib/costflow/money";
import type { PairedRow } from "@/lib/costflow/types";

export interface WorksheetDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  detail: PairedRow | null;
  outlineById: Map<string, { numberLabel: string; role: string }>;
  outline: { row: PairedRow; numberLabel: string; role: string }[];
  rows: PairedRow[];
  mode: "quote" | "paired" | "ic";
  locked: boolean;
  pending: boolean;
  detailIndex: number;
  detailOrderLength: number;
  detailTarget: "general" | "buy";
  detailBuySection: RefObject<HTMLElement | null>;
  detailBuyDisabled: boolean;
  detailSellDisabled: boolean;
  beneficiaryOptions: { id: string; name: string }[];
  onAdjacentDetail: (delta: number) => void;
  onUpdate: (id: string, value: Partial<PairedRow>) => void;
  onSide: (row: PairedRow, scope: "sell" | "buy", field: string, value: string) => void;
  onAdd: (rowType: "GROUP" | "ITEM", parent?: string | null, after?: string) => void;
  onMove: (id: string, delta: number) => void;
  onChangeParent: (row: PairedRow, parentItemId: string | null) => void;
  onRemoveFromQuote: (detailId: string) => void;
  onRequestDelete: (detailId: string) => void;
  onOpenEvidence: (targets: string[]) => void;
  onCreateBeneficiaryClick: (itemId: string) => void;
  onModeChangePrompt: (change: { id: string; mode: "PACKAGE" | "DETAIL" }) => void;
  onError: (msg: string) => void;
}

export default function WorksheetDetailDrawer({
  open,
  onClose,
  detail,
  outlineById,
  outline,
  rows,
  mode,
  locked,
  pending,
  detailIndex,
  detailOrderLength,
  detailBuySection,
  detailBuyDisabled,
  detailSellDisabled,
  beneficiaryOptions,
  onAdjacentDetail,
  onUpdate,
  onSide,
  onAdd,
  onMove,
  onChangeParent,
  onRemoveFromQuote,
  onRequestDelete,
  onOpenEvidence,
  onCreateBeneficiaryClick,
  onModeChangePrompt,
  onError
}: WorksheetDetailDrawerProps) {
  if (!open || !detail) return null;

  const outlineEntry = outlineById.get(detail.itemId);
  const numberLabel = outlineEntry?.numberLabel ? `${outlineEntry.numberLabel} · ` : "";
  const title =
    (mode === "ic"
      ? "Chi tiết Internal Cost · "
      : detail.rowType === "GROUP"
      ? "Thiết lập nhóm · "
      : "Chi tiết · ") +
    `${numberLabel}${detail.name || (detail.rowType === "GROUP" ? "Nhóm" : "Hạng mục")}`;

  const description =
    mode === "ic"
      ? "Cấu trúc và giá bán lấy từ báo giá nguồn. Giá vốn và thông tin nội bộ được lưu trong nháp IC."
      : "Thay đổi ở đây được giữ trong bảng. Bấm lưu nháp để lưu vào hệ thống.";

  const detailRole = outline.find(entry => entry.row.itemId === detail.itemId)?.role;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" disabled={detailIndex <= 0} onClick={() => onAdjacentDetail(-1)}>
            Dòng trước
          </Button>
          <Button
            variant="ghost"
            disabled={detailIndex < 0 || detailIndex >= detailOrderLength - 1}
            onClick={() => onAdjacentDetail(1)}
          >
            Dòng sau
          </Button>
          <Button onClick={onClose}>Xong</Button>
        </>
      }
    >
      <fieldset
        disabled={pending}
        className="tf-paired-detail space-y-4"
        onKeyDown={event => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onAdjacentDetail(1);
          }
        }}
      >
        <Input
          label={detail.rowType === "GROUP" ? "Tên nhóm" : "Tên hạng mục"}
          readOnly={mode === "ic"}
          value={detail.name}
          onChange={e => onUpdate(detail.itemId, { name: e.target.value })}
        />
        <Textarea
          label={detail.rowType === "GROUP" ? "Mô tả nhóm" : "Mô tả hạng mục"}
          rows={2}
          readOnly={mode === "ic"}
          value={detail.description}
          onChange={e => onUpdate(detail.itemId, { description: e.target.value })}
        />

        {mode === "ic" && detail.rowType === "ITEM" && (
          <div className="tf-ic-source-summary" aria-label="Giá bán nguồn chỉ đọc">
            <span>
              <small>ĐVT / SL / Số ngày bán</small>
              <strong>
                {detail.sell.unit || "—"} / {detail.sell.quantity || "—"} / {detail.sell.days || "—"}
              </strong>
            </span>
            <span>
              <small>Đơn giá bán</small>
              <strong>{detail.sell.unitPrice ? formatPriceInput(detail.sell.unitPrice) : "—"}</strong>
            </span>
            <span>
              <small>Thành tiền bán trước VAT</small>
              <strong>
                {groupAmount(rows, detail, "sell") ? displayMoney(groupAmount(rows, detail, "sell")!.net) : "—"}
              </strong>
            </span>
          </div>
        )}

        {detail.rowType === "ITEM" && (
          <div className="tf-paired-detail-pricing">
            {((mode === "quote" ? ["sell"] : mode === "ic" ? ["buy"] : ["sell", "buy"]) as ("sell" | "buy")[]).map(
              scope => {
                const completion = rowCompletion(detail)[scope];
                return (
                  <section
                    key={scope}
                    ref={scope === "buy" ? detailBuySection : undefined}
                    tabIndex={scope === "buy" ? -1 : undefined}
                  >
                    <h3>
                      {scope === "sell" ? "Báo giá khách" : "IC nội bộ"}
                      <span
                        className="tf-paired-completion"
                        data-complete={completion.complete === completion.total || undefined}
                      >
                        {completion.complete}/{completion.total}
                      </span>
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label={"ĐVT " + (scope === "sell" ? "bán" : "mua")}
                        disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                        value={detail[scope].unit}
                        onChange={e => onSide(detail, scope, "unit", e.target.value)}
                      />
                      <Input
                        label={"Số lượng " + (scope === "sell" ? "bán" : "mua")}
                        inputMode="decimal"
                        disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                        value={detail[scope].quantity}
                        onChange={e => onSide(detail, scope, "quantity", e.target.value)}
                      />
                      <div>
                        <Input
                          label={"Số ngày " + (scope === "sell" ? "bán" : "mua")}
                          inputMode="decimal"
                          disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                          value={detail[scope].days}
                          onChange={e => onSide(detail, scope, "days", e.target.value)}
                        />
                        {scope === "buy" && detail.sell.days && detail.buy.days !== detail.sell.days && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={detailBuyDisabled}
                            onClick={() => onSide(detail, "buy", "days", detail.sell.days)}
                          >
                            Dùng ngày bán ({detail.sell.days})
                          </Button>
                        )}
                      </div>
                      <Input
                        label={scope === "sell" ? "Đơn giá bán" : "Giá vốn"}
                        inputMode="decimal"
                        disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                        value={formatPriceInput(detail[scope].unitPrice)}
                        onChange={e => onSide(detail, scope, "unitPrice", ungroupPriceInput(e.target.value))}
                      />
                      <Input
                        label={"VAT " + (scope === "sell" ? "bán" : "mua") + " (%)"}
                        inputMode="decimal"
                        disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                        value={detail[scope].vatPercent}
                        onChange={e => onSide(detail, scope, "vatPercent", e.target.value)}
                      />
                      <Select
                        label={"Đơn giá " + (scope === "sell" ? "bán" : "mua") + " gồm VAT?"}
                        disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                        value={detail[scope].basis}
                        onChange={e => onSide(detail, scope, "basis", e.target.value)}
                      >
                        <option value="NET">Chưa VAT</option>
                        <option value="GROSS">Gồm VAT</option>
                      </Select>
                    </div>
                    {scope === "sell" ? (
                      <Textarea
                        label="Ghi chú cho khách · dòng này"
                        rows={2}
                        value={detail.sell.notes}
                        disabled={!!detail.saleRemoved}
                        onChange={e => onSide(detail, "sell", "notes", e.target.value)}
                      />
                    ) : (
                      <>
                        <Select
                          label="Nhà cung cấp"
                          value={detail.buy.vendorId}
                          disabled={locked}
                          onChange={e => {
                            if (e.target.value === "__CREATE_BENEFICIARY__") {
                              onCreateBeneficiaryClick(detail.itemId);
                              return;
                            }
                            onSide(detail, "buy", "vendorId", e.target.value);
                          }}
                        >
                          <option value="">Chưa chọn</option>
                          {beneficiaryOptions.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                          <option value="__CREATE_BENEFICIARY__">＋ Tạo nhà cung cấp mới…</option>
                        </Select>
                        <Textarea
                          label="Ghi chú nội bộ · không xuất cho khách"
                          rows={2}
                          value={detail.buy.notes}
                          disabled={locked}
                          onChange={e => onSide(detail, "buy", "notes", e.target.value)}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onOpenEvidence([detail.itemId])}
                        >
                          <Paperclip size={14} aria-hidden="true" />
                          Minh chứng ·{" "}
                          {detail.buy.evidenceIds.length
                            ? detail.buy.evidenceIds.length + " file"
                            : detail.buy.evidenceReason
                            ? "Có lý do"
                            : "Chưa có minh chứng"}
                        </Button>
                      </>
                    )}
                  </section>
                );
              }
            )}
          </div>
        )}

        {mode !== "ic" && detail.rowType === "GROUP" && (
          <>
            <label className="tf-paired-save-scope">
              <input
                type="checkbox"
                checked={detail.showGroupSubtotal}
                onChange={e => onUpdate(detail.itemId, { showGroupSubtotal: e.target.checked })}
              />{" "}
              Hiện tổng nhóm trên editor và bản khách
            </label>
            <label className="tf-paired-save-scope">
              <input
                type="checkbox"
                checked={detail.showChildren}
                onChange={e => onUpdate(detail.itemId, { showChildren: e.target.checked })}
              />{" "}
              Hiện hạng mục của nhóm trên bản khách
            </label>
          </>
        )}

        {mode !== "ic" && detail.rowType === "ITEM" && childrenOf(rows, detail.itemId).length > 0 && (
          <>
            <Select
              label={"Cách định giá " + detail.name}
              value={detail.pricingMode}
              onChange={e => onModeChangePrompt({ id: detail.itemId, mode: e.target.value as "PACKAGE" | "DETAIL" })}
            >
              <option value="PACKAGE">Giá gói</option>
              <option value="DETAIL">Giá chi tiết</option>
            </Select>
            {detail.pricingMode === "PACKAGE" && (
              <Select
                label="Thông tin dòng con trên báo giá"
                value={detail.packageChildDisplay}
                onChange={e =>
                  onUpdate(detail.itemId, { packageChildDisplay: e.target.value as "CONTENT" | "QUANTITY" })
                }
              >
                <option value="CONTENT">Chỉ tên và mô tả</option>
                <option value="QUANTITY">Hiện thêm ĐVT và số lượng</option>
              </Select>
            )}
            <label className="tf-paired-save-scope">
              <input
                type="checkbox"
                checked={detail.showChildren}
                onChange={e => onUpdate(detail.itemId, { showChildren: e.target.checked })}
              />{" "}
              Hiện dòng con trên báo giá khách
            </label>
          </>
        )}

        {detail.rowType === "ITEM" && (
          <Select
            disabled={mode === "ic"}
            label="Thuộc nhóm / hạng mục"
            value={detail.parentItemId ?? ""}
            onChange={e => onChangeParent(detail, e.target.value || null)}
          >
            <option value="">Cấp gốc</option>
            {outline
              .filter(
                entry =>
                  entry.row.itemId !== detail.itemId &&
                  !orderedRows(rows, detail.itemId).some(child => child.row.itemId === entry.row.itemId) &&
                  (entry.role === "GROUP" || entry.role === "ITEM")
              )
              .map(entry => (
                <option key={entry.row.itemId} value={entry.row.itemId}>
                  {entry.numberLabel ? entry.numberLabel + " · " : ""}
                  {entry.row.name || (entry.role === "GROUP" ? "Nhóm chưa đặt tên" : "Hạng mục chưa đặt tên")}
                </option>
              ))}
          </Select>
        )}

        {mode !== "ic" && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onAdd(detail.rowType, detail.parentItemId, detail.itemId);
                onClose();
              }}
            >
              Thêm dòng sau
            </Button>
            {detailRole !== "DETAIL" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (
                    detail.rowType === "ITEM" &&
                    (detail.buy.unitPrice || detail.buy.evidenceIds.length || detail.buy.evidenceReason)
                  ) {
                    onError("Dòng có chi phí riêng: chưa thể tạo chi tiết con vì sẽ làm trùng nguồn chi phí.");
                    onClose();
                    return;
                  }
                  onAdd("ITEM", detail.itemId);
                  onClose();
                }}
              >
                {detail.rowType === "GROUP" ? "Thêm hạng mục" : "Thêm chi tiết con"}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onMove(detail.itemId, -1)}>
              <ArrowUp size={14} aria-hidden="true" />
              Lên
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onMove(detail.itemId, 1)}>
              <ArrowDown size={14} aria-hidden="true" />
              Xuống
            </Button>
            {!detail.saleRemoved ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (typeof window !== "undefined" && !window.confirm("Bạn có chắc chắn muốn bỏ dòng này khỏi báo giá?")) return;
                  onRemoveFromQuote(detail.itemId);
                  onClose();
                }}
              >
                Bỏ khỏi báo giá
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => onUpdate(detail.itemId, { saleRemoved: false })}>
                Khôi phục dòng vào báo giá
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                onRequestDelete(detail.itemId);
                onClose();
              }}
            >
              Xóa hẳn
            </Button>
          </div>
        )}
      </fieldset>
    </Dialog>
  );
}
