"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { saveFinanceSheet } from "@/app/actions/finance";
import { useInteraction } from "@/components/InteractionProvider";
import {
  costAmount,
  costVat,
  formatMargin,
  formatVndNumber,
  sellAmount,
  sheetTotals,
} from "@/lib/financeCalc";
import { FINANCE_HEADER_FIELDS } from "@/lib/financeHeader";
import { VAT_RATE_OPTIONS } from "@/lib/financeSheetInput";
import type {
  CostLineView,
  FinancePermissions,
  FinanceSheetView,
  SellLineView,
} from "@/lib/financeSheet";
import { formatViNumber, parseViNumber } from "@/lib/viNumber";

export type SupplierOption = { id: string; name: string; shortName: string | null };

// Dòng chưa lưu có khoá tạm "new-…"; khi gửi lên máy chủ thì bỏ id để máy chủ tạo mới.
type EditCost = CostLineView & { key: string };
type EditLine = Omit<SellLineView, "costs"> & { key: string; costs: EditCost[] };
type EditSection = { key: string; id: string; name: string; lines: EditLine[] };

let tempCounter = 0;
const tempKey = () => `new-${Date.now().toString(36)}-${(tempCounter += 1)}`;
const isNew = (key: string) => key.startsWith("new-");

function toEditSections(sheet: FinanceSheetView): EditSection[] {
  return sheet.sections.map((section) => ({
    key: section.id,
    id: section.id,
    name: section.name,
    lines: section.lines.map((line) => ({
      ...line,
      key: line.id,
      costs: line.costs.map((cost) => ({ ...cost, key: cost.id })),
    })),
  }));
}

function emptyCost(): EditCost {
  const key = tempKey();
  return {
    key,
    id: key,
    description: null,
    unit: null,
    icQuantity: null,
    icUnitPrice: null,
    icVatRate: 0.08,
    icSupplierId: null,
    icNote: null,
  };
}

function emptyLine(): EditLine {
  const key = tempKey();
  return {
    key,
    id: key,
    stt: null,
    name: "",
    description: null,
    unit: null,
    quantity: null,
    unitPrice: null,
    note: null,
    costs: [emptyCost()],
  };
}

function move<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const blankToNull = (value: string) => (value.trim() ? value : null);

/** Ô nhập số kiểu Việt Nam; gõ tự do, rời ô thì định dạng lại. */
function NumberField({
  value,
  onChange,
  decimals = 2,
  label,
  disabled,
  className = "",
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  decimals?: number;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(formatViNumber(value, decimals));
  const [invalid, setInvalid] = useState(false);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parseViNumber(event.target.value);
        if (parsed !== null && Number.isNaN(parsed)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onChange(parsed);
      }}
      onBlur={() => {
        if (!invalid) setText(formatViNumber(value, decimals));
      }}
      className={`h-9 w-full min-w-0 rounded-[6px] border bg-white px-2 text-right text-sm tabular-nums outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-zinc-50 disabled:text-zinc-600 ${
        invalid ? "border-red-400" : "border-zinc-300"
      } ${className}`}
    />
  );
}

