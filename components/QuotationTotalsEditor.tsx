"use client";

import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, GripVertical, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { calculateQuotationTotals, normalizeQuotationTotalLayout, normalizeQuotationTotals, type QuotationTotalLayoutRow, type QuotationTotalLine, type TotalReference } from "@/lib/costflow/quotationTotals";
import { displayMoney, type CalculatedCost } from "@/lib/costflow/money";
import { Button, IconButton } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Input, Select } from "./ui/Field";

const BLANK_LINE = (): QuotationTotalLine => ({
  id: crypto.randomUUID(),
  label: "",
  kind: "PERCENT",
  value: "",
  vatPercent: "",
  references: [{ source: "ITEMS", basis: "NET" }],
});

const BASIS_LABELS = { NET: "Trước VAT", VAT: "Tiền VAT", GROSS: "Sau VAT" } as const;
const SYSTEM_SETUP = {
  SYSTEM_NET: {
    short: "Tổng giá trị trước VAT của hạng mục và các khoản phí bổ sung.",
    source: "Hạng mục và dòng bổ sung · giá trị trước VAT",
    formula: "Cộng toàn bộ giá trị trước VAT",
  },
  SYSTEM_VAT: {
    short: "Tổng tiền VAT của hạng mục và các khoản phí bổ sung.",
    source: "Hạng mục và dòng bổ sung · tiền VAT",
    formula: "Cộng toàn bộ tiền VAT",
  },
  SYSTEM_GROSS: {
    short: "Tổng thanh toán sau VAT của toàn bộ báo giá.",
    source: "Tổng trước VAT và tổng VAT",
    formula: "Tổng trước VAT + Tổng VAT",
  },
} as const;
type SystemTotalId = keyof typeof SYSTEM_SETUP;

function lineDescription(line: QuotationTotalLine, lines: QuotationTotalLine[]) {
  if (line.kind === "FIXED") return `Số tiền cố định trước VAT · VAT ${line.vatPercent || "—"}%`;
  const sources = line.references.map(reference => {
    const source = reference.source === "ITEMS" ? "Tổng hạng mục" : lines.find(row => row.id === reference.source)?.label || "Dòng chưa đặt tên";
    return `${source} · ${BASIS_LABELS[reference.basis]}`;
  }).join(" + ") || "Chưa chọn căn cứ";
  return line.kind === "SUBTOTAL" ? `Tổng trung gian · ${sources}` : `${line.value || "—"}% × ${sources} · VAT ${line.vatPercent || "—"}%`;
}

