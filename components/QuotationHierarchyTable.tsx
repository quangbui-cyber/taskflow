"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { displayMoney } from "@/lib/costflow/money";
import { formatPriceInput, ungroupPriceInput } from "@/lib/costflow/inputFormat";
import { groupAmount } from "@/lib/costflow/pairedPricing";
import { moveQuotationTree, quotationOutline } from "@/lib/costflow/quotationHierarchy";
import type { PairedRow } from "@/lib/costflow/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Field";
import { Table } from "./ui/Presentation";

type DropPosition = "before" | "inside" | "after";

const QUOTATION_UNITS = ["cái", "bộ", "gói", "m²", "giờ", "ngày"];

type QuotationTotalRow = {
  id: string;
  label: string;
  amount?: string;
  incomplete: boolean;
};

export default function QuotationHierarchyTable({ rows, totals, disabled, collapsed, onCollapsed, onRows, onOpen, onAdd, onError }: {
  rows: PairedRow[];
  totals: QuotationTotalRow[];
  disabled: boolean;
  collapsed: string[];
  onCollapsed: (ids: string[]) => void;
  onRows: (rows: PairedRow[]) => void;
  onOpen: (id: string) => void;
  onAdd: (rowType: "GROUP" | "ITEM", parentId: string | null, afterId?: string) => void;
  onError: (message: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [insertMenuId, setInsertMenuId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; position: DropPosition } | null>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
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
    const amounts = new Map(rows.map(row => [row.itemId, groupAmount(rows, row, "sell")]));
    return { rowById, childrenByParent, outline, amounts };
  }, [collapsed, rows]);
  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest("[data-quotation-menu]")) {
        setAddOpen(false);
        setMenuId(null);
        setInsertMenuId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAddOpen(false);
        setMenuId(null);
        setInsertMenuId(null);
      }
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  const update = (id: string, patch: Partial<PairedRow>) => onRows(rows.map(row => row.itemId === id ? { ...row, ...patch } : row));
  const side = (row: PairedRow, field: string, value: string) => update(row.itemId, { sell: { ...row.sell, [field]: value } });
  const toggle = (id: string) => onCollapsed(collapsed.includes(id) ? collapsed.filter(value => value !== id) : [...collapsed, id]);
  const dragStart = (event: DragEvent, id: string) => {
    setDragId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };
  const dragOver = (event: DragEvent, id: string) => {
    if (!dragId || dragId === id) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const position = ratio < .28 ? "before" : ratio > .72 ? "after" : "inside";
    setDrop(current => current?.id === id && current.position === position ? current : { id, position });
  };
  const performDrop = (event: DragEvent, target: PairedRow, position: DropPosition) => {
    event.preventDefault();
    const sourceId = dragId || event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === target.itemId) return;
    try {
      if (position === "inside") {
        const index = (view.childrenByParent.get(target.itemId) ?? []).length;
        onRows(moveQuotationTree(rows, sourceId, target.itemId, index));
      } else {
        const siblings = (view.childrenByParent.get(target.parentItemId) ?? []).filter(row => row.itemId !== sourceId);
        const targetIndex = siblings.findIndex(row => row.itemId === target.itemId);
        onRows(moveQuotationTree(rows, sourceId, target.parentItemId, targetIndex + (position === "after" ? 1 : 0)));
      }
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setDragId(null);
      setDrop(null);
    }
  };
  const dropAtRoot = (event: DragEvent) => {
    event.preventDefault();
    const sourceId = dragId || event.dataTransfer.getData("text/plain");
    if (!sourceId) return;
    try {
      onRows(moveQuotationTree(rows, sourceId, null, (view.childrenByParent.get(null) ?? []).filter(row => row.itemId !== sourceId).length));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setDragId(null);
      setDrop(null);
    }
  };

  const toggleGroupFromBand = (event: MouseEvent<HTMLDivElement>, id: string) => {
    if ((event.target as Element).closest("button, input, [role=menu]")) return;
    toggle(id);
  };

  return <div ref={menuRoot} className="tf-quotation-table-block">
    <div className="tf-quotation-add-wrap" data-quotation-menu>
      <Button disabled={disabled} variant="secondary" size="sm" aria-haspopup="menu" aria-expanded={addOpen} onClick={() => setAddOpen(value => !value)}><Plus size={14} aria-hidden="true" />Thêm dòng</Button>
      {addOpen && <div className="tf-quotation-row-menu" role="menu" aria-label="Thêm dòng báo giá">
        <button type="button" role="menuitem" onClick={() => { onAdd("GROUP", null); setAddOpen(false); }}>Thêm nhóm</button>
        <button type="button" role="menuitem" onClick={() => { onAdd("ITEM", null); setAddOpen(false); }}>Thêm hạng mục</button>
      </div>}
    </div>
    <datalist id="quotation-units">{QUOTATION_UNITS.map(option => <option key={option} value={option} />)}</datalist>
    <Table caption="Hạng mục báo giá khách" hideCaption className="tf-paired-table tf-paired-workspace-table tf-quotation-hierarchy-table">
      <colgroup>
        <col className="tf-quotation-structure-col" />
        <col className="tf-quotation-description-col" />
        <col className="tf-quotation-unit-col" />
        <col className="tf-quotation-quantity-col" />
        <col className="tf-quotation-price-col" />
        <col className="tf-quotation-amount-col" />
        <col className="tf-quotation-actions-col" />
      </colgroup>
      <thead>
        <tr className="tf-quotation-header-groups">
          <th colSpan={2} scope="colgroup">Hạng mục</th>
          <th colSpan={4} scope="colgroup">Báo giá khách</th>
          <th rowSpan={2} className="tf-quotation-actions-header" scope="col"><span className="sr-only">Thao tác</span></th>
        </tr>
        <tr className="tf-quotation-column-headings">
          <th className="tf-quotation-structure-header" scope="col">Tên hạng mục</th>
          <th className="tf-quotation-description-header" scope="col">Mô tả hạng mục</th>
          <th className="tf-quotation-unit-header" scope="col">ĐVT</th>
          <th className="tf-quotation-quantity-header" scope="col">SL</th>
          <th className="tf-quotation-price-header" scope="col">Đơn giá</th>
          <th className="tf-quotation-amount-header" scope="col">Thành tiền</th>
        </tr>
      </thead>
      <tbody>{view.outline.map(({ row, role, numberLabel }, visibleIndex) => {
        const children = view.childrenByParent.get(row.itemId) ?? [];
        const parent = row.parentItemId ? view.rowById.get(row.parentItemId) : undefined;
        const collapsedRow = collapsed.includes(row.itemId);
        const descriptiveChild = role === "DETAIL" && parent?.pricingMode === "PACKAGE";
        const quantityOnly = descriptiveChild && parent?.packageChildDisplay === "QUANTITY";
        const detailPricedParent = children.length > 0 && row.pricingMode === "DETAIL";
        const priceDisabled = row.saleRemoved === true || detailPricedParent;
        const amount = view.amounts.get(row.itemId);
        const dropPosition = drop?.id === row.itemId ? drop.position : undefined;
        const nextRowId = view.outline.slice(visibleIndex + 1).find(entry => entry.role !== "GROUP")?.row.itemId;
        if (role === "GROUP") return <tr key={row.itemId} className={`tf-quotation-group-row${insertMenuId===row.itemId || menuId===row.itemId ? " is-menu-open" : ""}`} data-drop-position={dropPosition} onDragOver={event=>dragOver(event,row.itemId)} onDrop={event=>performDrop(event,row,drop?.position ?? "inside")}>
          <th colSpan={7} scope="rowgroup"><div className="tf-quotation-group-band" onClick={event=>toggleGroupFromBand(event,row.itemId)}>
            <div className="tf-quotation-insert-wrap" data-quotation-menu><button type="button" className="tf-quotation-icon-button tf-quotation-insert-button" aria-label={`Thêm dòng trong nhóm ${row.name || numberLabel}`} title="Thêm dòng" aria-haspopup="menu" aria-expanded={insertMenuId===row.itemId} disabled={disabled} onClick={()=>{setMenuId(null);setInsertMenuId(insertMenuId===row.itemId ? null : row.itemId);}}><Plus size={15} aria-hidden="true" /></button>{insertMenuId===row.itemId && <InsertMenu actions={[{label:"Thêm nhóm bên dưới",onSelect:()=>{onAdd("GROUP",null,row.itemId);setInsertMenuId(null);}},{label:"Thêm hạng mục trong nhóm",onSelect:()=>{onAdd("ITEM",row.itemId);setInsertMenuId(null);}}]} />}</div>
            <button type="button" className="tf-quotation-drag-handle" draggable={!disabled} onDragStart={event=>dragStart(event,row.itemId)} onDragEnd={()=>{setDragId(null);setDrop(null);}} aria-label={`Kéo để sắp xếp nhóm ${row.name || numberLabel}`} title="Kéo để sắp xếp"><GripVertical size={15} aria-hidden="true" /></button>
            <button type="button" className="tf-quotation-group-toggle" aria-label={(collapsedRow ? "Mở rộng nhóm " : "Thu gọn nhóm ")+(row.name||numberLabel)} aria-expanded={!collapsedRow} onClick={()=>toggle(row.itemId)}><span className="tf-quotation-group-chevron">{collapsedRow ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</span><span className="tf-quotation-outline-number">{numberLabel}</span></button>
            <input data-item-id={row.itemId} className="tf-quotation-group-name" aria-label={`Tên nhóm ${numberLabel}`} placeholder="Tên nhóm…" value={row.name} disabled={disabled} onChange={event=>update(row.itemId,{name:event.target.value})} />
            <button type="button" className="tf-quotation-group-summary" aria-expanded={!collapsedRow} onClick={()=>toggle(row.itemId)}><span>{children.length} hạng mục</span>{row.showGroupSubtotal && <strong>{amount ? displayMoney(amount.net) : "—"}</strong>}</button>
            <div className="tf-quotation-menu-wrap" data-quotation-menu><button type="button" className="tf-quotation-icon-button" aria-label={`Thao tác nhóm ${row.name || numberLabel}`} aria-haspopup="menu" aria-expanded={menuId===row.itemId} onClick={()=>{setInsertMenuId(null);setMenuId(menuId===row.itemId ? null : row.itemId);}}><MoreHorizontal size={17} aria-hidden="true" /></button>{menuId===row.itemId && <RowMenu settingsLabel="Chỉnh sửa nhóm" onSettings={()=>{onOpen(row.itemId);setMenuId(null);}} onAdd={()=>{onAdd("ITEM",row.itemId);setMenuId(null);}} addLabel="Thêm hạng mục" />}</div>
          </div></th>
        </tr>;
        const groupAncestor = role === "DETAIL" && parent?.parentItemId ? view.rowById.get(parent.parentItemId) : parent;
        const rootAfterId = groupAncestor?.rowType === "GROUP" ? groupAncestor.itemId : role === "DETAIL" ? parent?.itemId ?? row.itemId : row.itemId;
        const itemParentId = role === "DETAIL" ? parent?.parentItemId ?? null : row.parentItemId;
        const itemAfterId = role === "DETAIL" ? parent?.itemId ?? row.itemId : row.itemId;
        const insertActions = role === "DETAIL" ? [
          {label:"Thêm nhóm bên dưới",onSelect:()=>{onAdd("GROUP",null,rootAfterId);setInsertMenuId(null);}},
          {label:"Thêm hạng mục sau hạng mục này",onSelect:()=>{onAdd("ITEM",itemParentId,itemAfterId);setInsertMenuId(null);}},
          {label:"Thêm chi tiết cùng cấp",onSelect:()=>{onAdd("ITEM",row.parentItemId,row.itemId);setInsertMenuId(null);}},
        ] : [
          {label:"Thêm nhóm bên dưới",onSelect:()=>{onAdd("GROUP",null,rootAfterId);setInsertMenuId(null);}},
          {label:"Thêm hạng mục cùng cấp",onSelect:()=>{onAdd("ITEM",row.parentItemId,row.itemId);setInsertMenuId(null);}},
          {label:"Thêm chi tiết con",onSelect:()=>{onAdd("ITEM",row.itemId);setInsertMenuId(null);}},
        ];
        return <tr key={row.itemId} className={`${role === "DETAIL" ? "tf-quotation-detail-row" : "tf-quotation-item-row"}${insertMenuId===row.itemId || menuId===row.itemId ? " is-menu-open" : ""}`} data-sale-removed={row.saleRemoved || undefined} data-drop-position={dropPosition} onDragOver={event=>dragOver(event,row.itemId)} onDrop={event=>performDrop(event,row,drop?.position ?? "inside")}>
          <th scope="row" className="tf-quotation-structure-cell"><div className="tf-quotation-structure-row"><div className="tf-quotation-insert-wrap" data-quotation-menu><button type="button" className="tf-quotation-icon-button tf-quotation-insert-button" aria-label={`Thêm dòng tại ${row.name || (role === "DETAIL" ? "chi tiết" : "hạng mục")}`} title="Thêm dòng" aria-haspopup="menu" aria-expanded={insertMenuId===row.itemId} disabled={disabled} onClick={()=>{setMenuId(null);setInsertMenuId(insertMenuId===row.itemId ? null : row.itemId);}}><Plus size={15} aria-hidden="true" /></button>{insertMenuId===row.itemId && <InsertMenu actions={insertActions} />}</div><button type="button" className="tf-quotation-drag-handle" draggable={!disabled} onDragStart={event=>dragStart(event,row.itemId)} onDragEnd={()=>{setDragId(null);setDrop(null);}} aria-label={`Kéo để sắp xếp ${row.name || `dòng ${visibleIndex+1}`}`} title="Kéo để sắp xếp"><GripVertical size={14} aria-hidden="true" /></button>{children.length > 0 ? <button type="button" className="tf-quotation-row-toggle" aria-label={(collapsedRow ? "Mở rộng " : "Thu gọn ")+(row.name||"hạng mục")} aria-expanded={!collapsedRow} onClick={()=>toggle(row.itemId)}>{collapsedRow ? <ChevronRight size={14}/> : <ChevronDown size={14}/>}</button> : <span className="tf-quotation-row-toggle-spacer" aria-hidden="true" />}<span className="tf-quotation-outline-number">{numberLabel}</span><div className="tf-quotation-structure-copy"><InlineCellEditor label={`Tên ${role === "DETAIL" ? "chi tiết con" : "hạng mục"} ${numberLabel || visibleIndex+1}`} value={row.name} placeholder={role === "DETAIL" ? "Tên chi tiết con…" : "Tên hạng mục…"} disabled={disabled} rowId={row.itemId} field="name" nextRowId={nextRowId} dataItemId={row.itemId} onCommit={value=>update(row.itemId,{name:value})} /></div></div></th>
          <td className="tf-paired-description-cell"><InlineDescription value={row.description} label={`Mô tả ${row.name || "hạng mục"}`} disabled={disabled} rowId={row.itemId} nextRowId={nextRowId} onCommit={value=>update(row.itemId,{description:value})} /></td>
          {(descriptiveChild && !quantityOnly) || detailPricedParent ? <><td className="tf-quotation-unit-cell tf-quotation-muted-cell">—</td><td className="tf-quotation-quantity-cell tf-quotation-muted-cell">—</td></> : <><td className="tf-quotation-unit-cell"><InlineCellEditor label={`ĐVT ${row.name || "hạng mục"}`} value={row.sell.unit} placeholder="—" disabled={disabled || priceDisabled} rowId={row.itemId} field="unit" nextRowId={nextRowId} listId="quotation-units" onCommit={value=>side(row,"unit",value)} /></td><td className="tf-quotation-quantity-cell"><InlineCellEditor label={`Số lượng ${row.name || "hạng mục"}`} value={row.sell.quantity} placeholder="—" inputMode="decimal" align="right" disabled={disabled || priceDisabled} rowId={row.itemId} field="quantity" nextRowId={nextRowId} onCommit={value=>side(row,"quantity",value)} /></td></>}
          <td className="tf-quotation-price-cell">{descriptiveChild || detailPricedParent ? <span className="tf-quotation-price-source">{detailPricedParent ? "Theo chi tiết" : "—"}</span> : <InlinePrice label={`Đơn giá ${row.name || "hạng mục"}`} value={row.sell.unitPrice} disabled={disabled || priceDisabled} rowId={row.itemId} nextRowId={nextRowId} onChange={value=>side(row,"unitPrice",value)} />}</td>
          <td className="tf-paired-amount tf-quotation-amount-cell">{descriptiveChild ? "—" : amount ? displayMoney(amount.net) : <span className="tf-quotation-empty-value">—</span>}</td>
          <td className="tf-quotation-actions-cell"><div className="tf-quotation-menu-wrap" data-quotation-menu><button type="button" className="tf-quotation-icon-button" aria-label={`Thao tác ${row.name || "hạng mục"}`} aria-haspopup="menu" aria-expanded={menuId===row.itemId} onClick={()=>{setInsertMenuId(null);setMenuId(menuId===row.itemId ? null : row.itemId);}}><MoreHorizontal size={16} aria-hidden="true" /></button>{menuId===row.itemId && <RowMenu settingsLabel="Chỉnh sửa chi tiết" onSettings={()=>{onOpen(row.itemId);setMenuId(null);}} />}</div></td>
        </tr>;
      })}</tbody>
      <tfoot>{totals.map(total => <tr key={total.id} className={total.id === "SYSTEM_GROSS" ? "tf-paired-grand-total" : ""}>
        <th scope="row" colSpan={5}>{total.label}</th>
        <td className="tf-paired-amount tf-paired-sell-total">{total.incomplete || total.amount === undefined ? "Chưa đủ dữ liệu" : displayMoney(total.amount)}</td>
        <td aria-hidden="true" />
      </tr>)}</tfoot>
    </Table>
    {dragId && <div className="tf-quotation-root-drop" onDragOver={event=>event.preventDefault()} onDrop={dropAtRoot}>Thả vào đây để đưa hạng mục ra cấp gốc</div>}
  </div>;
}

