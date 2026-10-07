"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import QuotationTotalsEditor from "./QuotationTotalsEditor";
import QuotationIcLineage from "./QuotationIcLineage";
import {
  calculateQuotationTotals,
  normalizeQuotationTotalLayout,
  type QuotationTotalLayoutRow,
  type QuotationTotalLine
} from "@/lib/costflow/quotationTotals";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type ReactNode
} from "react";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Paperclip,
  ArrowUp,
  ArrowDown,
  GripVertical,
  ChevronsDownUp,
  ChevronsUpDown,
  Sparkles,
  Settings2,
  RotateCcw
} from "lucide-react";
import type { Finance } from "./CostFlowPanel";
import { costFlowAction, type CostFlowActionState } from "@/app/actions/costflow";
import { blankPairedRow, pairedFromLegacy, normalizePairedRows } from "@/lib/costflow/pairedDraft";
import {
  displayMoney,
  exact,
  subtract,
  source as moneySource,
  divide,
  multiply,
  decimal,
  round
} from "@/lib/costflow/money";
import { formatPriceInput, ungroupPriceInput } from "@/lib/costflow/inputFormat";
import { childrenOf, orderedRows, groupAmount, pricedTotal } from "@/lib/costflow/pairedPricing";
import {
  projectSales,
  quotationReadinessIssues,
  type QuotationReadinessIssue
} from "@/lib/costflow/quotationProjection";
import IcEvidencePanel from "./IcEvidencePanel";
import IcLineTransform from "./IcLineProvenance";
import ActionForm from "./CostFlowActionForm";
import CustomerQuotationView from "./CustomerQuotationView";
import { Dialog } from "./ui/Dialog";
import type { PairedDraft, PairedRow, Quotation } from "@/lib/costflow/types";
import { Button } from "./ui/Button";
import { Input, Select, Textarea } from "./ui/Field";
import { Alert } from "./ui/Presentation";
import { moveQuotationTree, quotationOutline } from "@/lib/costflow/quotationHierarchy";
import { rowCompletion, WORKSPACE_CAPABILITIES, workspaceSaveLabel } from "@/lib/costflow/workspaceFlow";
import QuotationSettingsDrawer from "./QuotationSettingsDrawer";
import { evaluateFormula, type QuotationParameterSnapshot } from "@/lib/costflow/quotationParameters";

const PERCENT_FORMATTER = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

function calcRowMargin(
  sellCost: { net: string; rawNet: string } | null | undefined,
  buyCost: { net: string; rawNet: string } | null | undefined
): {
  marginDisplay: string;
  percentDisplay: string;
  percentNum: number;
  hasData: boolean;
  isPositive: boolean;
} | null {
  if (!sellCost || !buyCost || sellCost.rawNet === undefined || buyCost.rawNet === undefined) {
    return null;
  }
  try {
    const sNet = exact(sellCost.rawNet);
    const bNet = exact(buyCost.rawNet);
    const diff = subtract(sNet, bNet);
    const isPositive = diff.numerator >= BigInt(0);
    const marginDisplay = displayMoney(moneySource(diff));
    if (sNet.numerator === BigInt(0)) {
      return {
        marginDisplay,
        percentDisplay: "0%",
        percentNum: 0,
        hasData: true,
        isPositive
      };
    }
    const pctRatio = Number(round(multiply(divide(diff, sNet), decimal("10000")))) / 100;
    return {
      marginDisplay,
      percentDisplay: PERCENT_FORMATTER.format(pctRatio) + "%",
      percentNum: pctRatio,
      hasData: true,
      isPositive
    };
  } catch {
    return null;
  }
}