function TextField({
  value,
  onChange,
  label,
  placeholder,
  disabled,
  className = "",
}: {
  value: string | null;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type="text"
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className={`h-9 w-full min-w-0 rounded-[6px] border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-zinc-50 disabled:text-zinc-700 ${className}`}
    />
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30 ${
        danger ? "hover:!bg-red-50 hover:!text-red-600" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "good" ? "text-emerald-700" : "text-zinc-950"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

const SELL_COLS =
  "grid grid-cols-[52px_minmax(200px,1.4fr)_minmax(180px,1fr)_72px_84px_128px_128px_minmax(120px,0.8fr)_104px] items-center gap-2";
const SELL_COLS_NO_PRICE =
  "grid grid-cols-[52px_minmax(200px,1.4fr)_minmax(180px,1fr)_72px_84px_minmax(120px,0.8fr)_104px] items-center gap-2";
const COST_COLS =
  "grid grid-cols-[28px_minmax(180px,1.2fr)_170px_72px_84px_128px_104px_120px_120px_minmax(120px,0.8fr)_40px] items-center gap-2";

export default function FinanceSheetEditor({
  projectId,
  sheet,
  permissions,
  suppliers,
}: {
  projectId: string;
  sheet: FinanceSheetView;
  permissions: FinancePermissions;
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const readOnly = !permissions.canEdit || permissions.locked;
  const showSell = permissions.canSeeSell;

  const [header, setHeader] = useState(sheet.header);
  const [sellVatRate, setSellVatRate] = useState(sheet.sellVatRate);
  const [sections, setSections] = useState<EditSection[]>(() => toEditSections(sheet));
  const [dirty, setDirty] = useState(false);

  // Nhắc khi rời trang mà chưa lưu.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const totals = useMemo(
    () => sheetTotals(sections.map((section) => ({ lines: section.lines })), sellVatRate),
    [sections, sellVatRate],
  );

  const supplierLabel = useMemo(() => {
    const map = new Map(
      suppliers.map((supplier) => [
        supplier.id,
        supplier.shortName ? `${supplier.shortName}` : supplier.name,
      ]),
    );
    return (id: string | null) => (id ? map.get(id) ?? "(đã xoá)" : "");
  }, [suppliers]);

  function edit(updater: (sections: EditSection[]) => EditSection[]) {
    setSections((current) => updater(current));
    setDirty(true);
  }

  function editSection(sectionKey: string, patch: (section: EditSection) => EditSection) {
    edit((current) =>
      current.map((section) => (section.key === sectionKey ? patch(section) : section)),
    );
  }

  function editLine(sectionKey: string, lineKey: string, patch: Partial<EditLine>) {
    editSection(sectionKey, (section) => ({
      ...section,
      lines: section.lines.map((line) => (line.key === lineKey ? { ...line, ...patch } : line)),
    }));
  }

  function editCost(
    sectionKey: string,
    lineKey: string,
    costKey: string,
    patch: Partial<EditCost>,
  ) {
    editSection(sectionKey, (section) => ({
      ...section,
      lines: section.lines.map((line) =>
        line.key === lineKey
          ? {
              ...line,
              costs: line.costs.map((cost) => (cost.key === costKey ? { ...cost, ...patch } : cost)),
            }
          : line,
      ),
    }));
  }

  function resetChanges() {
    if (!confirm("Bỏ mọi thay đổi chưa lưu?")) return;
    setHeader(sheet.header);
    setSellVatRate(sheet.sellVatRate);
    setSections(toEditSections(sheet));
    setDirty(false);
  }

  function save() {
    const payload = {
      header,
      sellVatRate,
      sections: sections.map((section) => ({
        id: isNew(section.key) ? undefined : section.id,
        name: section.name,
        lines: section.lines.map((line) => ({
          id: isNew(line.key) ? undefined : line.id,
          stt: line.stt,
          name: line.name,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          note: line.note,
          costs: line.costs.map((cost) => ({
            id: isNew(cost.key) ? undefined : cost.id,
            description: cost.description,
            unit: cost.unit,
            icQuantity: cost.icQuantity,
            icUnitPrice: cost.icUnitPrice,
            icVatRate: cost.icVatRate,
            icSupplierId: cost.icSupplierId,
            icNote: cost.icNote,
          })),
        })),
      })),
    };
    startTransition(async () => {
      const result = await saveFinanceSheet(projectId, sheet.id, sheet.updatedAt, payload);
      if (result.error) {
        notify({ message: result.error, tone: "error" });
        return;
      }
      setDirty(false);
      notify({ message: result.success ?? "Đã lưu IC.", tone: "success" });
      // Tải lại để dòng mới nhận id thật từ máy chủ.
      router.refresh();
    });
  }

  const sellCols = showSell ? SELL_COLS : SELL_COLS_NO_PRICE;
  const disabled = readOnly || pending;

  return (
    <div className="space-y-4 pb-24">
      {permissions.locked && (
        <p className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          IC đang chờ duyệt hoặc đã duyệt nên chỉ xem được, không sửa được.
        </p>
      )}
      {!showSell && (
        <p className="rounded-[8px] border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
          Bạn đang xem phần giá vốn của IC. Giá bán, lợi nhuận và margin chỉ Admin, Account và Kế toán xem được.
        </p>
      )}

      <section aria-labelledby="finance-header-title" className="tf-panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="finance-header-title" className="text-base font-semibold">
            Thông tin chung
          </h2>
          <span className="text-xs text-zinc-500">Mục để trống sẽ không in ra file Excel/PDF.</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FINANCE_HEADER_FIELDS.filter((field) => field.key !== "eventTime").map((field) => (
            <label key={field.key} className="block">
              <span className="tf-label">{field.label}</span>
              <input
                type="text"
                value={header[field.key as "clientName" | "programName" | "headcount" | "location"]}
                disabled={disabled}
                placeholder={field.key === "headcount" ? "VD: 240 khách" : undefined}
                onChange={(event) => {
                  setHeader((current) => ({ ...current, [field.key]: event.target.value }));
                  setDirty(true);
                }}
                className="tf-field disabled:bg-zinc-50"
              />
            </label>
          ))}
          <label className="block">
            <span className="tf-label">Thời gian: từ ngày</span>
            <input
              type="date"
              value={header.eventStart}
              disabled={disabled}
              onChange={(event) => {
                setHeader((current) => ({ ...current, eventStart: event.target.value }));
                setDirty(true);
              }}
              className="tf-field disabled:bg-zinc-50"
            />
          </label>
          <label className="block">
            <span className="tf-label">Đến ngày (nếu nhiều ngày)</span>
            <input
              type="date"
              value={header.eventEnd}
              disabled={disabled}
              onChange={(event) => {
                setHeader((current) => ({ ...current, eventEnd: event.target.value }));
                setDirty(true);
              }}
              className="tf-field disabled:bg-zinc-50"
            />
          </label>
          {showSell && (
            <label className="block">
              <span className="tf-label">VAT bán ra</span>
              <select
                value={String(sellVatRate)}
                disabled={disabled}
                onChange={(event) => {
                  setSellVatRate(Number(event.target.value));
                  setDirty(true);
                }}
                className="tf-field disabled:bg-zinc-50"
              >
                {VAT_RATE_OPTIONS.filter((option) => option.value !== null).map((option) => (
                  <option key={option.label} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <section
        aria-label="Tổng số liệu"
        className={`grid gap-px overflow-hidden rounded-[8px] border border-zinc-200 bg-zinc-200 ${
          showSell ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-1 sm:grid-cols-3"
        }`}
      >
        {showSell && <Stat label="Giá bán trước VAT" value={formatVndNumber(totals.sellSubtotal)} />}
        {showSell && <Stat label={`Gồm VAT ${formatViNumber(sellVatRate * 100, 1)}%`} value={formatVndNumber(totals.sellGross)} />}
        <Stat label="Giá vốn trước VAT" value={formatVndNumber(totals.costSubtotal)} />
        {!showSell && <Stat label="VAT đầu vào" value={formatVndNumber(totals.costVat)} />}
        {!showSell && <Stat label="Giá vốn gồm VAT" value={formatVndNumber(totals.costGross)} />}
        {showSell && <Stat label="Lợi nhuận" value={formatVndNumber(totals.profit)} tone="good" />}
        {showSell && <Stat label="Margin" value={formatMargin(totals.margin)} />}
      </section>

      {sections.map((section, sectionIndex) => {
        const sectionTotal = totals.sections[sectionIndex];
        return (
          <section
            key={section.key}
            aria-label={`Nhóm ${section.name || sectionIndex + 1}`}
            className="tf-panel overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 bg-zinc-50/70 px-4 py-3">
              <div className="min-w-0 flex-[1_1_260px]">
                <TextField
                  label="Tên nhóm"
                  value={section.name}
                  disabled={disabled}
                  placeholder="VD: I. SẢN XUẤT"
                  onChange={(value) => editSection(section.key, (current) => ({ ...current, name: value }))}
                  className="font-semibold"
                />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-zinc-600">
                {showSell && <span>Bán: <b className="text-zinc-900">{formatVndNumber(sectionTotal.sell)}</b></span>}
                <span>Vốn: <b className="text-zinc-900">{formatVndNumber(sectionTotal.cost)}</b></span>
              </div>
              {!readOnly && (
                <div className="flex gap-1">
                  <IconButton label="Đưa nhóm lên" disabled={pending || sectionIndex === 0} onClick={() => edit((current) => move(current, sectionIndex, -1))}>
                    <ArrowUp size={15} aria-hidden="true" />
                  </IconButton>
                  <IconButton label="Đưa nhóm xuống" disabled={pending || sectionIndex === sections.length - 1} onClick={() => edit((current) => move(current, sectionIndex, 1))}>
                    <ArrowDown size={15} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label="Xoá nhóm"
                    danger
                    disabled={pending}
                    onClick={() => {
                      if (section.lines.length && !confirm(`Xoá nhóm "${section.name}" và ${section.lines.length} hạng mục trong đó?`)) return;
                      edit((current) => current.filter((item) => item.key !== section.key));
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </IconButton>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[1180px]">
                <div className={`${sellCols} border-b border-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-500`}>
                  <span>STT</span>
                  <span>Hạng mục</span>
                  <span>Mô tả</span>
                  <span>ĐVT</span>
                  <span className="text-right">SL</span>
                  {showSell && <span className="text-right">Đơn giá bán</span>}
                  {showSell && <span className="text-right">Thành tiền</span>}
                  <span>{showSell ? "Ghi chú" : ""}</span>
                  <span />
                </div>

                {section.lines.length === 0 && (
                  <p className="px-4 py-4 text-sm text-zinc-500">Nhóm này chưa có hạng mục.</p>
                )}

                {section.lines.map((line, lineIndex) => (
                  <div key={line.key} className="border-b border-zinc-100 last:border-b-0">
                    <div className={`${sellCols} px-4 py-2`}>
                      <TextField label="STT" value={line.stt} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { stt: blankToNull(value) })} />
                      <TextField label="Tên hạng mục" value={line.name} disabled={disabled} placeholder="Tên hạng mục" onChange={(value) => editLine(section.key, line.key, { name: value })} className="font-medium" />
                      <TextField label="Mô tả hạng mục" value={line.description} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { description: blankToNull(value) })} />
                      <TextField label="Đơn vị tính" value={line.unit} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { unit: blankToNull(value) })} />
                      <NumberField label="Số lượng bán" decimals={3} value={line.quantity} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { quantity: value })} />
                      {showSell && (
                        <NumberField label="Đơn giá bán" value={line.unitPrice} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { unitPrice: value })} />
                      )}
                      {showSell && (
                        <span className="pr-1 text-right text-sm font-semibold tabular-nums">
                          {line.unitPrice === null ? <span className="font-normal text-zinc-400" title="Không tính tiền riêng cho khách">–</span> : formatVndNumber(sellAmount(line))}
                        </span>
                      )}
                      {showSell ? (
                        <TextField label="Ghi chú hạng mục" value={line.note} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { note: blankToNull(value) })} />
                      ) : (
                        <span />
                      )}
                      <div className="flex justify-end">
                        {!readOnly && (
                          <>
                            <IconButton label="Đưa hạng mục lên" disabled={pending || lineIndex === 0} onClick={() => editSection(section.key, (current) => ({ ...current, lines: move(current.lines, lineIndex, -1) }))}>
                              <ArrowUp size={14} aria-hidden="true" />
                            </IconButton>
                            <IconButton label="Đưa hạng mục xuống" disabled={pending || lineIndex === section.lines.length - 1} onClick={() => editSection(section.key, (current) => ({ ...current, lines: move(current.lines, lineIndex, 1) }))}>
                              <ArrowDown size={14} aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              label="Xoá hạng mục"
                              danger
                              disabled={pending}
                              onClick={() => {
                                if (!confirm(`Xoá hạng mục "${line.name || "chưa đặt tên"}" và các dòng chi phí của nó?`)) return;
                                editSection(section.key, (current) => ({ ...current, lines: current.lines.filter((item) => item.key !== line.key) }));
                              }}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="bg-zinc-50/60 px-4 pb-2">
                      {line.costs.length > 0 && (
                        <div className={`${COST_COLS} py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500`}>
                          <span />
                          <span>Chi phí (IC)</span>
                          <span>Nhà cung cấp</span>
                          <span>ĐVT</span>
                          <span className="text-right">SL</span>
                          <span className="text-right">Đơn giá vốn</span>
                          <span>VAT vào</span>
                          <span className="text-right">Thành tiền</span>
                          <span className="text-right">Gồm VAT</span>
                          <span>Ghi chú</span>
                          <span />
                        </div>
                      )}
                      {line.costs.map((cost) => {
                        const amount = costAmount(cost);
                        return (
                          <div key={cost.key} className={`${COST_COLS} py-1`}>
                            <span aria-hidden="true" className="text-center text-zinc-400">↳</span>
                            <TextField label="Nội dung chi phí" value={cost.description} disabled={disabled} placeholder="VD: Sản xuất tượng" onChange={(value) => editCost(section.key, line.key, cost.key, { description: blankToNull(value) })} />
                            {readOnly ? (
                              <span className="truncate text-sm font-medium text-brand-800">{supplierLabel(cost.icSupplierId) || "—"}</span>
                            ) : (
                              <select
                                aria-label="Nhà cung cấp"
                                value={cost.icSupplierId ?? ""}
                                disabled={pending}
                                onChange={(event) => editCost(section.key, line.key, cost.key, { icSupplierId: event.target.value || null })}
                                className="h-9 w-full min-w-0 rounded-[6px] border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-brand-500"
                              >
                                <option value="">— Chọn —</option>
                                {suppliers.map((supplier) => (
                                  <option key={supplier.id} value={supplier.id}>
                                    {supplier.shortName ? `${supplier.shortName} · ${supplier.name}` : supplier.name}
                                  </option>
                                ))}
                              </select>
                            )}
                            <TextField label="Đơn vị tính chi phí" value={cost.unit} disabled={disabled} onChange={(value) => editCost(section.key, line.key, cost.key, { unit: blankToNull(value) })} />
                            <NumberField label="Số lượng chi phí" decimals={3} value={cost.icQuantity} disabled={disabled} onChange={(value) => editCost(section.key, line.key, cost.key, { icQuantity: value })} />
                            <NumberField label="Đơn giá vốn" value={cost.icUnitPrice} disabled={disabled} onChange={(value) => editCost(section.key, line.key, cost.key, { icUnitPrice: value })} />
                            <select
                              aria-label="VAT đầu vào"
                              value={cost.icVatRate === null ? "" : String(cost.icVatRate)}
                              disabled={disabled}
                              onChange={(event) => editCost(section.key, line.key, cost.key, { icVatRate: event.target.value === "" ? null : Number(event.target.value) })}
                              className="h-9 w-full min-w-0 rounded-[6px] border border-zinc-300 bg-white px-2 text-sm outline-none focus:border-brand-500 disabled:bg-zinc-50"
                            >
                              {VAT_RATE_OPTIONS.map((option) => (
                                <option key={option.label} value={option.value === null ? "" : String(option.value)}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <span className="pr-1 text-right text-sm tabular-nums">{formatVndNumber(amount)}</span>
                            <span className="pr-1 text-right text-sm tabular-nums text-zinc-600">{formatVndNumber(amount + costVat(cost))}</span>
                            <TextField label="Ghi chú chi phí" value={cost.icNote} disabled={disabled} onChange={(value) => editCost(section.key, line.key, cost.key, { icNote: blankToNull(value) })} />
                            <div className="flex justify-end">
                              {!readOnly && (
                                <IconButton
                                  label="Xoá dòng chi phí"
                                  danger
                                  disabled={pending}
                                  onClick={() => editLine(section.key, line.key, { costs: line.costs.filter((item) => item.key !== cost.key) })}
                                >
                                  <Trash2 size={14} aria-hidden="true" />
                                </IconButton>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {!readOnly && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => editLine(section.key, line.key, { costs: [...line.costs, emptyCost()] })}
                          className="ml-9 mt-1 inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-50"
                        >
                          <Plus size={13} aria-hidden="true" />
                          Dòng chi phí
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {!readOnly && (
              <div className="border-t border-zinc-100 px-4 py-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => editSection(section.key, (current) => ({ ...current, lines: [...current.lines, emptyLine()] }))}
                  className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                >
                  <Plus size={15} aria-hidden="true" />
                  Thêm hạng mục
                </button>
              </div>
            )}
          </section>
        );
      })}

      {!readOnly && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const key = tempKey();
            edit((current) => [...current, { key, id: key, name: "", lines: [emptyLine()] }]);
          }}
          className="tf-button-secondary"
        >
          <Plus size={16} aria-hidden="true" />
          Thêm nhóm
        </button>
      )}

      <p className="text-xs text-zinc-500">
        IC v{sheet.version}
        {sheet.updatedByName ? ` · Cập nhật bởi ${sheet.updatedByName}` : ""} ·{" "}
        {new Intl.DateTimeFormat("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(sheet.updatedAt))}
        . Thiếu nhà cung cấp?{" "}
        <Link href="/suppliers" target="_blank" className="font-semibold text-brand-800 underline-offset-2 hover:underline">
          Thêm trong danh bạ
        </Link>
        , rồi tải lại trang.
      </p>

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <span className={`text-sm ${dirty ? "font-medium text-amber-700" : "text-zinc-500"}`} aria-live="polite">
              {pending ? "Đang lưu…" : dirty ? "Có thay đổi chưa lưu" : "Đã lưu mọi thay đổi"}
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={!dirty || pending} onClick={resetChanges} className="tf-button-secondary">
                <Undo2 size={16} aria-hidden="true" />
                Huỷ thay đổi
              </button>
              <button type="button" disabled={!dirty || pending} onClick={save} aria-busy={pending} className="tf-button-primary">
                {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                Lưu IC
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
