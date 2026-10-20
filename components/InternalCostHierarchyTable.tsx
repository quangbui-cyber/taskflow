"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight, Paperclip, SquarePen } from "lucide-react";
import { displayMoney } from "@/lib/costflow/money";
import { formatPriceInput } from "@/lib/costflow/inputFormat";
import { groupAmount } from "@/lib/costflow/pairedPricing";
import { quotationOutline } from "@/lib/costflow/quotationHierarchy";
import type { PairedRow } from "@/lib/costflow/types";
import { Table } from "./ui/Presentation";

type InternalCostTotalRow = {
  id: string;
  label: string;
  sell?: string;
  buy?: string;
  incompleteSell: boolean;
  incompleteBuy: boolean;
};

function missingBuyLabel(row: PairedRow, detailPricedParent: boolean) {
  if (detailPricedParent) return "Thiếu dữ liệu chi tiết";
  const missing = [
    !row.buy.quantity && "SL mua",
    !row.buy.unitPrice && "giá vốn",
  ].filter(Boolean);
  return missing.length ? `Thiếu ${missing.join(" và ")}` : "Chưa đủ dữ liệu";
}

export default function InternalCostHierarchyTable({
  rows,
  totals,
  collapsed,
  selected,
  locked,
  onCollapsed,
  onSelected,
  onOpen,
}: {
  rows: PairedRow[];
  totals: InternalCostTotalRow[];
  collapsed: string[];
  selected: string[];
  locked: boolean;
  onCollapsed: (ids: string[]) => void;
  onSelected: (ids: string[]) => void;
  onOpen: (id: string) => void;
}) {
  const view = useMemo(() => {
    const rowById = new Map(rows.map(row => [row.itemId, row]));
    const childrenByParent = new Map<string | null, PairedRow[]>();
    rows.forEach(row => childrenByParent.set(row.parentItemId, [...(childrenByParent.get(row.parentItemId) ?? []), row]));
    const collapsedSet = new Set(collapsed);
    const outline = quotationOutline(rows).filter(({ row }) => {
      let parent = row.parentItemId;
      while (parent) {
        if (collapsedSet.has(parent)) return false;
        parent = rowById.get(parent)?.parentItemId ?? null;
      }
      return true;
    });
    const amounts = new Map(rows.map(row => [row.itemId, {
      sell: groupAmount(rows, row, "sell"),
      buy: groupAmount(rows, row, "buy"),
    }]));
    return { amounts, childrenByParent, outline, rowById };
  }, [collapsed, rows]);

  const toggle = (id: string) => onCollapsed(collapsed.includes(id) ? collapsed.filter(value => value !== id) : [...collapsed, id]);

  return <><Table caption="Internal Cost từ báo giá nguồn" hideCaption className="tf-paired-table tf-paired-workspace-table tf-internal-cost-hierarchy-table">
    <colgroup>
      <col className="tf-ic-structure-col" />
      <col className="tf-ic-description-col" />
      <col className="tf-ic-buy-unit-col" />
      <col className="tf-ic-buy-price-col" />
      <col className="tf-ic-buy-amount-col" />
      <col className="tf-ic-source-unit-col" />
      <col className="tf-ic-source-price-col" />
      <col className="tf-ic-source-amount-col" />
    </colgroup>
    <thead>
      <tr className="tf-paired-groups tf-ic-header-groups">
        <th colSpan={2} scope="colgroup">Hạng mục</th>
        <th colSpan={3} scope="colgroup">Internal Cost {locked && "· Chỉ đọc"}</th>
        <th colSpan={3} scope="colgroup">Báo giá nguồn · chỉ đọc</th>
      </tr>
      <tr className="tf-ic-column-headings">
        <th scope="col">Tên hạng mục</th>
        <th scope="col">Mô tả</th>
        <th scope="col">ĐVT / SL mua</th>
        <th scope="col">Giá vốn</th>
        <th scope="col">Thành tiền IC</th>
        <th scope="col">ĐVT / SL bán</th>
        <th scope="col">Đơn giá bán</th>
        <th scope="col">Thành tiền bán</th>
      </tr>
    </thead>
    <tbody>{view.outline.map(({ row, role, numberLabel }, visibleIndex) => {
      const children = view.childrenByParent.get(row.itemId) ?? [];
      const descendantCount = rows.filter(candidate => {
        let parent = candidate.parentItemId;
        while (parent) {
          if (parent === row.itemId) return true;
          parent = view.rowById.get(parent)?.parentItemId ?? null;
        }
        return false;
      }).length;
      const collapsedRow = collapsed.includes(row.itemId);
      const amounts = view.amounts.get(row.itemId);
      const structuralGroup = role === "GROUP";
      const detailPricedParent = children.length > 0 && row.pricingMode === "DETAIL";
      const editableCostRow = !structuralGroup && children.length === 0;
      const evidenceLabel = row.buy.evidenceIds.length
        ? `${row.buy.evidenceIds.length} minh chứng`
        : row.buy.evidenceReason
          ? "Có lý do thay thế"
          : "Chưa có minh chứng";

      if (structuralGroup) return <tr key={row.itemId} className="tf-ic-group-row">
        <th colSpan={8} scope="rowgroup">
          <div className="tf-ic-group-band">
            <button type="button" className="tf-quotation-group-toggle" aria-label={(collapsedRow ? "Mở rộng nhóm " : "Thu gọn nhóm ") + (row.name || numberLabel)} aria-expanded={!collapsedRow} onClick={() => toggle(row.itemId)}>
              <span className="tf-quotation-group-chevron">{collapsedRow ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</span>
              <span className="tf-quotation-outline-number">{numberLabel}</span>
            </button>
            <button type="button" className="tf-ic-group-name" aria-expanded={!collapsedRow} onClick={() => toggle(row.itemId)}>{row.name || "Nhóm chưa đặt tên"}</button>
            <span className="tf-ic-group-count">{descendantCount ? `${descendantCount} hạng mục` : "Nhóm trống"}</span>
            {descendantCount > 0 && <><span className="tf-ic-group-total is-buy"><small>IC</small><strong>{amounts?.buy ? displayMoney(amounts.buy.net) : "Chưa đủ dữ liệu"}</strong></span>
            <span className="tf-ic-group-total is-source"><small>Báo giá</small><strong>{amounts?.sell ? displayMoney(amounts.sell.net) : "—"}</strong></span></>}
          </div>
        </th>
      </tr>;

      return <tr key={row.itemId} className={role === "DETAIL" ? "tf-ic-detail-row" : "tf-ic-item-row"} data-sale-removed={row.saleRemoved || undefined}>
        <th scope="row" className="tf-ic-structure-cell">
          <div className="tf-ic-structure-row">
            {editableCostRow && <label className="tf-ic-select" aria-label={`Chọn ${row.name || `dòng ${visibleIndex + 1}`} để gắn minh chứng`}>
              <input type="checkbox" disabled={locked} checked={selected.includes(row.itemId)} onChange={event => onSelected(event.target.checked ? [...selected, row.itemId] : selected.filter(id => id !== row.itemId))} />
            </label>}
            {!editableCostRow && <span className="tf-ic-select-spacer" aria-hidden="true" />}
            {children.length > 0 ? <button type="button" className="tf-quotation-row-toggle" aria-label={(collapsedRow ? "Mở rộng " : "Thu gọn ") + (row.name || "hạng mục")} aria-expanded={!collapsedRow} onClick={() => toggle(row.itemId)}>{collapsedRow ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button> : <span className="tf-quotation-row-toggle-spacer" aria-hidden="true" />}
            <span className="tf-quotation-outline-number">{numberLabel}</span>
            <button type="button" className="tf-ic-open-detail" aria-label={`${row.name || `Hạng mục ${visibleIndex + 1}`} · Mở chi tiết Internal Cost`} aria-haspopup="dialog" onClick={() => onOpen(row.itemId)}>
              <span className="tf-ic-open-detail-copy"><span>{row.name || "Hạng mục chưa đặt tên"}</span>{role === "DETAIL" && <small>Chi tiết con</small>}</span>
              <SquarePen size={14} aria-hidden="true" />
            </button>
          </div>
          {row.saleRemoved && <p className="tf-ui-help">Đã bỏ khỏi báo giá · giá vốn được giữ</p>}
        </th>
        <td className="tf-ic-description-cell"><button type="button" className="tf-ic-readonly-button" aria-label={`Mô tả ${row.name || "hạng mục"} · Mở chi tiết Internal Cost`} title={row.description || "Chưa có mô tả"} onClick={() => onOpen(row.itemId)}>{row.description || "Chưa có mô tả"}</button></td>
        <td className="tf-ic-buy-cell"><button type="button" disabled={locked || !editableCostRow} aria-label={`ĐVT và số lượng mua ${row.name || "hạng mục"} · Mở chi tiết`} onClick={() => onOpen(row.itemId)}><span>{row.buy.unit || "—"}</span><small>{row.buy.quantity ? `SL ${row.buy.quantity}` : "Chưa nhập SL"}</small></button></td>
        <td className="tf-ic-buy-cell tf-ic-money-cell"><button type="button" disabled={locked || !editableCostRow} aria-label={`Giá vốn ${row.name || "hạng mục"} · Mở chi tiết`} onClick={() => onOpen(row.itemId)}><span>{detailPricedParent ? "Theo chi tiết" : row.buy.unitPrice ? formatPriceInput(row.buy.unitPrice) : "Chưa nhập"}</span><small className={row.buy.evidenceIds.length || row.buy.evidenceReason ? "is-ready" : "is-missing"}><Paperclip size={11} aria-hidden="true" />{evidenceLabel}</small></button></td>
        <td className="tf-ic-buy-cell tf-ic-money-cell"><button type="button" disabled={locked || !editableCostRow} aria-label={`Thành tiền IC ${row.name || "hạng mục"} · ${amounts?.buy ? "Mở chi tiết" : missingBuyLabel(row, detailPricedParent)}`} onClick={() => onOpen(row.itemId)}>{amounts?.buy ? displayMoney(amounts.buy.net) : <span className="tf-ic-missing-summary"><span>{missingBuyLabel(row, detailPricedParent)}</span><span className="is-compact">Thiếu dữ liệu</span></span>}</button></td>
        <td className="tf-ic-source-cell"><span>{row.sell.unit || "—"}</span><small>{row.sell.quantity ? `SL ${row.sell.quantity}` : "Chưa có SL"}</small></td>
        <td className="tf-ic-source-cell tf-ic-money-cell">{detailPricedParent ? <small>Theo chi tiết</small> : row.sell.unitPrice ? formatPriceInput(row.sell.unitPrice) : "—"}</td>
        <td className="tf-ic-source-cell tf-ic-money-cell">{amounts?.sell ? displayMoney(amounts.sell.net) : "—"}</td>
      </tr>;
    })}</tbody>
    <tfoot>{totals.map(total => <tr key={total.id} className={total.id === "SYSTEM_GROSS" ? "tf-paired-grand-total" : ""}>
      <th scope="row" colSpan={4}>{total.label}</th>
      <td className="tf-paired-amount tf-paired-buy-total">{total.incompleteBuy || total.buy === undefined ? "Chưa đủ dữ liệu" : displayMoney(total.buy)}</td>
      <td colSpan={2} />
      <td className="tf-paired-amount tf-paired-sell-total">{total.incompleteSell || total.sell === undefined ? "Chưa đủ dữ liệu" : displayMoney(total.sell)}</td>
    </tr>)}</tfoot>
  </Table>
  <div className="tf-ic-mobile-totals" role="table" aria-label="Tổng Internal Cost và báo giá nguồn">
    <div className="tf-ic-mobile-total-head" role="row"><span role="columnheader">Tổng tiền</span><span role="columnheader">IC</span><span role="columnheader">Báo giá</span></div>
    {totals.map(total => <div key={total.id} className={total.id === "SYSTEM_GROSS" ? "tf-ic-mobile-total-row is-grand" : "tf-ic-mobile-total-row"} role="row">
      <strong role="rowheader">{total.label}</strong>
      <span role="cell">{total.incompleteBuy || total.buy === undefined ? "Chưa đủ dữ liệu" : displayMoney(total.buy)}</span>
      <span role="cell">{total.incompleteSell || total.sell === undefined ? "Chưa đủ dữ liệu" : displayMoney(total.sell)}</span>
    </div>)}
  </div></>;
}
