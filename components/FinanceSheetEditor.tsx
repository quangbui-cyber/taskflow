"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronUp, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { saveFinanceSheet } from "@/app/actions/finance";
import FinanceApprovalBar, { type FinanceApprovalProps } from "@/components/FinanceApprovalBar";
import SupplierPicker from "@/components/SupplierPicker";
import { ImportedSuppliersDialog, SupplierCreateDialog, type FileSupplierGroup } from "@/components/SupplierDialogs";
import type { SupplierOption } from "@/components/SupplierQuickForm";
import { searchKey } from "@/lib/supplierMatch";
import { useInteraction } from "@/components/InteractionProvider";
import { DateRangeField } from "@/components/TemporalFields";
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

export type { SupplierOption } from "@/components/SupplierQuickForm";

// Dòng nhập từ Excel mà NCC chưa có trong danh bạ: ghi chú giữ "NCC trong file: <tên>".
const FILE_SUPPLIER_NOTE = /NCC trong file:\s*([^·]+?)\s*(?:·|$)/;

function fileSupplierName(cost: { icSupplierId: string | null; icNote: string | null }) {
  if (cost.icSupplierId || !cost.icNote) return null;
  return FILE_SUPPLIER_NOTE.exec(cost.icNote)?.[1]?.trim() || null;
}

/** Bỏ phần "NCC trong file: …" khỏi ghi chú khi đã chọn được NCC. */
function withoutFileSupplierNote(note: string | null) {
  if (!note) return note;
  const rest = note
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part && !/^NCC trong file:/.test(part))
    .join(" · ");
  return rest || null;
}

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

// Ô trong bảng: không viền như Excel, rê chuột mới hiện khung, bấm vào là sửa.
const CELL_INPUT =
  "h-8 w-full min-w-0 rounded-[4px] border bg-transparent px-2 text-sm outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 hover:bg-white focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100 disabled:text-zinc-800 disabled:hover:border-transparent disabled:hover:bg-transparent";