export default function PairedQuotationIcEditor({
  finance,
  initial,
  source,
  onClose = () => undefined,
  mode = "paired",
  embedded = false,
  versionAction,
  targetRevenue,
  revisionId
}: {
  mode?: "quote" | "paired" | "ic";
  finance: Finance;
  initial?: PairedDraft;
  source?: Quotation;
  onClose?: () => void;
  embedded?: boolean;
  versionAction?: ReactNode;
  targetRevenue?: number;
  revisionId?: string;
}) {
  const router = useRouter();
  const capabilities = WORKSPACE_CAPABILITIES[mode];
  const revision =
    mode === "quote"
      ? undefined
      : finance.data.revisions.find(
          r =>
            r.id ===
            (revisionId ?? initial?.icRevisionId ??
              (mode === "ic"
                ? finance.data.revisions.find(value => value.quotationId === source?.id)?.id
                : finance.data.workingRevisionId))
        );
  const request = finance.requests.find(r => r.id === revision?.requestId);
  const locked = !!revision && (request?.state !== "DRAFT" || revision.effective);
  const [rows, setRows] = useState<PairedRow[]>(() =>
    normalizePairedRows(initial?.rows ?? pairedFromLegacy(source, revision))
  );
  const [draftId, setDraftId] = useState(initial?.id ?? "");
  const [version, setVersion] = useState(finance.version);
  const [title, setTitle] = useState(initial?.title ?? source?.title ?? finance.project.name);
  const [clientId, setClientId] = useState(
    initial?.clientId ?? finance.clients?.find(c => c.name === source?.customer)?.id ?? finance.project.client?.id ?? ""
  );
  const [notes, setNotes] = useState(initial?.notes ?? source?.notes ?? "");
  const [parameterConfig, setParameterConfig] = useState<QuotationParameterSnapshot | undefined>(() =>
    initial?.parameterConfig
      ? structuredClone(initial.parameterConfig)
      : source?.parameterConfig
      ? structuredClone(source.parameterConfig)
      : undefined
  );
  const [state, setState] = useState<CostFlowActionState>({});
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [modeChange, setModeChange] = useState<{ id: string; mode: "PACKAGE" | "DETAIL" } | null>(null);
  const [quotationId, setQuotationId] = useState("");
  const [preview, setPreview] = useState(false);
  const [evidenceTargets, setEvidenceTargets] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [files, setFiles] = useState(finance.evidence);
  const [globalIds, setGlobalIds] = useState(initial?.globalEvidenceIds ?? []);
  const [saveIc, setSaveIc] = useState(mode !== "quote");
  const [totalLines, setTotalLines] = useState<QuotationTotalLine[]>(
    initial?.totalLines ?? source?.totalLines ?? []
  );
  const [totalLayout, setTotalLayout] = useState<QuotationTotalLayoutRow[]>(() =>
    normalizeQuotationTotalLayout(
      initial?.totalLines ?? source?.totalLines ?? [],
      initial?.totalLayout ?? source?.totalLayout
    )
  );
  const [pending, startTransition] = useTransition();
  const [infoOpen, setInfoOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<"general" | "buy">("general");
  const [confirmExit, setConfirmExit] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [totalsOpen, setTotalsOpen] = useState(false);
  const [priceReviewed, setPriceReviewed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [insertMenuId, setInsertMenuId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; position: "before" | "inside" | "after" } | null>(null);

  // View Filter: mode="quote" is SELL-only, mode="ic" is BUY-focused, mode="paired" allows ALL | SELL | BUY
  const [viewFilter, setViewFilter] = useState<"ALL" | "SELL" | "BUY">(
    mode === "quote" ? "SELL" : mode === "ic" ? "BUY" : "ALL"
  );

  const snapshot = useMemo(
    () =>
      JSON.stringify({
        rows,
        title,
        clientId,
        notes,
        parameterConfig,
        globalIds,
        saveIc,
        totalLines,
        totalLayout
      }),
    [clientId, globalIds, notes, parameterConfig, rows, saveIc, title, totalLayout, totalLines]
  );
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot;
  const detail = rows.find(row => row.itemId === detailId);
  const outline = useMemo(() => quotationOutline(rows), [rows]);
  const outlineById = useMemo(() => new Map(outline.map(entry => [entry.row.itemId, entry])), [outline]);
  const detailRole = detail ? outline.find(entry => entry.row.itemId === detail.itemId)?.role : undefined;
  const customerName =
    finance.clients?.find(c => c.id === clientId)?.name ?? initial?.customer ?? source?.customer ?? "";
  const readinessIssues = mode === "ic" ? [] : quotationReadinessIssues(rows, title, customerName, totalLines);
  const ordered = useMemo(() => orderedRows(rows), [rows]);
  const hasLegacyDeepRows = ordered.some(entry => entry.depth > 2);
  const detailBuyDisabled = locked || detail?.rowType === "GROUP" || (!!detail && childrenOf(rows, detail.itemId).length > 0);
  const detailSellDisabled =
    !!detail &&
    (detail.rowType === "GROUP" ||
      !!detail.saleRemoved ||
      (childrenOf(rows, detail.itemId).length > 0 && detail.pricingMode === "DETAIL"));
  const hasBuyInputs =
    rows.some(
      row =>
        row.buy.quantity ||
        row.buy.unitPrice ||
        row.buy.unit ||
        row.buy.notes ||
        row.buy.vendorId ||
        row.buy.evidenceIds.length ||
        row.buy.evidenceReason
    ) || globalIds.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-paired-menu]")) {
        setAddOpen(false);
        setInsertMenuId(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAddOpen(false);
        setInsertMenuId(null);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const wrapper = useRef<HTMLElement>(null);
  const focusRow = useRef<string | null>(null);
  const detailBuySection = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (focusRow.current) {
      wrapper.current?.querySelector<HTMLElement>(`[data-item-id="${focusRow.current}"]`)?.focus();
      focusRow.current = null;
    }
  }, [rows]);

  useEffect(() => {
    if (!detailId || detailTarget !== "buy") return;
    const frame = window.requestAnimationFrame(() => {
      const section = detailBuySection.current;
      if (!section) return;
      section.scrollIntoView({ block: "start" });
      const control = section.querySelector<HTMLElement>(
        "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)"
      );
      (control ?? section).focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detailId, detailTarget]);

  const update = (id: string, value: Partial<PairedRow>) =>
    setRows(current => current.map(row => (row.itemId === id ? { ...row, ...value } : row)));

  const side = (row: PairedRow, scope: "sell" | "buy", field: string, value: string) => {
    const current = row[scope];
    const computedField = field === "quantity" || field === "unitPrice";
    const parameterBinding =
      computedField && current.parameterBinding && current.parameterBinding.mode !== "MANUAL"
        ? { ...current.parameterBinding, mode: "OVERRIDDEN" as const }
        : current.parameterBinding;
    update(row.itemId, { [scope]: { ...current, [field]: value, parameterBinding } });
  };

  const reuseFormula = (row: PairedRow, scope: "sell" | "buy") => {
    const binding = row[scope].parameterBinding;
    if (!binding || !parameterConfig) return;
    const next = {
      ...row[scope],
      parameterBinding: {
        ...binding,
        mode:
          binding.quantityFormula?.op === "PARAM" &&
          (!binding.unitPriceFormula || binding.unitPriceFormula.op === "PARAM")
            ? ("PARAMETER" as const)
            : ("FORMULA" as const)
      }
    };
    for (const field of ["quantity", "unitPrice"] as const) {
      const formula = field === "quantity" ? binding.quantityFormula : binding.unitPriceFormula;
      if (!formula) continue;
      const result = evaluateFormula(formula, parameterConfig, binding.moduleId);
      if (result.issue) {
        setState({ error: `${row.name || row.itemId}: ${result.issue.message}` });
        return;
      }
      next[field] = result.value;
      next.parameterBinding.lastCalculated = {
        ...(next.parameterBinding.lastCalculated ?? {}),
        [field]: result.value
      };
    }
    update(row.itemId, { [scope]: next });
  };

  const add = (rowType: "GROUP" | "ITEM" = "ITEM", parent: string | null = null, after?: string) => {
    if (rowType === "GROUP") parent = null;
    if (parent && (orderedRows(rows).find(entry => entry.row.itemId === parent)?.depth ?? 0) >= 2) {
      setState({ error: "Nội dung hỗ trợ ba cấp. Thêm dòng cùng cấp hoặc chọn nhóm cha khác." });
      return;
    }
    const row = blankPairedRow(crypto.randomUUID(), parent, rowType);
    focusRow.current = row.itemId;
    setRows(current => {
      if (!after) return [...current, row];
      const subtree = new Set([after, ...orderedRows(current, after).map(entry => entry.row.itemId)]);
      const last = current.reduce((found, value, index) => (subtree.has(value.itemId) ? index : found), -1);
      return [...current.slice(0, last + 1), row, ...current.slice(last + 1)];
    });
  };

  const pricing = useMemo(() => {
    const itemSaleTotal = pricedTotal(rows, "sell");
    const buyTotal = pricedTotal(rows, "buy");
    const customTotals = calculateQuotationTotals(itemSaleTotal, totalLines);
    const saleTotal = { ...customTotals.amount, incomplete: itemSaleTotal.incomplete || customTotals.incomplete };
    const vatRates = [
      ...new Set([
        ...rows.flatMap(row => (mode === "quote" ? [row.sell.vatPercent] : [row.sell.vatPercent, row.buy.vatPercent])),
        ...totalLines.filter(line => line.kind !== "SUBTOTAL").map(line => line.vatPercent)
      ].filter(Boolean))
    ];
    const vatSummaryLabel =
      vatRates.length === 1 ? `VAT (${vatRates[0]}%)` : "VAT (theo từng hạng mục / khoản phí)";
    const displayedTotals = totalLayout.map(layoutRow => {
      if (layoutRow.id === "SYSTEM_NET")
        return {
          ...layoutRow,
          sell: saleTotal.net,
          buy: buyTotal.net,
          incompleteSell: saleTotal.incomplete,
          incompleteBuy: buyTotal.incomplete
        };
      if (layoutRow.id === "SYSTEM_VAT")
        return {
          ...layoutRow,
          label: layoutRow.label === "VAT" ? vatSummaryLabel : layoutRow.label,
          sell: saleTotal.vat,
          buy: buyTotal.vat,
          incompleteSell: saleTotal.incomplete,
          incompleteBuy: buyTotal.incomplete
        };
      if (layoutRow.id === "SYSTEM_GROSS")
        return {
          ...layoutRow,
          sell: saleTotal.gross,
          buy: buyTotal.gross,
          incompleteSell: saleTotal.incomplete,
          incompleteBuy: buyTotal.incomplete
        };
      const custom = customTotals.lines.find(line => line.id === layoutRow.id);
      return {
        ...layoutRow,
        sell: custom?.amount?.gross,
        buy: undefined,
        incompleteSell: !custom?.amount,
        incompleteBuy: false
      };
    });
    return { buyTotal, customTotals, displayedTotals, itemSaleTotal, saleTotal };
  }, [mode, rows, totalLayout, totalLines]);

  const { buyTotal, displayedTotals, itemSaleTotal, saleTotal } = pricing;
  const marginReady = !saleTotal.incomplete && !buyTotal.incomplete;
  const estimatedMargin = subtract(exact(saleTotal.rawNet), exact(buyTotal.rawNet));
  const marginPercent =
    marginReady && exact(saleTotal.rawNet).numerator !== BigInt(0)
      ? PERCENT_FORMATTER.format(
          Number(round(multiply(divide(estimatedMargin, exact(saleTotal.rawNet)), decimal("10000")))) / 100
        ) + "%"
      : null;

  const visibleRows = useMemo(() => {
    const rowById = new Map(rows.map(row => [row.itemId, row]));
    const collapsedSet = new Set(collapsed);
    return ordered.filter(({ row }) => {
      let parent = row.parentItemId;
      while (parent) {
        if (collapsedSet.has(parent)) return false;
        parent = rowById.get(parent)?.parentItemId ?? null;
      }
      return true;
    });
  }, [collapsed, ordered, rows]);

  const move = (id: string, delta: number) =>
    setRows(current => {
      const row = current.find(value => value.itemId === id)!;
      const siblings = current.filter(value => value.parentItemId === row.parentItemId);
      const index = siblings.findIndex(value => value.itemId === id),
        target = index + delta;
      if (target < 0 || target >= siblings.length) return current;
      const first = current.findIndex(value => value.itemId === id),
        second = current.findIndex(value => value.itemId === siblings[target].itemId);
      const copy = [...current];
      [copy[first], copy[second]] = [copy[second], copy[first]];
      return copy;
    });

  const changeParent = (row: PairedRow, parentItemId: string | null) => {
    try {
      setRows(
        moveQuotationTree(
          rows,
          row.itemId,
          parentItemId,
          childrenOf(rows, parentItemId).filter(candidate => candidate.itemId !== row.itemId).length
        )
      );
    } catch (error) {
      setState({ error: (error as Error).message });
    }
  };

  const dragOver = (event: DragEvent, id: string) => {
    if (!dragId || dragId === id) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    setDrop({ id, position: ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "inside" });
  };

  const performDrop = (event: DragEvent, target: PairedRow) => {
    event.preventDefault();
    const sourceId = dragId || event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === target.itemId) return;
    try {
      if ((drop?.position ?? "inside") === "inside") {
        setRows(
          moveQuotationTree(
            rows,
            sourceId,
            target.itemId,
            childrenOf(rows, target.itemId).filter(row => row.itemId !== sourceId).length
          )
        );
      } else {
        const siblings = rows.filter(row => row.parentItemId === target.parentItemId && row.itemId !== sourceId);
        const targetIndex = siblings.findIndex(row => row.itemId === target.itemId);
        setRows(
          moveQuotationTree(
            rows,
            sourceId,
            target.parentItemId,
            targetIndex + (drop?.position === "after" ? 1 : 0)
          )
        );
      }
    } catch (error) {
      setState({ error: (error as Error).message });
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
      setRows(
        moveQuotationTree(
          rows,
          sourceId,
          null,
          rows.filter(row => row.parentItemId === null && row.itemId !== sourceId).length
        )
      );
    } catch (error) {
      setState({ error: (error as Error).message });
    } finally {
      setDragId(null);
      setDrop(null);
    }
  };

  const detailOrder = ordered.map(entry => entry.row.itemId);
  const detailIndex = detailId ? detailOrder.indexOf(detailId) : -1;
  const openAdjacentDetail = (delta: number) => {
    const next = detailOrder[detailIndex + delta];
    if (next) setDetailId(next);
  };
  const openDetail = (id: string, target: "general" | "buy" = "general") => {
    setDetailTarget(target);
    setDetailId(id);
  };
  const closeDetail = () => {
    setDetailId(null);
    setDetailTarget("general");
  };

  const focusNextPrice = (rowId: string, scope: "sell" | "buy") => {
    const inputs = Array.from(
      wrapper.current?.querySelectorAll<HTMLInputElement>(`input[data-price-scope="${scope}"]:not(:disabled)`) ?? []
    );
    const current = inputs.findIndex(input => input.dataset.priceRow === rowId);
    inputs[current + 1]?.focus();
  };

  const targetRows = rows.filter(r => evidenceTargets?.includes(r.itemId));
  const targetIds = [...new Set(targetRows.flatMap(r => r.buy.evidenceIds))];
  const targetReason = targetRows.length === 1 ? targetRows[0].buy.evidenceReason : "";

  const save = (command = "SAVE_PAIRED_DRAFT") => {
    const form = new FormData();
    form.set("projectId", finance.project.id);
    form.set("version", String(version));
    form.set("command", command);
    form.set("saveIc", saveIc && !locked ? "yes" : "no");
    form.set("globalEvidenceIds", JSON.stringify(globalIds));
    form.set("rows", JSON.stringify(rows));
    form.set("draftId", draftId);
    form.set("title", title);
    form.set("clientId", clientId);
    form.set("notes", notes);
    form.set("parameterConfig", parameterConfig ? JSON.stringify(parameterConfig) : "");
    form.set("sourceQuotationId", source?.id ?? "");
    form.set("workspaceMode", mode);
    form.set("totalLines", JSON.stringify(totalLines));
    form.set("totalLayout", JSON.stringify(totalLayout));
    form.set("priceReviewConfirmed", priceReviewed ? "yes" : "no");
    startTransition(async () => {
      try {
        const result = await costFlowAction({}, form);
        setState(result);
        if (result.success) {
          if (saveIc && !locked) setSavedSnapshot(snapshot);
          else if (mode === "quote") setSavedSnapshot(snapshot);
          else {
            const saved = JSON.parse(savedSnapshot) as { rows: PairedRow[]; globalIds: string[] };
            const persisted = JSON.parse(snapshot) as { rows: PairedRow[]; globalIds: string[] };
            persisted.globalIds = saved.globalIds;
            persisted.rows = persisted.rows.map(row => ({
              ...row,
              buy: saved.rows.find(old => old.itemId === row.itemId)?.buy ?? blankPairedRow(row.itemId, row.parentItemId).buy
            }));
            setSavedSnapshot(JSON.stringify(persisted));
          }
          if (result.draftId) setDraftId(result.draftId);
          if (result.version !== undefined) setVersion(result.version);
          if (result.quotationId) setQuotationId(result.quotationId);
        }
      } catch {
        setState({ error: "Chưa lưu được. Dữ liệu đang nhập vẫn được giữ; kiểm tra kết nối rồi thử lại." });
      }
    });
  };

  const openReadinessIssue = (issue: QuotationReadinessIssue) => {
    setPreflightOpen(false);
    if (issue.target === "INFO") setInfoOpen(true);
    else if (issue.target === "TOTALS") setTotalsOpen(true);
    else if (issue.rowId) setDetailId(issue.rowId);
    else add("ITEM");
  };

  const requestFinalize = () => {
    if (readinessIssues.length) setPreflightOpen(true);
    else if (initial?.priceReviewRequired && !priceReviewed)
      setState({ error: "Xác nhận đã rà soát giá bán, VAT và các dòng phí từ nguồn dùng lại trước khi chốt." });
    else save("FINALIZE_PAIRED_QUOTATION");
  };

  const startPairedFromQuote = () => {
    if (!draftId || dirty) {
      setState({ error: "Lưu nháp Báo giá hiện tại trước khi mở thêm IC song song." });
      return;
    }
    const form = new FormData();
    form.set("projectId", finance.project.id);
    form.set("version", String(version));
    form.set("command", "CREATE_PAIRED_FROM_QUOTE_DRAFT");
    form.set("draftId", draftId);
    startTransition(async () => {
      try {
        const result = await costFlowAction({}, form);
        setState(result);
        if (result.version !== undefined) setVersion(result.version);
        if (result.draftId)
          router.push(`/projects/${finance.project.id}/costflow/paired?draftId=${encodeURIComponent(result.draftId)}`);
      } catch {
        setState({ error: "Chưa mở được workspace song song. Nháp Báo giá hiện tại vẫn được giữ." });
      }
    });
  };

  return (
    <section ref={wrapper} className={`tf-paired-editor tf-paired-workspace tf-workspace-${mode}`}>
      {/* HEADER SECTION */}
      <div className="tf-section-heading tf-paired-workspace-heading">
        <div>
          <div className="flex items-center gap-2">
            <p className="tf-paired-eyebrow">
              {mode === "quote" ? "Scope / Báo giá" : mode === "ic" ? "IC từ báo giá" : "Báo giá & IC song song"}
            </p>
          </div>
          <h2>{title || "Chưa đặt tên báo giá"}</h2>
          {embedded && mode === "quote" && (
            <p className="tf-ui-help">
              {finance.clients?.find(c => c.id === clientId)?.name || "Chưa chọn khách hàng"}
            </p>
          )}
        </div>
        {embedded && mode === "quote" && source ? (
          <div className="tf-scope-version-actions" aria-label="Thao tác phiên bản báo giá">
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setInfoOpen(true)}>
              Thiết lập báo giá
            </Button>
            <Link
              className="tf-button-secondary tf-button-size-sm"
              href={`/projects/${finance.project.id}/costflow/quotations/${source.id}/print`}
            >
              Xuất báo giá
            </Link>
            <Link
              className="tf-button-secondary tf-button-size-sm"
              href={`/projects/${finance.project.id}/costflow/quotations/${source.id}/ic`}
            >
              Lập IC từ BG-{source.number}
            </Link>
            {versionAction}
            <Button size="sm" disabled={pending} onClick={requestFinalize}>
              Chốt phiên bản BG
            </Button>
          </div>
        ) : !embedded && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => (dirty ? setConfirmExit(true) : onClose())}>
            Quay lại
          </Button>
        )}
      </div>

      {mode === "quote" && initial?.priceReviewRequired && initial.reuseSource && (
        <Alert tone="warning" title="Nội dung được sao chép từ nguồn cũ">
          <p>
            {initial.reuseSource.label} · {new Intl.DateTimeFormat("vi-VN").format(new Date(initial.reuseSource.sourceDate))}. Giá bán, VAT và phí có thể đã thay đổi.
          </p>
          <label className="tf-paired-save-scope mt-3">
            <input type="checkbox" checked={priceReviewed} onChange={event => setPriceReviewed(event.target.checked)} />
            Tôi đã rà soát giá bán, VAT và các dòng phí trước khi chốt
          </label>
        </Alert>
      )}

      {locked && (
        <Alert title="IC đã gửi · chỉ đọc phần vốn">
          Bạn vẫn có thể sửa báo giá. Rút hồ sơ tại tab Trình duyệt hoặc lập revision để sửa IC.
        </Alert>
      )}
      {hasLegacyDeepRows && (
        <Alert tone="warning" title="Dữ liệu cũ có hơn ba cấp">
          Các dòng hiện có vẫn được giữ nguyên để tránh mất dữ liệu. Khi sắp xếp hoặc thêm mới, hệ thống chỉ cho phép tối đa ba cấp.
        </Alert>
      )}

      <QuotationIcLineage
        projectId={finance.project.id}
        mode={mode}
        source={source}
        quotations={finance.data.quotations}
        revisionNumber={revision?.number}
        requestState={request?.state}
        draftSaved={!!draftId}
        saveIc={saveIc}
        locked={locked}
      />

      {locked && revision && (
        <details className="tf-paired-revision">
          <summary>Điều chỉnh IC đã gửi</summary>
          <ActionForm finance={{ ...finance, version }} command="COPY_IC" label="Tạo revision IC điều chỉnh" onSuccess={onClose}>
            <input type="hidden" name="sourceRevisionId" value={revision.id} />
            {draftId && <input type="hidden" name="pairedDraftId" value={draftId} />}
            <input type="hidden" name="title" value={"IC — " + title} />
            <p>Bản đang chờ duyệt cần rút tại tab Trình duyệt trước. Bản hiệu lực cũ được giữ khi lập điều chỉnh.</p>
          </ActionForm>
        </details>
      )}

      {!locked && revision && mode !== "quote" && (
        <details className="tf-paired-revision">
          <summary>Cấu trúc dòng IC</summary>
          {dirty ? (
            <Alert tone="warning" title="Lưu thay đổi trước khi tách hoặc gộp dòng">
              Tách/gộp cập nhật revision trực tiếp trên máy chủ. Lưu Worksheet trước để không ghi đè dữ liệu đang chỉnh.
            </Alert>
          ) : (
            <IcLineTransform finance={{ ...finance, version }} revision={revision} />
          )}
        </details>
      )}

      <fieldset disabled={pending} className="tf-paired-form">
        {!(embedded && mode === "quote") && (
          <div className="tf-paired-info-summary">
            <div>
              <span className="tf-paired-info-label">{mode === "ic" ? "Báo giá nguồn" : "Khách hàng"}</span>
              <strong>
                {mode === "ic"
                  ? source
                    ? `BG-${source.number} · ${source.title}`
                    : "Chưa chọn báo giá"
                  : finance.clients?.find(c => c.id === clientId)?.name || "Chưa chọn khách hàng"}
              </strong>
            </div>
            {targetRevenue && (
              <div className="bg-[var(--surface-soft)] border border-[var(--border)] rounded px-3 py-1.5 flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)] font-medium">Doanh thu mục tiêu PO:</span>
                <strong className="text-[var(--success)] font-semibold">{displayMoney(String(targetRevenue))}</strong>
              </div>
            )}
            {mode !== "ic" && (
              <Button variant="secondary" size="sm" onClick={() => setInfoOpen(true)}>
                Thiết lập báo giá
              </Button>
            )}
          </div>
        )}

        {/* SHARED WORKSHEET TOOLBAR */}
        <div className="tf-worksheet-toolbar">
          <div className="tf-worksheet-toolbar-group">
            {/* View Segmented Toggle (Chỉ hiện khi ở mode paired) */}
            {mode === "paired" && (
              <div className="tf-worksheet-view-segmented" role="radiogroup" aria-label="Góc nhìn">
                <button
                  type="button"
                  className={`tf-worksheet-view-btn ${viewFilter === "ALL" ? "is-active" : ""}`}
                  onClick={() => setViewFilter("ALL")}
                >
                  Song song
                </button>
                <button
                  type="button"
                  className={`tf-worksheet-view-btn ${viewFilter === "SELL" ? "is-active" : ""}`}
                  onClick={() => setViewFilter("SELL")}
                >
                  Chỉ Báo giá khách
                </button>
                <button
                  type="button"
                  className={`tf-worksheet-view-btn ${viewFilter === "BUY" ? "is-active" : ""}`}
                  onClick={() => setViewFilter("BUY")}
                >
                  Chỉ Giá vốn IC
                </button>
              </div>
            )}

            {/* 1-Click Collapse/Expand All */}
            <button
              type="button"
              className="tf-worksheet-btn-pill"
              onClick={() => setCollapsed(rows.filter(r => r.rowType === "GROUP").map(r => r.itemId))}
              title="Thu gọn nhanh về các nhóm"
            >
              <ChevronsDownUp size={14} /> Thu gọn về nhóm ({rows.filter(r => r.rowType === "GROUP").length})
            </button>
            <button
              type="button"
              className="tf-worksheet-btn-pill"
              onClick={() => setCollapsed([])}
              title="Mở rộng toàn bộ các dòng"
            >
              <ChevronsUpDown size={14} /> Mở rộng tất cả
            </button>

            {/* Add row (Chỉ cho phép thêm ở quote hoặc paired) */}
            {mode !== "ic" && (
              <div className="tf-quotation-add-wrap tf-paired-add-wrap" data-paired-menu>
                <button
                  type="button"
                  className="tf-worksheet-btn-pill"
                  aria-haspopup="menu"
                  aria-expanded={addOpen}
                  onClick={() => setAddOpen(value => !value)}
                >
                  <Plus size={14} aria-hidden="true" /> Thêm dòng
                </button>
                {addOpen && (
                  <PairedInsertMenu
                    actions={[
                      { label: "Thêm nhóm", onSelect: () => { add("GROUP"); setAddOpen(false); } },
                      { label: "Thêm hạng mục", onSelect: () => { add("ITEM"); setAddOpen(false); } }
                    ]}
                  />
                )}
              </div>
            )}

            {/* Evidence Triggers */}
            {selected.length > 0 && mode !== "quote" && (
              <button
                type="button"
                className="tf-worksheet-btn-pill"
                disabled={locked}
                onClick={() => setEvidenceTargets(selected)}
              >
                <Paperclip size={14} aria-hidden="true" /> Gắn cho {selected.length} dòng
              </button>
            )}
            {mode !== "quote" && (
              <button
                type="button"
                className="tf-worksheet-btn-pill"
                onClick={() => setEvidenceTargets(["GLOBAL"])}
              >
                <Paperclip size={14} aria-hidden="true" /> Minh chứng chung ({globalIds.length})
              </button>
            )}
          </div>

          <div className="tf-worksheet-toolbar-group">
            <span className="text-xs text-[var(--text-secondary)]">
              Hiển thị <strong>{visibleRows.length}</strong> / <strong>{rows.length}</strong> dòng
            </span>
          </div>
        </div>

        {/* SHARED WORKSHEET TABLE WITH STICKY HEADER */}
        <div className="tf-worksheet-table-container">
          <table className="w-full border-collapse text-sm tf-quotation-hierarchy-table">
            <thead>
              <tr className="text-xs font-semibold text-[var(--foreground)] bg-[var(--surface-soft)] border-b border-[var(--border-strong)]">
                {/* Checkbox select all */}
                <th scope="col" className="p-2 text-center w-16">
                  <label className="inline-flex items-center cursor-pointer" title="Chọn tất cả">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selected.length === rows.length}
                      onChange={e => setSelected(e.target.checked ? rows.map(r => r.itemId) : [])}
                      className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--focus-ring)] h-3.5 w-3.5"
                    />
                  </label>
                </th>
                <th scope="col" className="p-2 text-center w-12">STT</th>
                <th scope="col" className="p-2 text-left">Hạng mục & Mô tả chi tiết</th>

                {/* Sell Columns */}
                {viewFilter !== "BUY" && (
                  <>
                    <th scope="col" className="p-2 text-center w-20 bg-[var(--surface-soft)] border-l border-[var(--border)]">ĐVT</th>
                    <th scope="col" className="p-2 text-center w-16 bg-[var(--surface-soft)]">SL</th>
                    <th scope="col" className="p-2 text-right w-28 bg-[var(--surface-soft)]">Đơn giá bán</th>
                    <th scope="col" className="p-2 text-right w-32 bg-[var(--surface-soft)] font-bold">Thành tiền bán</th>
                  </>
                )}

                {/* Buy Columns */}
                {viewFilter !== "SELL" && (
                  <>
                    <th scope="col" className="p-2 text-right w-28 bg-[var(--surface-soft)] border-l border-[var(--border)]">
                      {mode === "ic" ? "Đơn giá vốn" : "Giá vốn"}
                    </th>
                    <th scope="col" className="p-2 text-right w-32 bg-[var(--surface-soft)] font-bold">
                      Thành tiền vốn (IC)
                    </th>
                    {mode === "ic" && (
                      <th scope="col" className="p-2 text-center w-24 bg-[var(--surface-soft)]">
                        Minh chứng
                      </th>
                    )}
                  </>
                )}

                {/* Margin Column (Chỉ hiện khi xem song song hoặc mode ic) */}
                {((mode === "paired" && viewFilter === "ALL") || mode === "ic") && (
                  <th scope="col" className="p-2 text-right w-28 bg-[var(--surface-soft)] border-l border-[var(--border)]">
                    Margin
                  </th>
                )}

                <th scope="col" className="p-2 text-center w-12 border-l border-[var(--border)]">Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ row }, i) => {
                const group = childrenOf(rows, row.itemId).length > 0;
                const structuralGroup = row.rowType === "GROUP";
                const outlineEntry = outlineById.get(row.itemId);
                const numberLabel = outlineEntry?.numberLabel ?? "";
                const role = outlineEntry?.role ?? (structuralGroup ? "GROUP" : "ITEM");
                const childCount = childrenOf(rows, row.itemId).length;
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
                      onDragOver={event => dragOver(event, row.itemId)}
                      onDrop={event => performDrop(event, row)}
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
                                      add("GROUP", null, row.itemId);
                                      setInsertMenuId(null);
                                    }}
                                  >
                                    <Plus size={13} className="text-[var(--muted)]" /> Thêm nhóm bên dưới
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                                    onClick={() => {
                                      add("ITEM", row.itemId);
                                      setInsertMenuId(null);
                                    }}
                                  >
                                    <Plus size={13} className="text-[var(--muted)]" /> Thêm hạng mục trong nhóm
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            className="p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] cursor-grab active:cursor-grabbing transition-opacity opacity-40 group-hover:opacity-100"
                            draggable={!locked && mode !== "ic"}
                            onDragStart={event => {
                              setDragId(row.itemId);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", row.itemId);
                            }}
                            onDragEnd={() => {
                              setDragId(null);
                              setDrop(null);
                            }}
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
                              onChange={e =>
                                setSelected(current =>
                                  e.target.checked ? [...current, row.itemId] : current.filter(id => id !== row.itemId)
                                )
                              }
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
                            onClick={() =>
                              setCollapsed(current =>
                                current.includes(row.itemId) ? current.filter(id => id !== row.itemId) : [...current, row.itemId]
                              )
                            }
                          >
                            {collapsedRow ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                          <button
                            type="button"
                            className="font-bold text-[var(--foreground)] text-sm hover:underline text-left uppercase"
                            onClick={() => openDetail(row.itemId)}
                          >
                            {row.name || "Tên nhóm…"}
                          </button>
                          {row.description && (
                            <span className="text-xs text-[var(--text-secondary)] italic ml-1">
                              ({row.description})
                            </span>
                          )}
                          <span className="text-[11px] text-[var(--text-secondary)] bg-[var(--surface-muted)] rounded px-1.5 py-0.5 ml-1">
                            {childCount} hạng mục
                          </span>
                        </div>
                      </td>

                      {/* Sell Columns */}
                      {viewFilter !== "BUY" && (
                        <>
                          <td className="p-2 text-center text-xs text-[var(--muted)] border-l border-[var(--border)]">—</td>
                          <td className="p-2 text-center text-xs text-[var(--muted)]">—</td>
                          <td className="p-2 text-right text-xs text-[var(--muted)]">—</td>
                          <td className="p-2 text-right font-mono font-bold text-[var(--foreground)]">
                            {sellAmount === undefined ? "—" : displayMoney(sellAmount)}
                          </td>
                        </>
                      )}

                      {/* Buy Columns */}
                      {viewFilter !== "SELL" && (
                        <>
                          <td className="p-2 text-right text-xs text-[var(--muted)] border-l border-[var(--border)]">—</td>
                          <td className="p-2 text-right font-mono font-bold text-[var(--foreground)]">
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
                          onClick={() => openDetail(row.itemId)}
                          className="p-1 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] rounded transition-colors"
                          title="Thiết lập nhóm"
                        >
                          <Settings2 size={15} />
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
                      onDragOver={event => dragOver(event, row.itemId)}
                      onDrop={event => performDrop(event, row)}
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
                                      add("GROUP", null, row.itemId);
                                      setInsertMenuId(null);
                                    }}
                                  >
                                    <Plus size={13} className="text-[var(--muted)]" /> Thêm nhóm bên dưới
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                                    onClick={() => {
                                      add("ITEM", row.parentItemId, row.itemId);
                                      setInsertMenuId(null);
                                    }}
                                  >
                                    <Plus size={13} className="text-[var(--muted)]" /> Thêm hạng mục cùng cấp
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                                    onClick={() => {
                                      add("ITEM", row.itemId);
                                      setInsertMenuId(null);
                                    }}
                                  >
                                    <Plus size={13} className="text-[var(--muted)]" /> Thêm chi tiết con
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            className="p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] cursor-grab active:cursor-grabbing transition-opacity opacity-40 group-hover:opacity-100"
                            draggable={!locked && mode !== "ic"}
                            onDragStart={event => {
                              setDragId(row.itemId);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", row.itemId);
                            }}
                            onDragEnd={() => {
                              setDragId(null);
                              setDrop(null);
                            }}
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
                              onChange={e =>
                                setSelected(current =>
                                  e.target.checked ? [...current, row.itemId] : current.filter(id => id !== row.itemId)
                                )
                              }
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
                            onClick={() =>
                              setCollapsed(current =>
                                current.includes(row.itemId) ? current.filter(id => id !== row.itemId) : [...current, row.itemId]
                              )
                            }
                          >
                            {collapsedRow ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                          <button
                            type="button"
                            className="font-semibold text-[var(--foreground)] text-sm hover:underline text-left"
                            onClick={() => openDetail(row.itemId)}
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
                          <td className="p-2 text-right font-mono font-semibold text-[var(--foreground)]">
                            {sellAmount === undefined ? "—" : displayMoney(sellAmount)}
                          </td>
                        </>
                      )}

                      {/* Buy Columns */}
                      {viewFilter !== "SELL" && (
                        <>
                          <td className="p-2 text-right text-xs text-[var(--muted)] border-l border-[var(--border)]">—</td>
                          <td className="p-2 text-right font-mono font-semibold text-[var(--foreground)]">
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
                          onClick={() => openDetail(row.itemId)}
                          className="p-1 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] rounded transition-colors"
                          title={`Mở chi tiết ${row.name || ""}`}
                        >
                          <Settings2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                }

                // ==========================================
                // CASE 3: LEAF DETAIL ITEM (LEVEL 3 OR STANDALONE)
                // ==========================================
                const indentPx = role === "DETAIL" ? "36px" : "16px";
                return (
                  <tr
                    key={row.itemId}
                    className="border-b border-[var(--border)] hover:bg-[var(--surface-soft)] transition-colors group"
                    data-drop-position={drop?.id === row.itemId ? drop.position : undefined}
                    onDragOver={event => dragOver(event, row.itemId)}
                    onDrop={event => performDrop(event, row)}
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
                                    add("GROUP", null, row.itemId);
                                    setInsertMenuId(null);
                                  }}
                                >
                                  <Plus size={13} className="text-[var(--muted)]" /> Thêm nhóm bên dưới
                                </button>
                                <button
                                  type="button"
                                  className="w-full text-left px-3 py-1.5 text-[var(--foreground)] hover:bg-[var(--surface-soft)] hover:text-[var(--primary)] flex items-center gap-2"
                                  onClick={() => {
                                    add("ITEM", row.parentItemId, row.itemId);
                                    setInsertMenuId(null);
                                  }}
                                >
                                  <Plus size={13} className="text-[var(--muted)]" /> Thêm hạng mục cùng cấp
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          className="p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] cursor-grab active:cursor-grabbing transition-opacity opacity-40 group-hover:opacity-100"
                          draggable={!locked && mode !== "ic"}
                          onDragStart={event => {
                            setDragId(row.itemId);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", row.itemId);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setDrop(null);
                          }}
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
                            onChange={e =>
                              setSelected(current =>
                                e.target.checked ? [...current, row.itemId] : current.filter(id => id !== row.itemId)
                              )
                            }
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
                          onClick={() => openDetail(row.itemId)}
                        >
                          {row.name || "Tên chi tiết…"}
                        </button>
                        {row.description && (
                          <span className="text-xs text-[var(--text-secondary)] truncate max-w-sm ml-1" title={row.description}>
                            ({row.description})
                          </span>
                        )}
                        {row.saleRemoved && (
                          <span className="text-[11px] text-[var(--warning)] bg-[var(--warning-soft)] rounded px-1 border border-[var(--warning)] ml-1">
                            Đã bỏ khỏi BG
                          </span>
                        )}
                        {/* Parameter / Formula Status Badges */}
                        {row.sell.parameterBinding?.mode === "OVERRIDDEN" || row.buy.parameterBinding?.mode === "OVERRIDDEN" ? (
                          <span
                            className="text-[10px] font-medium text-[var(--warning)] bg-[var(--warning-soft)] rounded px-1.5 py-0.5 border border-[var(--warning)] inline-flex items-center gap-1 ml-1"
                            title="Đã sửa tay đè lên công thức tham số. Bấm nút hoàn tác tại ô đơn giá để khôi phục công thức"
                          >
                            <RotateCcw size={10} aria-hidden="true" /> Đã sửa tay
                          </span>
                        ) : row.sell.parameterBinding?.mode === "PARAMETER" ||
                          row.sell.parameterBinding?.mode === "FORMULA" ||
                          row.buy.parameterBinding?.mode === "PARAMETER" ||
                          row.buy.parameterBinding?.mode === "FORMULA" ? (
                          <span
                            className="text-[10px] font-medium text-[var(--color-brand-800)] bg-[var(--primary-soft)] rounded px-1.5 py-0.5 border border-[var(--color-brand-300)] inline-flex items-center gap-1 ml-1"
                            title="Được tính tự động theo tham số sự kiện"
                          >
                            <Sparkles size={10} aria-hidden="true" /> Tham số
                          </span>
                        ) : null}
                      </div>
                    </td>

                    {/* Sell Columns */}
                    {viewFilter !== "BUY" && (
                      <>
                        <td className="p-1 text-center text-xs border-l border-[var(--border)]">
                          <input
                            type="text"
                            value={row.sell.unit}
                            disabled={row.saleRemoved || mode === "ic"}
                            placeholder="ĐVT"
                            onChange={e => side(row, "sell", "unit", e.target.value)}
                            className="w-16 text-center text-xs py-1 px-1 rounded border border-transparent hover:border-[var(--border)] focus:border-[var(--focus-ring)] focus:bg-[var(--surface)] bg-transparent transition-colors"
                          />
                        </td>
                        <td className="p-1 text-center text-xs">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.sell.quantity}
                            disabled={row.saleRemoved || mode === "ic"}
                            placeholder="1"
                            onChange={e => side(row, "sell", "quantity", e.target.value)}
                            className="w-12 text-center text-xs py-1 px-1 rounded border border-transparent hover:border-[var(--border)] focus:border-[var(--focus-ring)] focus:bg-[var(--surface)] bg-transparent transition-colors"
                          />
                        </td>
                        <td className="p-1 text-right">
                          <div className="w-32 ml-auto flex items-center justify-end gap-1">
                            {row.sell.parameterBinding?.mode === "OVERRIDDEN" && mode !== "ic" && (
                              <button
                                type="button"
                                title="Đã sửa tay · Bấm để khôi phục công thức tham số"
                                onClick={() => reuseFormula(row, "sell")}
                                className="p-1 rounded text-[var(--warning)] hover:bg-[var(--warning-soft)] transition-colors flex-shrink-0"
                              >
                                <RotateCcw size={12} aria-hidden="true" />
                              </button>
                            )}
                            <PairedPriceInput
                              label={"Đơn giá bán " + (i + 1)}
                              value={row.sell.unitPrice}
                              disabled={row.saleRemoved || mode === "ic"}
                              rowId={row.itemId}
                              scope="sell"
                              onChange={val => side(row, "sell", "unitPrice", val)}
                              onNext={() => focusNextPrice(row.itemId, "sell")}
                            />
                          </div>
                        </td>
                        <td className="p-2 text-right font-mono text-xs font-semibold text-[var(--color-brand-800)]">
                          {sellAmount === undefined ? "—" : displayMoney(sellAmount)}
                        </td>
                      </>
                    )}

                    {/* Buy Columns */}
                    {viewFilter !== "SELL" && (
                      <>
                        <td className="p-1 text-right border-l border-[var(--border)]">
                          <div className="w-32 ml-auto flex items-center justify-end gap-1">
                            {row.buy.parameterBinding?.mode === "OVERRIDDEN" && (
                              <button
                                type="button"
                                title="Đã sửa tay · Bấm để khôi phục công thức tham số"
                                disabled={locked}
                                onClick={() => reuseFormula(row, "buy")}
                                className="p-1 rounded text-[var(--warning)] hover:bg-[var(--warning-soft)] transition-colors flex-shrink-0"
                              >
                                <RotateCcw size={12} aria-hidden="true" />
                              </button>
                            )}
                            <PairedPriceInput
                              label={"Giá vốn " + (i + 1)}
                              value={row.buy.unitPrice}
                              disabled={locked}
                              rowId={row.itemId}
                              scope="buy"
                              onChange={val => side(row, "buy", "unitPrice", val)}
                              onNext={() => focusNextPrice(row.itemId, "buy")}
                            />
                          </div>
                        </td>
                        <td className="p-2 text-right font-mono text-xs font-semibold text-[var(--info)]">
                          {buyAmount === undefined ? "—" : displayMoney(buyAmount)}
                        </td>
                        {mode === "ic" && (
                          <td className="p-1 text-center">
                            <button
                              type="button"
                              onClick={() => setEvidenceTargets([row.itemId])}
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
                            >
                              <Paperclip size={13} />
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

                    {/* Edit Trigger (Opens Slide-over Drawer) */}
                    <td className="p-2 text-center border-l border-[var(--border)]">
                      <button
                        type="button"
                        onClick={() => openDetail(row.itemId)}
                        className="p-1 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-muted)] rounded transition-colors"
                        title={`Mở chi tiết ${row.name || ""}`}
                      >
                        <Settings2 size={15} />
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
                        <td className="text-right font-mono font-bold text-xs py-2.5 px-3 text-[var(--color-brand-900)]">
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
                        <td className="text-right font-mono font-bold text-xs py-2.5 px-3 text-[var(--info)]">
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

        {mode !== "ic" && dragId && (
          <div className="tf-quotation-root-drop" onDragOver={event => event.preventDefault()} onDrop={dropAtRoot}>
            Thả vào đây để đưa hạng mục ra cấp gốc
          </div>
        )}

        {capabilities.configureQuotationTotals && (
          <QuotationTotalsEditor
            title={mode === "paired" ? "Phí và tổng của báo giá khách" : undefined}
            lines={totalLines}
            layout={totalLayout}
            onChange={setTotalLines}
            onLayoutChange={setTotalLayout}
            items={itemSaleTotal}
            expanded={totalsOpen}
            onExpandedChange={setTotalsOpen}
          />
        )}
      </fieldset>

      {/* STICKY BOTTOM SAVE BAR */}
      <div className="tf-paired-save-bar">
        <div className="tf-paired-totals">
          {mode !== "ic" && (
            <span>
              Báo giá · sau VAT <strong>{saleTotal.incomplete ? "Chưa đủ dữ liệu" : displayMoney(saleTotal.gross)}</strong>
            </span>
          )}
          {mode !== "quote" && (
            <span>
              IC · sau VAT <strong>{buyTotal.incomplete ? "Chưa đủ dữ liệu" : displayMoney(buyTotal.gross)}</strong>
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
                <input type="radio" name="save-scope" checked={saveIc} onChange={() => setSaveIc(true)} /> Báo giá & IC
              </label>
              <label>
                <input type="radio" name="save-scope" checked={!saveIc} onChange={() => setSaveIc(false)} /> Chỉ Báo giá
              </label>
              {initial?.priceReviewRequired && (
                <label className="tf-paired-price-review">
                  <input
                    type="checkbox"
                    checked={priceReviewed}
                    onChange={event => setPriceReviewed(event.target.checked)}
                  />
                  Đã rà giá bán, VAT và phí từ nguồn
                </label>
              )}
            </fieldset>
          )}
          <div className="tf-paired-save-buttons">
            {capabilities.previewCustomer && (
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => setPreview(true)}>
                Xem bản khách
              </Button>
            )}
            <Button size="sm" onClick={() => save()} loading={pending} loadingLabel="Đang lưu…">
              {workspaceSaveLabel(mode, saveIc)}
            </Button>
            {mode === "quote" && !embedded && draftId && (
              <Button variant="secondary" size="sm" disabled={pending || dirty} onClick={startPairedFromQuote}>
                Thêm IC song song
              </Button>
            )}
            {!embedded && capabilities.finalizeQuotation && (
              <Button variant="secondary" size="sm" disabled={pending} onClick={requestFinalize}>
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
                <Link href={`/projects/${finance.project.id}/costflow?tab=ic`}>Mở Internal Cost</Link>
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
            href={"/projects/" + finance.project.id + "/costflow/quotations/" + quotationId + "/print"}
          >
            Mở báo giá đã xuất / lưu PDF ↗
          </a>
        )}
      </div>

      <Dialog
        open={preflightOpen}
        onClose={() => setPreflightOpen(false)}
        title="Hoàn tất trước khi chốt"
        description="Báo giá chưa đủ điều kiện tạo phiên bản phát hành."
        footer={
          <Button variant="secondary" onClick={() => setPreflightOpen(false)}>
            Tiếp tục chỉnh sửa
          </Button>
        }
      >
        <div className="tf-quotation-preflight">
          <p>Chọn một nội dung để mở đúng nơi cần sửa.</p>
          <ul>
            {readinessIssues.map(issue => (
              <li key={issue.id}>
                <button type="button" onClick={() => openReadinessIssue(issue)}>
                  {issue.message}
                  <span aria-hidden="true">Mở để sửa →</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>

      <QuotationSettingsDrawer
        key={`${infoOpen ? "open" : "closed"}:${title}:${clientId}:${notes}`}
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={title}
        onTitle={setTitle}
        clientId={clientId}
        onClientId={setClientId}
        clients={finance.clients ?? []}
        notes={notes}
        onNotes={setNotes}
        rows={rows}
        parameterConfig={parameterConfig}
        disabled={pending}
        onApply={(nextRows, nextConfig) => {
          setRows(nextRows);
          setParameterConfig(nextConfig);
        }}
      />

      {/* ROW DETAIL SLIDE-OVER RIGHT DRAWER */}
      <Dialog
        open={!!detail}
        onClose={closeDetail}
        title={
          (mode === "ic"
            ? "Chi tiết Internal Cost · "
            : detail?.rowType === "GROUP"
            ? "Thiết lập nhóm · "
            : "Chi tiết · ") +
          (detail
            ? `${outlineById.get(detail.itemId)?.numberLabel ? `${outlineById.get(detail.itemId)?.numberLabel} · ` : ""}${
                detail.name || (detail.rowType === "GROUP" ? "Nhóm" : "Hạng mục")
              }`
            : "Hạng mục")
        }
        description={
          mode === "ic"
            ? "Cấu trúc và giá bán lấy từ báo giá nguồn. Giá vốn và thông tin nội bộ được lưu trong nháp IC."
            : "Thay đổi ở đây được giữ trong bảng. Bấm lưu nháp để lưu vào hệ thống."
        }
        footer={
          <>
            <Button variant="ghost" disabled={detailIndex <= 0} onClick={() => openAdjacentDetail(-1)}>
              Dòng trước
            </Button>
            <Button
              variant="ghost"
              disabled={detailIndex < 0 || detailIndex >= detailOrder.length - 1}
              onClick={() => openAdjacentDetail(1)}
            >
              Dòng sau
            </Button>
            <Button onClick={closeDetail}>Xong</Button>
          </>
        }
      >
        {detail && (
          <fieldset
            disabled={pending}
            className="tf-paired-detail space-y-4"
            onKeyDown={event => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                openAdjacentDetail(1);
              }
            }}
          >
            <Input
              label={detail.rowType === "GROUP" ? "Tên nhóm" : "Tên hạng mục"}
              readOnly={mode === "ic"}
              value={detail.name}
              onChange={e => update(detail.itemId, { name: e.target.value })}
            />
            <Textarea
              label={detail.rowType === "GROUP" ? "Mô tả nhóm" : "Mô tả hạng mục"}
              rows={2}
              readOnly={mode === "ic"}
              value={detail.description}
              onChange={e => update(detail.itemId, { description: e.target.value })}
            />

            {mode === "ic" && detail.rowType === "ITEM" && (
              <div className="tf-ic-source-summary" aria-label="Giá bán nguồn chỉ đọc">
                <span>
                  <small>ĐVT / SL bán</small>
                  <strong>
                    {detail.sell.unit || "—"} / {detail.sell.quantity || "—"}
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
                    const binding = detail[scope].parameterBinding;
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
                          {binding?.mode === "OVERRIDDEN" && (
                            <span className="tf-parameter-override-badge">Đã ghi đè</span>
                          )}
                        </h3>
                        {binding?.mode === "OVERRIDDEN" && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!parameterConfig || (scope === "buy" && locked)}
                            onClick={() => reuseFormula(detail, scope)}
                          >
                            Dùng lại công thức
                          </Button>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <Input
                            label={"ĐVT " + (scope === "sell" ? "bán" : "mua")}
                            disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                            value={detail[scope].unit}
                            onChange={e => side(detail, scope, "unit", e.target.value)}
                          />
                          <Input
                            label={"Số lượng " + (scope === "sell" ? "bán" : "mua")}
                            inputMode="decimal"
                            disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                            value={detail[scope].quantity}
                            onChange={e => side(detail, scope, "quantity", e.target.value)}
                          />
                          <Input
                            label={scope === "sell" ? "Đơn giá bán" : "Giá vốn"}
                            inputMode="decimal"
                            disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                            value={formatPriceInput(detail[scope].unitPrice)}
                            onChange={e => side(detail, scope, "unitPrice", ungroupPriceInput(e.target.value))}
                          />
                          <Input
                            label={"VAT " + (scope === "sell" ? "bán" : "mua") + " (%)"}
                            inputMode="decimal"
                            disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                            value={detail[scope].vatPercent}
                            onChange={e => side(detail, scope, "vatPercent", e.target.value)}
                          />
                          <Select
                            label={"Đơn giá " + (scope === "sell" ? "bán" : "mua") + " gồm VAT?"}
                            disabled={scope === "buy" ? detailBuyDisabled : detailSellDisabled}
                            value={detail[scope].basis}
                            onChange={e => side(detail, scope, "basis", e.target.value)}
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
                            onChange={e => side(detail, "sell", "notes", e.target.value)}
                          />
                        ) : (
                          <>
                            <Select
                              label="Nhà cung cấp"
                              value={detail.buy.vendorId}
                              disabled={locked}
                              onChange={e => side(detail, "buy", "vendorId", e.target.value)}
                            >
                              <option value="">Chưa chọn</option>
                              {finance.data.beneficiaries.map(b => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </Select>
                            <Textarea
                              label="Ghi chú nội bộ · không xuất cho khách"
                              rows={2}
                              value={detail.buy.notes}
                              disabled={locked}
                              onChange={e => side(detail, "buy", "notes", e.target.value)}
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setEvidenceTargets([detail.itemId])}
                            >
                              <Paperclip size={14} />
                              Minh chứng ·{" "}
                              {detail.buy.evidenceIds.length
                                ? detail.buy.evidenceIds.length + " file"
                                : detail.buy.evidenceReason
                                ? "Có lý do"
                                : "Chưa có nguồn"}
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
                    onChange={e => update(detail.itemId, { showGroupSubtotal: e.target.checked })}
                  />{" "}
                  Hiện tổng nhóm trên editor và bản khách
                </label>
                <label className="tf-paired-save-scope">
                  <input
                    type="checkbox"
                    checked={detail.showChildren}
                    onChange={e => update(detail.itemId, { showChildren: e.target.checked })}
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
                  onChange={e => setModeChange({ id: detail.itemId, mode: e.target.value as "PACKAGE" | "DETAIL" })}
                >
                  <option value="PACKAGE">Giá gói</option>
                  <option value="DETAIL">Giá chi tiết</option>
                </Select>
                {detail.pricingMode === "PACKAGE" && (
                  <Select
                    label="Thông tin dòng con trên báo giá"
                    value={detail.packageChildDisplay}
                    onChange={e =>
                      update(detail.itemId, { packageChildDisplay: e.target.value as "CONTENT" | "QUANTITY" })
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
                    onChange={e => update(detail.itemId, { showChildren: e.target.checked })}
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
                onChange={e => changeParent(detail, e.target.value || null)}
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
                    add(detail.rowType, detail.parentItemId, detail.itemId);
                    setDetailId(null);
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
                        setState({
                          error: "Dòng có chi phí riêng: chưa thể tạo chi tiết con vì sẽ làm trùng nguồn chi phí."
                        });
                        setDetailId(null);
                        return;
                      }
                      add("ITEM", detail.itemId);
                      setDetailId(null);
                    }}
                  >
                    {detail.rowType === "GROUP" ? "Thêm hạng mục" : "Thêm chi tiết con"}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => move(detail.itemId, -1)}>
                  <ArrowUp size={14} aria-hidden="true" />
                  Lên
                </Button>
                <Button variant="ghost" size="sm" onClick={() => move(detail.itemId, 1)}>
                  <ArrowDown size={14} aria-hidden="true" />
                  Xuống
                </Button>
                {!detail.saleRemoved ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      const affected = new Set([
                        detail.itemId,
                        ...orderedRows(rows, detail.itemId).map(x => x.row.itemId)
                      ]);
                      setRows(current =>
                        current.flatMap(r =>
                          affected.has(r.itemId)
                            ? locked ||
                              childrenOf(current, r.itemId).length ||
                              r.buy.unitPrice ||
                              r.buy.evidenceIds.length ||
                              r.buy.evidenceReason
                              ? [{ ...r, saleRemoved: true }]
                              : []
                            : [r]
                        )
                      );
                      setDetailId(null);
                    }}
                  >
                    Bỏ khỏi báo giá
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => update(detail.itemId, { saleRemoved: false })}>
                    Khôi phục bán dòng này
                  </Button>
                )}
              </div>
            )}
          </fieldset>
        )}
      </Dialog>

      <Dialog
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Có thay đổi chưa lưu"
        description="Bạn có thể tiếp tục nhập hoặc bỏ các thay đổi chưa lưu để về danh sách."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmExit(false)}>
              Tiếp tục nhập
            </Button>
            <Button variant="danger" onClick={onClose}>
              Bỏ thay đổi và thoát
            </Button>
          </>
        }
      >
        <p>Nháp đã lưu trước đó vẫn được giữ.</p>
      </Dialog>

      {/* IC EVIDENCE RIGHT DRAWER */}
      <IcEvidencePanel
        finance={finance}
        open={!!evidenceTargets}
        onClose={() => setEvidenceTargets(null)}
        targets={
          evidenceTargets?.map(id =>
            id === "GLOBAL" ? "Toàn IC (không tự gắn từng dòng)" : rows.find(r => r.itemId === id)?.name || id
          ) ?? []
        }
        files={files}
        onFiles={file => setFiles(current => [...current, file])}
        readOnly={locked}
        ids={evidenceTargets?.[0] === "GLOBAL" ? globalIds : targetIds}
        reason={evidenceTargets?.[0] === "GLOBAL" ? "" : targetReason}
        onChange={(ids, reason) => {
          if (evidenceTargets?.[0] === "GLOBAL") setGlobalIds(ids);
          else
            setRows(current =>
              current.map(row =>
                evidenceTargets?.includes(row.itemId)
                  ? {
                      ...row,
                      buy: {
                        ...row.buy,
                        evidenceIds: [
                          ...new Set([
                            ...row.buy.evidenceIds.filter(id => !targetIds.includes(id) || ids.includes(id)),
                            ...ids.filter(id => !targetIds.includes(id))
                          ])
                        ],
                        evidenceReason:
                          targetRows.length === 1 || reason !== targetReason ? reason : row.buy.evidenceReason
                      }
                    }
                  : row
              )
            );
        }}
      />

      <Dialog open={preview} onClose={() => setPreview(false)} title="Báo giá khách nhìn thấy">
        <CustomerQuotationView
          project={finance.project.name}
          quotation={projectSales(
            rows,
            title,
            finance.clients?.find(c => c.id === clientId)?.name ?? initial?.customer ?? source?.customer ?? "",
            notes,
            totalLines,
            totalLayout
          )}
        />
      </Dialog>

      <Dialog
        open={!!modeChange}
        onClose={() => setModeChange(null)}
        title="Kiểm tra tổng khi đổi cách định giá"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModeChange(null)}>
              Hủy
            </Button>
            <Button
              onClick={() => {
                if (modeChange) update(modeChange.id, { pricingMode: modeChange.mode });
                setModeChange(null);
              }}
            >
              Áp dụng
            </Button>
          </>
        }
      >
        Tổng bán cũ: {displayMoney(saleTotal.gross)} · Tổng mới:{" "}
        {displayMoney(
          pricedTotal(
            rows.map(r => (r.itemId === modeChange?.id ? { ...r, pricingMode: modeChange.mode } : r)),
            "sell"
          ).gross
        )}
        . Giá đã nhập được giữ.
      </Dialog>
    </section>
  );
}

