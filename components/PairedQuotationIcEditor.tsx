"use client";

import { useRouter } from "next/navigation";
import QuotationTotalsEditor from "./QuotationTotalsEditor";
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
import type { PairedFinance } from "@/lib/costflow/pairedReadModel";
import { costFlowAction, type CostFlowActionState } from "@/app/actions/costflow";
import {
  blankPairedRow,
  hydratePairedEditorDefaults,
  pairedFromLegacy,
  normalizePairedRows
} from "@/lib/costflow/pairedDraft";
import {
  displayMoney,
  exact,
  subtract,
  divide,
  multiply,
  decimal,
  round
} from "@/lib/costflow/money";
import { childrenOf, orderedRows, pricedTotal } from "@/lib/costflow/pairedPricing";
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
import { Input, Select } from "./ui/Field";
import { Alert } from "./ui/Presentation";
import { moveQuotationTree, quotationOutline } from "@/lib/costflow/quotationHierarchy";
import { WORKSPACE_CAPABILITIES, type PairedSaveScope } from "@/lib/costflow/workspaceFlow";
import QuotationSettingsDrawer from "./QuotationSettingsDrawer";
import type { QuotationParameterSnapshot } from "@/lib/costflow/quotationParameters";

import WorksheetHeader from "./costflow/paired/WorksheetHeader";
import WorksheetGrid from "./costflow/paired/WorksheetGrid";
import WorksheetSaveBar from "./costflow/paired/WorksheetSaveBar";
import WorksheetDetailDrawer from "./costflow/paired/WorksheetDetailDrawer";
import { PERCENT_FORMATTER } from "./costflow/paired/WorksheetHelpers";
import ExcelRoundTripDialog from "./ExcelRoundTripDialog";

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
  finance: PairedFinance;
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
    hydratePairedEditorDefaults(normalizePairedRows(initial?.rows ?? pairedFromLegacy(source, revision)))
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
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [totalsOpen, setTotalsOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; position: "before" | "inside" | "after" } | null>(null);
  const [createdBeneficiaries, setCreatedBeneficiaries] = useState<{ id: string; name: string }[]>([]);
  const [newBeneficiary, setNewBeneficiary] = useState<{
    itemId: string;
    name: string;
    bank: string;
    account: string;
    sourceFileId: string;
  } | null>(null);

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
        totalLines,
        totalLayout
      }),
    [clientId, globalIds, notes, parameterConfig, rows, title, totalLayout, totalLines]
  );
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot;
  const detail = rows.find(row => row.itemId === detailId);
  const deleteTarget = rows.find(row => row.itemId === deleteTargetId);
  const deleteBranch = deleteTarget
    ? [deleteTarget, ...orderedRows(rows, deleteTarget.itemId).map(entry => entry.row)]
    : [];
  const deleteKeepsHistory = deleteBranch.some(
    row => row.quotationLineId || row.icLineId || row.buy.evidenceIds.length > 0
  );
  const outline = useMemo(() => quotationOutline(rows), [rows]);
  const outlineById = useMemo(() => new Map(outline.map(entry => [entry.row.itemId, entry])), [outline]);
  const customerName =
    finance.clients?.find(c => c.id === clientId)?.name ?? initial?.customer ?? source?.customer ?? "";
  const beneficiaryOptions = useMemo(() => {
    const merged = new Map(
      finance.data.beneficiaries.map(beneficiary => [beneficiary.id, { id: beneficiary.id, name: beneficiary.name }])
    );
    for (const supplier of finance.suppliers) merged.set(supplier.id, { id: supplier.id, name: supplier.version.legalName });
    for (const beneficiary of createdBeneficiaries) merged.set(beneficiary.id, beneficiary);
    return [...merged.values()];
  }, [createdBeneficiaries, finance.data.beneficiaries, finance.suppliers]);
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
        row.buy.days ||
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
    update(row.itemId, { [scope]: { ...current, [field]: value } });
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

  const handleRemoveFromQuote = (detailItemId: string) => {
    const affected = new Set([
      detailItemId,
      ...orderedRows(rows, detailItemId).map(x => x.row.itemId)
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
  };

  const confirmPermanentDelete = () => {
    if (!deleteTargetId) return;
    const removedIds = new Set([
      deleteTargetId,
      ...orderedRows(rows, deleteTargetId).map(entry => entry.row.itemId)
    ]);
    setRows(current => current.filter(row => !removedIds.has(row.itemId)));
    setSelected(current => current.filter(itemId => !removedIds.has(itemId)));
    setCollapsed(current => current.filter(itemId => !removedIds.has(itemId)));
    if (evidenceTargets?.some(itemId => removedIds.has(itemId))) setEvidenceTargets(null);
    setDeleteTargetId(null);
    setState({ success: `Đã xóa hẳn ${removedIds.size} dòng khỏi bản đang chỉnh. Bấm Lưu để ghi thay đổi.` });
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

  const save = (command = "SAVE_PAIRED_DRAFT", saveScope: PairedSaveScope = mode === "quote" || locked ? "QUOTE" : mode === "ic" ? "IC" : "BOTH") => {
    const form = new FormData();
    form.set("projectId", finance.project.id);
    form.set("version", String(version));
    form.set("command", command);
    form.set("saveScope", saveScope);
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
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(finance.project.id)}/costflow/paired-save`, {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        const result = await response.json() as CostFlowActionState;
        if (!response.ok && !result.error) result.error = "Chưa lưu được hồ sơ.";
        setState(result);
        if (result.success) {
          if (mode !== "paired" || saveScope === "BOTH") setSavedSnapshot(snapshot);
          else if (saveScope === "QUOTE") {
            const saved = JSON.parse(savedSnapshot) as { rows: PairedRow[]; globalIds: string[] };
            const persisted = JSON.parse(snapshot) as { rows: PairedRow[]; globalIds: string[] };
            persisted.globalIds = saved.globalIds;
            persisted.rows = persisted.rows.map(row => ({
              ...row,
              buy: saved.rows.find(old => old.itemId === row.itemId)?.buy ?? blankPairedRow(row.itemId, row.parentItemId).buy
            }));
            setSavedSnapshot(JSON.stringify(persisted));
          } else {
            const saved = JSON.parse(savedSnapshot) as { rows: PairedRow[]; globalIds: string[] };
            const current = JSON.parse(snapshot) as { rows: PairedRow[]; globalIds: string[] };
            saved.globalIds = current.globalIds;
            saved.rows = saved.rows.map(row => ({
              ...row,
              buy: current.rows.find(value => value.itemId === row.itemId)?.buy ?? row.buy
            }));
            setSavedSnapshot(JSON.stringify(saved));
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
    else {
      if (typeof window !== "undefined" && !window.confirm("Bạn có chắc chắn muốn chốt phiên bản báo giá này? Sau khi chốt, phiên bản báo giá sẽ trở thành chính thức.")) return;
      save("FINALIZE_PAIRED_QUOTATION", mode === "paired" && !locked ? "BOTH" : "QUOTE");
    }
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
      <WorksheetHeader
        mode={mode}
        title={title}
        source={source}
        clientId={clientId}
        clientName={customerName}
        targetRevenue={targetRevenue}
        embedded={embedded}
        versionAction={versionAction}
        roundTripAction={
          mode === "paired" && draftId && !locked ? (
            <ExcelRoundTripDialog
              projectId={finance.project.id}
              draftId={draftId}
              dirty={dirty}
              onApplied={result => {
                setRows(result.rows);
                setVersion(result.version);
                setSavedSnapshot(JSON.stringify({ rows: result.rows, title, clientId, notes, parameterConfig, globalIds, totalLines, totalLayout }));
                setState({ success: `Đã áp dụng Excel round-trip vào nháp v${result.draftVersion}.` });
                router.refresh();
              }}
            />
          ) : undefined
        }
        pending={pending}
        locked={locked}
        viewFilter={viewFilter}
        onViewFilterChange={setViewFilter}
        visibleRowsCount={visibleRows.length}
        totalRowsCount={rows.length}
        groupRowsCount={rows.filter(r => r.rowType === "GROUP").length}
        selectedCount={selected.length}
        globalEvidenceCount={globalIds.length}
        projectId={finance.project.id}
        onCollapseGroups={() => setCollapsed(rows.filter(r => r.rowType === "GROUP").map(r => r.itemId))}
        onExpandAll={() => setCollapsed([])}
        onAddRow={type => add(type)}
        onOpenEvidenceTargets={() => setEvidenceTargets(selected)}
        onOpenGlobalEvidence={() => setEvidenceTargets(["GLOBAL"])}
        onOpenSettings={() => setInfoOpen(true)}
        onFinalize={requestFinalize}
        onBack={() => (dirty ? setConfirmExit(true) : onClose())}
      />

      {mode === "quote" && initial?.reuseSource && (
        <Alert tone="warning" title="Nội dung được sao chép từ nguồn cũ">
          <p>
            {initial.reuseSource.label} · {new Intl.DateTimeFormat("vi-VN").format(new Date(initial.reuseSource.sourceDate))}. Giá bán, VAT và phí có thể đã thay đổi.
          </p>
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
        <WorksheetGrid
          rows={rows}
          visibleRows={visibleRows}
          outlineById={outlineById}
          mode={mode}
          viewFilter={viewFilter}
          locked={locked}
          selected={selected}
          onSelectAll={checked => setSelected(checked ? rows.map(r => r.itemId) : [])}
          onSelectRow={(id, checked) =>
            setSelected(current => (checked ? [...current, id] : current.filter(itemId => itemId !== id)))
          }
          collapsed={collapsed}
          onToggleCollapse={id =>
            setCollapsed(current =>
              current.includes(id) ? current.filter(itemId => itemId !== id) : [...current, id]
            )
          }
          onOpenDetail={openDetail}
          onSide={side}
          onAdd={add}
          onOpenEvidence={targets => setEvidenceTargets(targets)}
          displayedTotals={displayedTotals}
          marginPercent={marginPercent}
          marginReady={marginReady}
          estimatedMargin={estimatedMargin}
          drop={drop}
          dragId={dragId}
          onDragOver={dragOver}
          onPerformDrop={performDrop}
          onDragStart={(id, event) => {
            setDragId(id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDrop(null);
          }}
          focusNextPrice={focusNextPrice}
        />

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

      <WorksheetSaveBar
        mode={mode}
        locked={locked}
        saleTotal={saleTotal}
        buyTotal={buyTotal}
        marginReady={marginReady}
        estimatedMargin={estimatedMargin}
        marginPercent={marginPercent}
        hasBuyInputs={hasBuyInputs}
        dirty={dirty}
        pending={pending}
        draftId={draftId}
        quotationId={quotationId}
        state={state}
        capabilities={capabilities}
        embedded={embedded}
        projectId={finance.project.id}
        onSave={scope => save("SAVE_PAIRED_DRAFT", scope)}
        onPreview={() => setPreview(true)}
        onFinalize={requestFinalize}
        onStartPairedFromQuote={startPairedFromQuote}
        onDismissSuccess={() => setState(current => ({ ...current, success: undefined }))}
      />

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
        disabled={pending}
        onApply={(nextRows, nextConfig) => {
          setRows(nextRows);
          setParameterConfig(nextConfig);
        }}
      />

      <WorksheetDetailDrawer
        open={!!detail}
        onClose={closeDetail}
        detail={detail ?? null}
        outlineById={outlineById}
        outline={outline}
        rows={rows}
        mode={mode}
        locked={locked}
        pending={pending}
        detailIndex={detailIndex}
        detailOrderLength={detailOrder.length}
        detailTarget={detailTarget}
        detailBuySection={detailBuySection}
        detailBuyDisabled={detailBuyDisabled}
        detailSellDisabled={detailSellDisabled}
        beneficiaryOptions={beneficiaryOptions}
        onAdjacentDetail={openAdjacentDetail}
        onUpdate={update}
        onSide={side}
        onAdd={add}
        onMove={move}
        onChangeParent={changeParent}
        onRemoveFromQuote={handleRemoveFromQuote}
        onRequestDelete={setDeleteTargetId}
        onOpenEvidence={targets => setEvidenceTargets(targets)}
        onCreateBeneficiaryClick={itemId =>
          setNewBeneficiary({
            itemId,
            name: "",
            bank: "",
            account: "",
            sourceFileId: ""
          })
        }
        onModeChangePrompt={setModeChange}
        onError={msg => setState({ error: msg })}
      />

      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTargetId(null)}
        title="Xóa hẳn hạng mục?"
        description="Hạng mục sẽ biến mất khỏi Báo giá và IC trong bản đang chỉnh sau khi bạn xác nhận."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTargetId(null)}>
              Hủy
            </Button>
            <Button variant="danger" onClick={confirmPermanentDelete}>
              {deleteBranch.length > 1 ? `Xóa hẳn ${deleteBranch.length} dòng` : "Xóa hẳn"}
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div className="space-y-3">
            <Alert tone="danger" title={`Sắp xóa “${deleteTarget.name || "Hạng mục chưa đặt tên"}”`}>
              {deleteBranch.length > 1
                ? `Thao tác này xóa cả ${deleteBranch.length - 1} dòng con thuộc hạng mục.`
                : "Thao tác này xóa dòng khỏi cấu trúc hiện tại."}
            </Alert>
            <p className="tf-ui-help">Thay đổi chỉ được ghi vào hệ thống khi bạn bấm Lưu.</p>
            {deleteKeepsHistory && (
              <p className="tf-ui-help">
                Báo giá nguồn, chứng từ và lịch sử tài chính đã phát sinh vẫn được hệ thống bảo toàn; thao tác này chỉ loại dòng khỏi bản đang chỉnh.
              </p>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!newBeneficiary}
        onClose={() => setNewBeneficiary(null)}
        title="Tạo nhà cung cấp trong danh bạ chung"
        description="NCC theo JSON project đã chuyển sang chỉ đọc. Tạo NCC tại danh bạ toàn công ty rồi quay lại chọn phiên bản hiện hành."
      >
        <div className="flex items-center justify-between gap-3">
          <p className="tf-ui-help">File tham chiếu NCC đã có (không bắt buộc). Hoặc tải file tham chiếu mới (không bắt buộc); Kế toán xác nhận đúng phiên bản ở lần thanh toán đầu hoặc sau thay đổi.</p>
          <Button variant="primary" onClick={() => router.push("/suppliers")}>Mở danh bạ NCC</Button>
        </div>
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