/** Ô nhập số kiểu Việt Nam; gõ tự do, rời ô thì định dạng lại. */
function NumberField({
  value,
  onChange,
  fieldKey,
  onValidityChange,
  decimals = 2,
  label,
  disabled,
  className = "",
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Mã riêng của ô, để bảng biết ô nào đang sai. */
  fieldKey: string;
  /** Báo cho bảng biết ô đang chứa chữ không phải số, để chặn bấm Lưu. */
  onValidityChange?: (fieldKey: string, invalid: boolean) => void;
  decimals?: number;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(formatViNumber(value, decimals));
  const [invalid, setInvalid] = useState(false);
  const [focused, setFocused] = useState(false);
  const [shownValue, setShownValue] = useState(value);

  // Giá trị đổi từ bên ngoài (vd bấm "Huỷ thay đổi") thì hiện lại cho khớp.
  if (value !== shownValue) {
    setShownValue(value);
    if (!focused) {
      setText(formatViNumber(value, decimals));
      setInvalid(false);
    }
  }

  useEffect(() => {
    onValidityChange?.(fieldKey, invalid);
  }, [fieldKey, invalid, onValidityChange]);
  // Ô bị xoá (xoá dòng) thì không còn chặn Lưu nữa.
  useEffect(() => () => onValidityChange?.(fieldKey, false), [fieldKey, onValidityChange]);

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={invalid ? "Số không hợp lệ. Dùng dấu chấm ngăn hàng nghìn, dấu phẩy cho phần lẻ." : undefined}
      disabled={disabled}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parseViNumber(event.target.value);
        if (parsed !== null && Number.isNaN(parsed)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        setShownValue(parsed);
        onChange(parsed);
      }}
      onBlur={() => {
        setFocused(false);
        if (!invalid) setText(formatViNumber(value, decimals));
      }}
      className={`${CELL_INPUT} text-right tabular-nums ${
        invalid ? "border-red-400 bg-red-50" : "border-transparent"
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
      title={value ?? undefined}
      placeholder={disabled ? undefined : placeholder}
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className={`${CELL_INPUT} border-transparent ${className}`}
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
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-30 ${
        danger ? "hover:!bg-red-50 hover:!text-red-600" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={`text-lg font-bold tabular-nums sm:text-xl ${
          tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-zinc-950"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** Kiểu xem bảng: cả bán lẫn vốn, chỉ báo giá cho khách, hoặc chỉ IC (giá vốn). */
type ViewMode = "all" | "quote" | "ic";

const VIEW_MODES: { value: ViewMode; label: string; hint: string }[] = [
  { value: "all", label: "Bán + Vốn", hint: "Giá bán và giá vốn trên cùng một hàng" },
  { value: "quote", label: "Báo giá", hint: "Chỉ phần giá bán cho khách" },
  { value: "ic", label: "IC", hint: "Chỉ phần giá vốn, có cột gồm VAT" },
];

const VIEW_MODE_STORAGE_KEY = "taskflow:finance-view-mode";

function readSavedViewMode(): ViewMode | null {
  try {
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return saved === "all" || saved === "quote" || saved === "ic" ? saved : null;
  } catch {
    // Trình duyệt chặn lưu trữ thì dùng mặc định.
    return null;
  }
}

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

type ColKey =
  | "stt"
  | "name"
  | "desc"
  | "unit"
  | "qty"
  | "price"
  | "sell"
  | "costPrice"
  | "vat"
  | "cost"
  | "costGross"
  | "profit"
  | "note"
  | "actions";

// Mọi hàng (nhóm, hạng mục, chi phí) dùng chung một hệ cột nên số bán và số vốn thẳng hàng nhau.
const COL_WIDTH: Record<ColKey, string> = {
  stt: "48px",
  name: "minmax(180px,1.4fr)",
  desc: "minmax(170px,1fr)",
  unit: "72px",
  qty: "56px",
  price: "104px",
  sell: "116px",
  costPrice: "104px",
  vat: "92px",
  cost: "116px",
  costGross: "116px",
  profit: "100px",
  note: "minmax(110px,0.8fr)",
  actions: "120px",
};

const MODE_COLS: Record<ViewMode, ColKey[]> = {
  all: ["stt", "name", "desc", "unit", "qty", "price", "sell", "costPrice", "vat", "cost", "profit", "note", "actions"],
  quote: ["stt", "name", "desc", "unit", "qty", "price", "sell", "note", "actions"],
  ic: ["stt", "name", "desc", "unit", "qty", "costPrice", "vat", "cost", "costGross", "note", "actions"],
};

const SELL_GROUP = new Set<ColKey>(["price", "sell"]);
const COST_GROUP = new Set<ColKey>(["costPrice", "vat", "cost", "costGross"]);
const MONEY_COLS = new Set<ColKey>(["price", "sell", "costPrice", "vat", "cost", "costGross", "profit"]);
const RIGHT_ALIGNED = new Set<ColKey>(["qty", "price", "sell", "costPrice", "cost", "costGross", "profit"]);

/** Chiều rộng tối thiểu của bảng = tổng phần px của mọi cột (cột co giãn tính theo mức nhỏ nhất). */
function minTableWidth(cols: ColKey[]) {
  return cols.reduce((sum, col) => sum + Number(/(\d+)px/.exec(COL_WIDTH[col])?.[1] ?? 0), 0);
}

function formatDateVN(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

const lineCost = (line: { costs: CostLineView[] }) =>
  line.costs.reduce((sum, cost) => sum + costAmount(cost), 0);
const lineCostVat = (line: { costs: CostLineView[] }) =>
  line.costs.reduce((sum, cost) => sum + costVat(cost), 0);

export default function FinanceSheetEditor({
  projectId,
  sheet,
  permissions,
  suppliers,
  approval,
  toolbar,
  canManageSuppliers = false,
}: {
  projectId: string;
  sheet: FinanceSheetView;
  permissions: FinancePermissions;
  suppliers: SupplierOption[];
  approval: FinanceApprovalProps;
  /** Nút phụ hiện bên phải dãy số tổng (vd "Nhập từ Excel"). */
  toolbar?: React.ReactNode;
  /** Được thêm NCC mới vào danh bạ (Admin, Account, Kế toán). */
  canManageSuppliers?: boolean;
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
  const [revision, setRevision] = useState(0);
  // Thông tin chung thu gọn thành một dòng; IC còn trống thì mở sẵn để nhập.
  const [infoOpen, setInfoOpen] = useState(
    () => !readOnly && !Object.values(sheet.header).some((value) => String(value ?? "").trim()),
  );
  // Nhớ kiểu xem đã chọn trên máy này; máy chủ luôn hiển thị "Bán + Vốn".
  const savedViewMode = useSyncExternalStore(subscribeStorage, readSavedViewMode, () => null);
  const [pickedViewMode, setPickedViewMode] = useState<ViewMode | null>(null);
  const viewMode: ViewMode = pickedViewMode ?? savedViewMode ?? "all";
  function chooseViewMode(next: ViewMode) {
    setPickedViewMode(next);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // Không lưu được cũng không sao.
    }
  }
  // Ô số đang gõ sai (vd "12a"): còn ô nào thì không cho Lưu.
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(() => new Set());
  const markInvalid = useCallback((fieldKey: string, invalid: boolean) => {
    setInvalidFields((current) => {
      if (current.has(fieldKey) === invalid) return current;
      const next = new Set(current);
      if (invalid) next.add(fieldKey);
      else next.delete(fieldKey);
      return next;
    });
  }, []);
  const hasInvalid = invalidFields.size > 0;

  // Nhắc khi rời trang mà chưa lưu: đóng/tải lại tab trình duyệt…
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // …và bấm link trong app (tab khác của dự án, thanh bên): hỏi trước khi đi.
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== "_self") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (confirm("IC có thay đổi chưa lưu. Rời trang và bỏ các thay đổi này?")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Bắt ở pha capture để chặn trước khi Next.js chuyển trang.
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [dirty]);

  const totals = useMemo(
    () => sheetTotals(sections.map((section) => ({ lines: section.lines })), sellVatRate),
    [sections, sellVatRate],
  );

  // NCC tạo mới ngay trong bảng được thêm vào đây, không cần tải lại trang.
  const [supplierList, setSupplierList] = useState<SupplierOption[]>(suppliers);
  const [createTarget, setCreateTarget] = useState<{
    sectionKey: string;
    lineKey: string;
    costKey: string;
    text: string;
  } | null>(null);
  const [fileSuppliersOpen, setFileSuppliersOpen] = useState(false);

  function addSuppliers(created: SupplierOption[]) {
    setSupplierList((current) =>
      [...current.filter((item) => !created.some((supplier) => supplier.id === item.id)), ...created].sort((a, b) =>
        (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name, "vi", { sensitivity: "base" }),
      ),
    );
  }

  /** Gán NCC cho mọi dòng chi phí chưa có NCC mà file ghi tên khớp (tên đã chuẩn hoá → id). */
  function assignByFileName(assignments: Map<string, string>) {
    const matches = (cost: CostLineView) => {
      const name = fileSupplierName(cost);
      return Boolean(name && assignments.has(searchKey(name)));
    };
    const count = sections.reduce(
      (sum, section) => sum + section.lines.reduce((inner, line) => inner + line.costs.filter(matches).length, 0),
      0,
    );
    edit((current) =>
      current.map((section) => ({
        ...section,
        lines: section.lines.map((line) => ({
          ...line,
          costs: line.costs.map((cost) => {
            const name = fileSupplierName(cost);
            const id = name ? assignments.get(searchKey(name)) : undefined;
            if (!id) return cost;
            return { ...cost, icSupplierId: id, icNote: withoutFileSupplierNote(cost.icNote) };
          }),
        })),
      })),
    );
    return count;
  }

  // Các tên NCC trong file chưa gán, gom theo tên (để thêm cả loạt).
  const fileSupplierGroups = useMemo<FileSupplierGroup[]>(() => {
    const groups = new Map<string, FileSupplierGroup>();
    for (const section of sections)
      for (const line of section.lines)
        for (const cost of line.costs) {
          const name = fileSupplierName(cost);
          if (!name) continue;
          const key = searchKey(name);
          const group = groups.get(key) ?? { fileName: name, lineCount: 0 };
          group.lineCount += 1;
          groups.set(key, group);
        }
    return [...groups.values()];
  }, [sections]);
  const unassignedCostCount = fileSupplierGroups.reduce((sum, group) => sum + group.lineCount, 0);

  const supplierLabel = useMemo(() => {
    const map = new Map(
      supplierList.map((supplier) => [
        supplier.id,
        supplier.shortName ? `${supplier.shortName}` : supplier.name,
      ]),
    );
    return (id: string | null) => (id ? map.get(id) ?? "(đã xoá)" : "");
  }, [supplierList]);

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
    setInvalidFields(new Set());
    // Dựng lại toàn bộ ô nhập để chữ đang gõ dở (kể cả số sai) cũng về như cũ.
    setRevision((value) => value + 1);
    setDirty(false);
  }

  function save() {
    if (hasInvalid) {
      notify({
        message: `Còn ${invalidFields.size} ô số không hợp lệ (viền đỏ). Sửa lại trước khi lưu.`,
        tone: "error",
      });
      return;
    }
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

  const disabled = readOnly || pending;
  const mode: ViewMode = showSell ? viewMode : "ic";
  const cols = MODE_COLS[mode];
  const gridStyle = { gridTemplateColumns: cols.map((col) => COL_WIDTH[col]).join(" ") };
  const tableMinWidth = minTableWidth(cols);
  const showCosts = mode !== "quote";
  // Tô nền nhẹ cho nhóm cột bán / vốn khi xem cả hai, để mắt dễ tách hai phần.
  const tint = (col: ColKey, strong = false) =>
    mode !== "all"
      ? ""
      : SELL_GROUP.has(col)
        ? strong ? "bg-brand-100/60" : "bg-brand-50/50"
        : COST_GROUP.has(col)
          ? strong ? "bg-sky-100/60" : "bg-sky-50/50"
          : "";
  const cellBase = (col: ColKey) =>
    `flex min-w-0 items-center px-1 ${RIGHT_ALIGNED.has(col) ? "justify-end text-right" : ""} ${tint(col)}`;

  const headerLabel: Record<ColKey, string> = {
    stt: "STT",
    name: showCosts ? "Hạng mục / Chi phí" : "Hạng mục",
    desc: showCosts ? "Mô tả / Nhà cung cấp" : "Mô tả",
    unit: "ĐVT",
    qty: "SL",
    price: "Đơn giá bán",
    sell: mode === "quote" ? "Thành tiền" : "Thành tiền bán",
    costPrice: "Đơn giá vốn",
    vat: "VAT vào",
    cost: "Thành tiền vốn",
    costGross: "Gồm VAT",
    profit: "Lãi",
    note: "Ghi chú",
    actions: "",
  };

  const headerSummary = [
    header.clientName,
    header.programName,
    header.headcount,
    header.location,
    header.eventStart
      ? header.eventEnd && header.eventEnd !== header.eventStart
        ? `${formatDateVN(header.eventStart)} – ${formatDateVN(header.eventEnd)}`
        : formatDateVN(header.eventStart)
      : "",
    showSell ? `VAT bán ra ${formatViNumber(sellVatRate * 100, 1)}%` : "",
  ].filter(Boolean);

  const money = (value: number) => <span className="pr-2 tabular-nums">{formatVndNumber(value)}</span>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 px-4 pt-4 sm:px-5">
        <FinanceApprovalBar sheet={sheet} dirty={dirty} props={approval} />
        {permissions.locked && (
          <p className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
            {sheet.icStatus === "APPROVED"
              ? "IC đã duyệt nên chỉ xem được. Cần sửa thì bấm \"Tạo phiên bản mới\"."
              : "IC đang chờ duyệt nên chỉ xem được. Cần sửa thì rút lại hoặc chờ người duyệt từ chối."}
          </p>
        )}

        <section aria-labelledby="finance-header-title" className="tf-panel px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="finance-header-title" className="text-sm font-semibold">
              Thông tin chung
            </h2>
            {!infoOpen && (
              <p className="min-w-0 flex-1 truncate text-sm text-zinc-600" title={headerSummary.join(" · ")}>
                {headerSummary.length ? headerSummary.join(" · ") : <span className="text-zinc-400">Chưa nhập</span>}
              </p>
            )}
            {infoOpen && <span className="flex-1" />}
            <button
              type="button"
              aria-expanded={infoOpen}
              aria-controls="finance-header-fields"
              onClick={() => setInfoOpen((open) => !open)}
              className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-sm font-semibold text-brand-800 hover:bg-brand-50"
            >
              {infoOpen ? "Thu gọn" : readOnly ? "Xem chi tiết" : "Sửa thông tin"}
              {infoOpen ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
            </button>
          </div>
          {infoOpen && (
            <div id="finance-header-fields" className="mt-3 grid grid-cols-1 gap-3 pb-1.5 sm:grid-cols-2 lg:grid-cols-4">
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
              <div className="sm:col-span-2 lg:col-span-2">
                <DateRangeField
                  label="Thời gian chương trình"
                  startValue={header.eventStart}
                  endValue={header.eventEnd}
                  disabled={disabled}
                  onChange={(eventStart, eventEnd) => {
                    setHeader((current) => ({ ...current, eventStart, eventEnd }));
                    setDirty(true);
                  }}
                  helperText="Chọn một ngày, hoặc thêm ngày kết thúc nếu chương trình kéo dài nhiều ngày."
                />
              </div>
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
          )}
        </section>
      </div>

      <section
        aria-label="Tổng số liệu"
        className="mx-4 mt-3 flex shrink-0 flex-wrap items-center gap-x-8 gap-y-3 rounded-[8px] border border-zinc-200 bg-white px-4 py-2.5 sm:mx-5"
      >
        {showSell && <Stat label="Bán trước VAT" value={formatVndNumber(totals.sellSubtotal)} />}
        {showSell && <Stat label={`Bán gồm VAT ${formatViNumber(sellVatRate * 100, 1)}%`} value={formatVndNumber(totals.sellGross)} />}
        <Stat label="Giá vốn trước VAT" value={formatVndNumber(totals.costSubtotal)} />
        {!showSell && <Stat label="VAT đầu vào" value={formatVndNumber(totals.costVat)} />}
        {!showSell && <Stat label="Giá vốn gồm VAT" value={formatVndNumber(totals.costGross)} />}
        {showSell && (
          <Stat label="Lợi nhuận" value={formatVndNumber(totals.profit)} tone={totals.profit < 0 ? "bad" : "good"} />
        )}
        {showSell && <Stat label="Margin" value={formatMargin(totals.margin)} tone={totals.profit < 0 ? "bad" : "good"} />}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {showSell && (
            <div role="group" aria-label="Kiểu xem bảng" className="inline-flex rounded-[8px] border border-zinc-200 bg-zinc-50 p-0.5">
              {VIEW_MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.hint}
                  aria-pressed={mode === option.value}
                  onClick={() => chooseViewMode(option.value)}
                  className={`rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
                    mode === option.value ? "bg-white text-brand-800 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {toolbar}
        </div>
      </section>

      <div className="flex flex-col px-4 pb-3 pt-3 sm:px-5 md:min-h-0 md:flex-1">
        {!readOnly && fileSupplierGroups.length > 0 && (
          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-[8px] border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <AlertTriangle size={17} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1">
              <b>{unassignedCostCount} dòng chi phí chưa có NCC.</b> File ghi {fileSupplierGroups.length} NCC chưa có trong danh bạ:{" "}
              {fileSupplierGroups.map((group) => group.fileName).join(", ")}.
            </span>
            <button type="button" disabled={pending} onClick={() => setFileSuppliersOpen(true)} className="tf-button-primary !min-h-9 !py-1.5">
              {canManageSuppliers ? `Thêm nhanh ${fileSupplierGroups.length} NCC` : "Chọn NCC có sẵn"}
            </button>
          </div>
        )}
        <div className="tf-panel overflow-auto md:min-h-0 md:flex-1">
          <div className="text-sm" style={{ minWidth: tableMinWidth }}>
            <div
              role="row"
              className="sticky top-0 z-10 grid border-b border-zinc-300 bg-zinc-100 text-xs font-semibold text-zinc-600"
              style={gridStyle}
            >
              {cols.map((col) => (
                <span
                  key={col}
                  role="columnheader"
                  className={`px-3 py-2.5 ${RIGHT_ALIGNED.has(col) ? "text-right" : ""} ${tint(col, true)}`}
                >
                  {headerLabel[col]}
                </span>
              ))}
            </div>

            {sections.length === 0 && (
              <p className="px-4 py-6 text-sm text-zinc-500">IC chưa có nhóm nào.</p>
            )}

            {sections.map((section, sectionIndex) => {
              const sectionTotal = totals.sections[sectionIndex];
              const nameSpan = cols.findIndex((col) => MONEY_COLS.has(col));
              return (
                <div key={`${revision}-${section.key}`} role="rowgroup" aria-label={`Nhóm ${section.name || sectionIndex + 1}`}>
                  <div className="grid min-h-11 border-b border-zinc-200 bg-zinc-50 font-semibold" style={gridStyle}>
                    <div className="flex min-w-0 items-center px-1" style={{ gridColumn: `1 / span ${nameSpan}` }}>
                      <TextField
                        label="Tên nhóm"
                        value={section.name}
                        disabled={disabled}
                        placeholder="VD: I. SẢN XUẤT"
                        onChange={(value) => editSection(section.key, (current) => ({ ...current, name: value }))}
                        className="font-semibold uppercase tracking-wide"
                      />
                    </div>
                    {cols.slice(nameSpan).map((col) => (
                      <div key={col} className={cellBase(col)}>
                        {col === "sell" && money(sectionTotal.sell)}
                        {col === "cost" && money(sectionTotal.cost)}
                        {col === "costGross" && money(sectionTotal.cost + sectionTotal.costVat)}
                        {col === "profit" && (
                          <span className={`pr-2 tabular-nums ${sectionTotal.profit < 0 ? "text-red-700" : "text-emerald-700"}`}>
                            {formatVndNumber(sectionTotal.profit)}
                          </span>
                        )}
                        {col === "actions" && !readOnly && (
                          <div className="flex w-full justify-end gap-0.5">
                            <IconButton label="Đưa nhóm lên" disabled={pending || sectionIndex === 0} onClick={() => edit((current) => move(current, sectionIndex, -1))}>
                              <ArrowUp size={14} aria-hidden="true" />
                            </IconButton>
                            <IconButton label="Đưa nhóm xuống" disabled={pending || sectionIndex === sections.length - 1} onClick={() => edit((current) => move(current, sectionIndex, 1))}>
                              <ArrowDown size={14} aria-hidden="true" />
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
                              <Trash2 size={14} aria-hidden="true" />
                            </IconButton>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {section.lines.length === 0 && (
                    <p className="border-b border-zinc-100 px-4 py-3 text-sm text-zinc-500">Nhóm này chưa có hạng mục.</p>
                  )}

                  {section.lines.map((line, lineIndex) => {
                    const cost = lineCost(line);
                    const hasCosts = line.costs.length > 0;
                    const profit = sellAmount(line) - cost;
                    return (
                      <div key={line.key}>
                        <div className="grid min-h-10 border-b border-zinc-100 bg-white hover:bg-zinc-50/60" style={gridStyle}>
                          {cols.map((col) => (
                            <div key={col} className={cellBase(col)}>
                              {col === "stt" && <TextField label="STT" value={line.stt} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { stt: blankToNull(value) })} className="text-zinc-600" />}
                              {col === "name" && <TextField label="Tên hạng mục" value={line.name} disabled={disabled} placeholder="Tên hạng mục" onChange={(value) => editLine(section.key, line.key, { name: value })} className="font-semibold" />}
                              {col === "desc" && <TextField label="Mô tả hạng mục" value={line.description} disabled={disabled} placeholder="Mô tả" onChange={(value) => editLine(section.key, line.key, { description: blankToNull(value) })} className="text-zinc-600" />}
                              {col === "unit" && <TextField label="Đơn vị tính" value={line.unit} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { unit: blankToNull(value) })} />}
                              {col === "qty" && <NumberField fieldKey={`${line.key}:quantity`} onValidityChange={markInvalid} label="Số lượng bán" decimals={3} value={line.quantity} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { quantity: value })} />}
                              {col === "price" && <NumberField fieldKey={`${line.key}:unitPrice`} onValidityChange={markInvalid} label="Đơn giá bán" value={line.unitPrice} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { unitPrice: value })} />}
                              {col === "sell" && (
                                <span className="pr-2 font-semibold tabular-nums">
                                  {line.unitPrice === null ? <span className="font-normal text-zinc-400" title="Không tính tiền riêng cho khách">–</span> : formatVndNumber(sellAmount(line))}
                                </span>
                              )}
                              {col === "cost" && hasCosts && <span className="pr-2 tabular-nums text-zinc-600" title="Tổng các dòng chi phí">{formatVndNumber(cost)}</span>}
                              {col === "costGross" && hasCosts && <span className="pr-2 tabular-nums text-zinc-600">{formatVndNumber(cost + lineCostVat(line))}</span>}
                              {col === "profit" && (
                                line.unitPrice === null ? (
                                  <span className="pr-2 text-zinc-400" title="Không tính tiền riêng cho khách">–</span>
                                ) : (
                                  <span className={`pr-2 font-semibold tabular-nums ${profit < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatVndNumber(profit)}</span>
                                )
                              )}
                              {col === "note" && showSell && <TextField label="Ghi chú hạng mục" value={line.note} disabled={disabled} onChange={(value) => editLine(section.key, line.key, { note: blankToNull(value) })} />}
                              {col === "actions" && !readOnly && (
                                <div className="flex w-full justify-end gap-0.5">
                                  <IconButton label="Đưa hạng mục lên" disabled={pending || lineIndex === 0} onClick={() => editSection(section.key, (current) => ({ ...current, lines: move(current.lines, lineIndex, -1) }))}>
                                    <ArrowUp size={14} aria-hidden="true" />
                                  </IconButton>
                                  <IconButton label="Đưa hạng mục xuống" disabled={pending || lineIndex === section.lines.length - 1} onClick={() => editSection(section.key, (current) => ({ ...current, lines: move(current.lines, lineIndex, 1) }))}>
                                    <ArrowDown size={14} aria-hidden="true" />
                                  </IconButton>
                                  {showCosts && (
                                    <IconButton label="Thêm dòng chi phí" disabled={pending} onClick={() => editLine(section.key, line.key, { costs: [...line.costs, emptyCost()] })}>
                                      <Plus size={14} aria-hidden="true" />
                                    </IconButton>
                                  )}
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
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {showCosts &&
                          line.costs.map((costLine) => {
                            const amount = costAmount(costLine);
                            return (
                              <div key={costLine.key} className="grid min-h-9 border-b border-zinc-100 bg-zinc-50/40 text-[13px]" style={gridStyle}>
                                {cols.map((col) => (
                                  <div key={col} className={cellBase(col)}>
                                    {col === "stt" && <span aria-hidden="true" className="w-full text-center text-zinc-400">↳</span>}
                                    {col === "name" && (
                                      <div className="w-full pl-4">
                                        <TextField label="Nội dung chi phí" value={costLine.description} disabled={disabled} placeholder="VD: Sản xuất tượng" onChange={(value) => editCost(section.key, line.key, costLine.key, { description: blankToNull(value) })} />
                                      </div>
                                    )}
                                    {col === "desc" &&
                                      (readOnly ? (
                                        <span className="truncate px-2 text-sm font-medium text-brand-800">{supplierLabel(costLine.icSupplierId) || "—"}</span>
                                      ) : (
                                        <SupplierPicker
                                          value={costLine.icSupplierId}
                                          suppliers={supplierList}
                                          fileName={fileSupplierName(costLine)}
                                          disabled={pending}
                                          onChange={(id) =>
                                            editCost(section.key, line.key, costLine.key, {
                                              icSupplierId: id,
                                              ...(id ? { icNote: withoutFileSupplierNote(costLine.icNote) } : {}),
                                            })
                                          }
                                          onCreate={
                                            canManageSuppliers
                                              ? (text) => setCreateTarget({ sectionKey: section.key, lineKey: line.key, costKey: costLine.key, text })
                                              : undefined
                                          }
                                          className={`${CELL_INPUT} border-transparent font-medium text-brand-800`}
                                        />
                                      ))}
                                    {col === "unit" && <TextField label="Đơn vị tính chi phí" value={costLine.unit} disabled={disabled} onChange={(value) => editCost(section.key, line.key, costLine.key, { unit: blankToNull(value) })} />}
                                    {col === "qty" && <NumberField fieldKey={`${costLine.key}:icQuantity`} onValidityChange={markInvalid} label="Số lượng chi phí" decimals={3} value={costLine.icQuantity} disabled={disabled} onChange={(value) => editCost(section.key, line.key, costLine.key, { icQuantity: value })} />}
                                    {col === "costPrice" && <NumberField fieldKey={`${costLine.key}:icUnitPrice`} onValidityChange={markInvalid} label="Đơn giá vốn" value={costLine.icUnitPrice} disabled={disabled} onChange={(value) => editCost(section.key, line.key, costLine.key, { icUnitPrice: value })} />}
                                    {col === "vat" && (
                                      <select
                                        aria-label="VAT đầu vào"
                                        value={costLine.icVatRate === null ? "" : String(costLine.icVatRate)}
                                        disabled={disabled}
                                        onChange={(event) => editCost(section.key, line.key, costLine.key, { icVatRate: event.target.value === "" ? null : Number(event.target.value) })}
                                        className={`${CELL_INPUT} border-transparent`}
                                      >
                                        {VAT_RATE_OPTIONS.map((option) => (
                                          <option key={option.label} value={option.value === null ? "" : String(option.value)}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    {col === "cost" && (
                                      <span className="pr-2 tabular-nums" title={`Gồm VAT: ${formatVndNumber(amount + costVat(costLine))}`}>
                                        {formatVndNumber(amount)}
                                      </span>
                                    )}
                                    {col === "costGross" && <span className="pr-2 tabular-nums text-zinc-600">{formatVndNumber(amount + costVat(costLine))}</span>}
                                    {col === "note" && <TextField label="Ghi chú chi phí" value={costLine.icNote} disabled={disabled} onChange={(value) => editCost(section.key, line.key, costLine.key, { icNote: blankToNull(value) })} />}
                                    {col === "actions" && !readOnly && (
                                      <div className="flex w-full justify-end">
                                        <IconButton
                                          label="Xoá dòng chi phí"
                                          danger
                                          disabled={pending}
                                          onClick={() => editLine(section.key, line.key, { costs: line.costs.filter((item) => item.key !== costLine.key) })}
                                        >
                                          <Trash2 size={14} aria-hidden="true" />
                                        </IconButton>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}

                  {!readOnly && (
                    <div className="border-b border-zinc-200 px-3 py-1.5">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => editSection(section.key, (current) => ({ ...current, lines: [...current.lines, emptyLine()] }))}
                        className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                      >
                        <Plus size={15} aria-hidden="true" />
                        Thêm hạng mục
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {!readOnly && (
              <div className="px-3 py-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const key = tempKey();
                    edit((current) => [...current, { key, id: key, name: "", lines: [emptyLine()] }]);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-sm font-semibold text-brand-800 hover:bg-brand-50"
                >
                  <Plus size={15} aria-hidden="true" />
                  Thêm nhóm
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="mt-2 shrink-0 text-xs text-zinc-500">
          IC v{sheet.version}
          {sheet.updatedByName ? ` · Cập nhật bởi ${sheet.updatedByName}` : ""} ·{" "}
          {new Intl.DateTimeFormat("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(sheet.updatedAt))}
        </p>
      </div>

      {!readOnly && (
        <div className="sticky bottom-0 z-30 shrink-0 border-t border-zinc-200 bg-white/95 px-4 py-2.5 backdrop-blur sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className={`text-sm ${hasInvalid ? "font-medium text-red-700" : dirty ? "font-medium text-amber-700" : "text-zinc-500"}`}
              aria-live="polite"
            >
              {pending
                ? "Đang lưu…"
                : hasInvalid
                  ? `Còn ${invalidFields.size} ô số không hợp lệ (viền đỏ)`
                  : dirty
                    ? "Có thay đổi chưa lưu"
                    : "Đã lưu mọi thay đổi"}
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

      {createTarget && (
        <SupplierCreateDialog
          initialText={createTarget.text}
          suppliers={supplierList}
          sameFileLines={Math.max(
            0,
            (fileSupplierGroups.find((group) => searchKey(group.fileName) === searchKey(createTarget.text))?.lineCount ?? 0) -
              1,
          )}
          onClose={() => setCreateTarget(null)}
          onDone={(supplier, { created, assignSameFile }) => {
            if (created) addSuppliers([supplier]);
            const target = createTarget;
            setCreateTarget(null);
            if (assignSameFile) assignByFileName(new Map([[searchKey(target.text), supplier.id]]));
            editCost(target.sectionKey, target.lineKey, target.costKey, { icSupplierId: supplier.id });
            notify({
              message: `${created ? "Đã thêm vào danh bạ và chọn" : "Đã chọn"} ${supplier.shortName ?? supplier.name}. Bấm "Lưu IC" để lưu bảng.`,
              tone: "success",
            });
          }}
        />
      )}

      {fileSuppliersOpen && (
        <ImportedSuppliersDialog
          groups={fileSupplierGroups}
          suppliers={supplierList}
          canCreate={canManageSuppliers}
          onClose={() => setFileSuppliersOpen(false)}
          onCreated={addSuppliers}
          onDone={(assignments) => {
            setFileSuppliersOpen(false);
            const count = assignByFileName(assignments);
            notify({ message: `Đã gán NCC cho ${count} dòng chi phí. Bấm "Lưu IC" để lưu bảng.`, tone: "success" });
          }}
        />
      )}
    </div>
  );
}