function RowMenu({ settingsLabel, onSettings, onAdd, addLabel }: { settingsLabel: string; onSettings: () => void; onAdd?: () => void; addLabel?: string }) {
  return <div className="tf-quotation-row-menu" role="menu"><button type="button" role="menuitem" onClick={onSettings}>{settingsLabel}</button>{onAdd && addLabel && <button type="button" role="menuitem" onClick={onAdd}>{addLabel}</button>}</div>;
}

function InsertMenu({ actions }: { actions: { label: string; onSelect: () => void }[] }) {
  return <div className="tf-quotation-row-menu tf-quotation-insert-menu" role="menu" aria-label="Thêm dòng">{actions.map(action=><button key={action.label} type="button" role="menuitem" onClick={action.onSelect}><Plus size={14} aria-hidden="true" />{action.label}</button>)}</div>;
}

function focusNextCell(field: string, nextRowId?: string) {
  if (!nextRowId) return;
  requestAnimationFrame(() => {
    const candidates = [...document.querySelectorAll<HTMLButtonElement>(`button[data-grid-field="${field}"][data-row-id="${nextRowId}"]`)];
    const target = candidates.find(button => button.offsetParent !== null);
    target?.click();
  });
}

function InlineCellEditor({ label, value, placeholder, disabled, rowId, field, nextRowId, dataItemId, inputMode, align = "left", listId, onCommit }: {
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  rowId: string;
  field: string;
  nextRowId?: string;
  dataItemId?: string;
  inputMode?: "decimal" | "text";
  align?: "left" | "right";
  listId?: string;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const commit = () => { onCommit(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };
  if (editing && !disabled) return <input ref={input} className={`tf-field tf-quotation-inline-editor${align === "right" ? " text-right tabular-nums" : ""}`} aria-label={label} inputMode={inputMode} list={listId} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if (event.key === "Enter") { event.preventDefault(); commit(); focusNextCell(field,nextRowId); }
  }} />;
  return <button type="button" data-item-id={dataItemId} data-row-id={rowId} data-grid-field={field} className={`tf-quotation-inline-value${value ? "" : " is-empty"}${align === "right" ? " text-right tabular-nums" : ""}`} aria-label={`${label} · Bấm để sửa`} disabled={disabled} onClick={()=>{setDraft(value);setEditing(true);}}><span>{value || placeholder}</span></button>;
}