export default function QuotationTotalsEditor({ title = "Phí và phần tính tổng", lines, layout, onChange, onLayoutChange, items, readOnly = false, expanded, onExpandedChange }: {
  title?: string;
  lines: QuotationTotalLine[]; layout: QuotationTotalLayoutRow[]; onChange: (lines: QuotationTotalLine[]) => void; onLayoutChange: (layout: QuotationTotalLayoutRow[]) => void; items: CalculatedCost & { incomplete?: boolean }; readOnly?: boolean; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<QuotationTotalLine | null>(null);
  const [systemDetailId, setSystemDetailId] = useState<SystemTotalId | null>(null);
  const [labelEdit, setLabelEdit] = useState<{ id: string; value: string } | null>(null);
  const [draggedId, setDraggedId] = useState("");
  const calculated = calculateQuotationTotals(items, lines);
  const controlled = expanded !== undefined;
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = controlled ? expanded : internalExpanded;
  const setExpanded = (next: boolean) => controlled ? onExpandedChange?.(next) : setInternalExpanded(next);

  const apply = (next: QuotationTotalLine[]) => {
    try {
      normalizeQuotationTotals(next);
      onChange(next);
      onLayoutChange(normalizeQuotationTotalLayout(next, layout));
      setError("");
      return true;
    } catch (nextError) {
      setError((nextError as Error).message);
      return false;
    }
  };
  const moveLayout = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= layout.length) return;
    const next = [...layout];
    [next[index], next[target]] = [next[target], next[index]];
    onLayoutChange(next);
  };
  const moveLayoutTo = (id: string, targetId: string) => {
    if (!id || id === targetId) return;
    const from = layout.findIndex(row => row.id === id);
    const to = layout.findIndex(row => row.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...layout];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onLayoutChange(next);
  };
  const updateLayout = (id: string, label: string) => {
    const nextLayout = layout.map(row => row.id === id ? { ...row, label } : row);
    if (id.startsWith("SYSTEM_")) onLayoutChange(nextLayout);
    else {
      const nextLines = lines.map(line => line.id === id ? { ...line, label } : line);
      try {
        normalizeQuotationTotals(nextLines);
        onChange(nextLines);
        onLayoutChange(normalizeQuotationTotalLayout(nextLines, nextLayout));
        setError("");
      } catch (nextError) {
        setError((nextError as Error).message);
      }
    }
  };
  const saveDraft = () => {
    if (!draft) return;
    const next = lines.some(line => line.id === draft.id) ? lines.map(line => line.id === draft.id ? draft : line) : [...lines, draft];
    if (apply(next)) setDraft(null);
  };
  const addReference = () => {
    if (!draft) return;
    const candidates: TotalReference[] = (["NET", "VAT", "GROSS"] as const).map(basis => ({ source: "ITEMS", basis })).concat(
      lines.filter(line => line.id !== draft.id).flatMap(line => (["NET", "VAT", "GROSS"] as const).map(basis => ({ source: line.id, basis }))),
    );
    const reference = candidates.find(candidate => !draft.references.some(value => value.source === candidate.source && value.basis === candidate.basis));
    if (reference) setDraft({ ...draft, references: [...draft.references, reference] });
  };
  const draftPreview = (() => {
    if (!draft) return null;
    try {
      const previewLines = lines.some(line => line.id === draft.id) ? lines.map(line => line.id === draft.id ? draft : line) : [...lines, draft];
      return calculateQuotationTotals(items, previewLines).lines.find(line => line.id === draft.id)?.amount ?? null;
    } catch { return null; }
  })();

  const selectedSystem = systemDetailId ? SYSTEM_SETUP[systemDetailId] : null;
  const selectedSystemRow = systemDetailId ? layout.find(row => row.id === systemDetailId) : null;
  const selectedSystemAmount = systemDetailId === "SYSTEM_NET" ? calculated.amount.net : systemDetailId === "SYSTEM_VAT" ? calculated.amount.vat : calculated.amount.gross;

  return <section className="tf-quotation-totals-editor" aria-label="Tùy chỉnh phần tính tổng">
    <button type="button" className="tf-quotation-totals-summary"
      aria-label={isExpanded ? "Thu gọn phần phí và tính tổng" : "Mở phần phí và tính tổng"}
      aria-expanded={isExpanded} onClick={() => setExpanded(!isExpanded)}>
      <span><span role="heading" aria-level={3} className="tf-quotation-totals-title">{title}</span><span className="tf-ui-help">Đổi tên, sắp xếp và thiết lập các dòng tính tổng.</span></span>
      <span className="tf-quotation-totals-toggle" aria-hidden="true">
        {isExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </span>
    </button>
    {isExpanded && <div className="tf-quotation-totals-advanced">
      <div className="tf-total-list-actions">
        {!readOnly && <Button variant="secondary" size="sm" onClick={() => { setError(""); setDraft(BLANK_LINE()); }}><Plus size={15} aria-hidden="true" />Thêm dòng tính tiền</Button>}
      </div>
      <div className="tf-total-layout-editor">
        <ol className="tf-total-layout-list">
          {layout.map((row, index) => {
            const system = row.id.startsWith("SYSTEM_");
            const custom = calculated.lines.find(line => line.id === row.id);
            const amount = row.id === "SYSTEM_NET" ? calculated.amount.net : row.id === "SYSTEM_VAT" ? calculated.amount.vat : row.id === "SYSTEM_GROSS" ? calculated.amount.gross : custom?.amount?.gross;
            const incomplete = system ? items.incomplete || calculated.incomplete : items.incomplete || !amount;
            return <li key={row.id} className={`tf-total-layout-row${system ? " is-system" : " is-custom"}`}
              onDragOver={event => { if (!readOnly) event.preventDefault(); }}
              onDrop={() => { moveLayoutTo(draggedId, row.id); setDraggedId(""); }}>
              {!readOnly ? <button type="button" className="tf-total-drag-handle" draggable
                aria-label={`Kéo để đổi vị trí ${row.label}`} onDragStart={event => { setDraggedId(row.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDraggedId("")}>
                <GripVertical size={18} aria-hidden="true" />
              </button> : <span className="tf-total-drag-spacer" />}
              <div className="tf-total-row-copy">
                {labelEdit?.id === row.id ? <input autoFocus className="tf-field tf-total-row-label-input" aria-label={`Tên hiển thị của ${row.label}`}
                  value={labelEdit.value} onChange={event => setLabelEdit({ id: row.id, value: event.target.value })}
                  onBlur={() => { updateLayout(row.id, labelEdit.value); setLabelEdit(null); }}
                  onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setLabelEdit(null); }} />
                  : readOnly ? <strong className="tf-total-row-label">{row.label}</strong>
                    : <button type="button" className="tf-total-row-label-button" onClick={() => setLabelEdit({ id: row.id, value: row.label })}>
                      <span>{row.label}</span><Pencil size={14} aria-hidden="true" />
                    </button>}
                <p>{system ? SYSTEM_SETUP[row.id as SystemTotalId].short : lineDescription(custom!, lines)}</p>
              </div>
              <span className={`tf-total-layout-kind ${system ? "is-system" : "is-custom"}`}>{system ? "Mặc định" : "Bổ sung"}</span>
              <strong className={`tf-total-row-value${incomplete ? " is-incomplete" : ""}`}>{incomplete ? "Chưa đủ dữ liệu" : displayMoney(amount!)}</strong>
              {!readOnly && <div className="tf-total-row-actions">
                {system ? <Button size="sm" variant="ghost" onClick={() => setSystemDetailId(row.id as SystemTotalId)}><SlidersHorizontal size={14} aria-hidden="true" />Thiết lập</Button>
                  : <Button size="sm" variant="ghost" onClick={() => { setError(""); setDraft({ ...custom!, references: custom!.references.map(reference => ({ ...reference })) }); }}><Pencil size={14} aria-hidden="true" />Sửa</Button>}
                <IconButton size="sm" variant="ghost" aria-label={`Di chuyển ${row.label} lên`} disabled={index === 0} onClick={() => moveLayout(index, -1)}><ArrowUp size={16} aria-hidden="true" /></IconButton>
                <IconButton size="sm" variant="ghost" aria-label={`Di chuyển ${row.label} xuống`} disabled={index === layout.length - 1} onClick={() => moveLayout(index, 1)}><ArrowDown size={16} aria-hidden="true" /></IconButton>
                {!system && (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Xóa ${row.label}`}
                    onClick={() => {
                      if (typeof window !== "undefined" && !window.confirm(`Bạn có chắc chắn muốn xóa dòng "${row.label}"?`)) return;
                      apply(lines.filter(line => line.id !== row.id));
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </IconButton>
                )}
              </div>}
            </li>;
          })}
        </ol>
      </div>
      {error && <p role="alert" className="tf-ui-error">{error}</p>}
      <p className="tf-total-grand-preview">Tổng báo giá sau VAT <strong>{items.incomplete || calculated.incomplete ? "Chưa đủ dữ liệu" : displayMoney(calculated.amount.gross)}</strong></p>
    </div>}
    <Dialog open={!!draft} onClose={() => { setDraft(null); setError(""); }} title={draft && lines.some(line => line.id === draft.id) ? "Sửa dòng tính tiền" : "Thêm dòng tính tiền"}
      description="Dòng này sẽ xuất hiện trong cùng danh sách tổng và trên bản báo giá khách."
      footer={<><Button variant="secondary" onClick={() => { setDraft(null); setError(""); }}>Hủy</Button><Button onClick={saveDraft}>{draft && lines.some(line => line.id === draft.id) ? "Lưu thay đổi" : "Thêm dòng"}</Button></>}>
      {draft && <div className="tf-quotation-total-editor-panel space-y-5">
        <Input label="Tên hiển thị" value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Cách tính" value={draft.kind} onChange={event => {
            const kind = event.target.value as QuotationTotalLine["kind"];
            setDraft({ ...draft, kind, references: kind === "FIXED" ? [] : draft.references.length ? draft.references : [{ source: "ITEMS", basis: "NET" }] });
          }}><option value="PERCENT">Phí theo phần trăm</option><option value="FIXED">Phí số tiền cố định · net</option><option value="SUBTOTAL">Tổng trung gian</option></Select>
          {draft.kind !== "SUBTOTAL" && <Input label={draft.kind === "PERCENT" ? "Tỷ lệ (%)" : "Số tiền trước VAT (VND)"} value={draft.value} inputMode="decimal" onChange={event => setDraft({ ...draft, value: event.target.value })} />}
        </div>
        {draft.kind !== "SUBTOTAL" && <Input label="VAT của khoản phí (%)" hint="Nhập rõ 0 nếu không VAT" value={draft.vatPercent} inputMode="decimal" onChange={event => setDraft({ ...draft, vatPercent: event.target.value })} />}
        {draft.kind !== "FIXED" && <fieldset className="tf-total-reference-editor">
          <legend>Căn cứ tính</legend><p className="tf-ui-help">Có thể cộng nhiều khoản; mỗi khoản phải chọn rõ giá trị trước VAT, VAT hoặc sau VAT.</p>
          <div className="space-y-3">{draft.references.map((reference, index) => <div key={`${reference.source}:${reference.basis}:${index}`} className="tf-total-reference-row">
            <Select label={`Khoản ${index + 1}`} value={reference.source} onChange={event => setDraft({ ...draft, references: draft.references.map((value, position) => position === index ? { ...value, source: event.target.value } : value) })}>
              <option value="ITEMS">Tổng hạng mục</option>{lines.filter(line => line.id !== draft.id).map(line => <option key={line.id} value={line.id}>{line.label || "Dòng chưa đặt tên"}</option>)}
            </Select>
            <Select label="Giá trị sử dụng" value={reference.basis} onChange={event => setDraft({ ...draft, references: draft.references.map((value, position) => position === index ? { ...value, basis: event.target.value as TotalReference["basis"] } : value) })}>
              <option value="NET">Trước VAT</option><option value="VAT">Tiền VAT</option><option value="GROSS">Sau VAT</option>
            </Select>
            <IconButton variant="ghost" aria-label={`Bỏ căn cứ ${index + 1}`} onClick={() => setDraft({ ...draft, references: draft.references.filter((_, position) => position !== index) })}><Trash2 size={16} aria-hidden="true" /></IconButton>
          </div>)}</div>
          <Button variant="ghost" size="sm" onClick={addReference}><Plus size={14} aria-hidden="true" />Thêm căn cứ</Button>
        </fieldset>}
        {error && <p role="alert" className="tf-ui-error">{error}</p>}
        <div className="tf-total-editor-preview" aria-live="polite"><span>Xem trước sau VAT</span><strong>{draftPreview ? displayMoney(draftPreview.gross) : "Chưa đủ dữ liệu"}</strong></div>
      </div>}
    </Dialog>
    <Dialog open={!!systemDetailId} onClose={() => setSystemDetailId(null)}
      title={selectedSystemRow?.label || "Thiết lập mặc định"}
      description="Dòng mặc định giữ vai trò chuẩn của báo giá; bạn vẫn có thể đổi tên và sắp xếp dòng ở danh sách.">
      {selectedSystem && <div className="tf-total-system-setup">
        <span className="tf-total-layout-kind">Mặc định</span>
        <dl>
          <div><dt>Nguồn dữ liệu</dt><dd>{selectedSystem.source}</dd></div>
          <div><dt>Cách tính</dt><dd>{selectedSystem.formula}</dd></div>
          <div><dt>Giá trị hiện tại</dt><dd>{items.incomplete || calculated.incomplete ? "Chưa đủ dữ liệu" : displayMoney(selectedSystemAmount)}</dd></div>
        </dl>
      </div>}
    </Dialog>
  </section>;
}