function PairedInsertMenu({ actions }: { actions: { label: string; onSelect: () => void }[] }) {
  return (
    <div className="tf-quotation-row-menu tf-quotation-insert-menu" role="menu">
      {actions.map(action => (
        <button key={action.label} type="button" role="menuitem" onClick={action.onSelect}>
          <Plus size={14} aria-hidden="true" />
          {action.label}
        </button>
      ))}
    </div>
  );
}

function PairedPriceInput({
  label,
  value,
  disabled,
  rowId,
  scope,
  onChange,
  onNext
}: {
  label: string;
  value: string;
  disabled?: boolean;
  rowId: string;
  scope: "sell" | "buy";
  onChange: (value: string) => void;
  onNext: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const display = formatPriceInput(value);
  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    let index = 0,
      digits = 0;
    while (index < display.length && digits < caret.current) {
      if (display[index] !== ",") digits++;
      index++;
    }
    input.current.setSelectionRange(index, index);
    caret.current = null;
  }, [display]);
  return (
    <input
      ref={input}
      aria-label={label}
      inputMode="decimal"
      placeholder="—"
      data-price-row={rowId}
      data-price-scope={scope}
      className={`w-full text-right font-mono text-xs py-1 px-1.5 rounded border border-transparent hover:border-[var(--border)] focus:border-[var(--focus-ring)] focus:bg-[var(--surface)] bg-transparent transition-colors tabular-nums${
        display ? "" : " text-[var(--muted)]"
      }`}
      value={display}
      disabled={disabled}
      onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onNext();
        }
      }}
      onChange={event => {
        caret.current = ungroupPriceInput(
          event.target.value.slice(0, event.target.selectionStart ?? event.target.value.length)
        ).length;
        onChange(ungroupPriceInput(event.target.value));
      }}
    />
  );
}