function InlineDescription({ value, label, disabled, rowId, nextRowId, onCommit }: { value: string; label: string; disabled: boolean; rowId: string; nextRowId?: string; onCommit: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { textarea.current?.focus(); textarea.current?.setSelectionRange(draft.length,draft.length); } }, [draft.length, editing]);
  const commit = () => { onCommit(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };
  if (editing && !disabled) return <textarea ref={textarea} rows={1} className="tf-field tf-quotation-inline-description" aria-label={label} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commit(); focusNextCell("description",nextRowId); }
  }} />;
  return <button type="button" data-row-id={rowId} data-grid-field="description" className={`tf-paired-description-trigger${value ? "" : " is-empty"}`} aria-label={`${label} · Bấm để sửa`} title={value || "Chưa có mô tả"} disabled={disabled} onClick={()=>{setDraft(value);setEditing(true);}}><span>{value || "Thêm mô tả"}</span></button>;
}

function InlinePrice({ label, value, disabled, rowId, nextRowId, onChange }: { label: string; value: string; disabled: boolean; rowId: string; nextRowId?: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const display = formatPriceInput(editing ? draft : value);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    let index = 0, digits = 0;
    while (index < display.length && digits < caret.current) { if (display[index] !== ",") digits++; index++; }
    input.current.setSelectionRange(index,index);
    caret.current = null;
  }, [display]);
  const commit = () => { onChange(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };
  if (editing && !disabled) return <Input ref={input} label={label} inputMode="decimal" placeholder="Chưa nhập" className="tf-paired-price-input text-right tabular-nums tf-quotation-inline-editor" value={display} onBlur={commit} onKeyDown={event=>{
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if (event.key === "Enter") { event.preventDefault(); commit(); focusNextCell("price",nextRowId); }
  }} onChange={event=>{caret.current=ungroupPriceInput(event.target.value.slice(0,event.target.selectionStart??event.target.value.length)).length;setDraft(ungroupPriceInput(event.target.value));}} />;
  return <button type="button" data-row-id={rowId} data-grid-field="price" className={`tf-quotation-inline-value text-right tabular-nums${value ? "" : " is-empty"}`} aria-label={`${label} · Bấm để sửa`} disabled={disabled} onClick={()=>{setDraft(value);setEditing(true);}}><span>{value ? formatPriceInput(value) : "—"}</span></button>;
}
