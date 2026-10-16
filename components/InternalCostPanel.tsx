"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import {
  Layers3,
  ShieldCheck,
  Plus,
  ArrowRight,
  History,
  ExternalLink,
  FileSpreadsheet,
  Clock,
  Info,
  Building2,
  Paperclip,
  CreditCard,
  Pencil,
  Search,
  X,
  Sparkles,
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";
import ActionForm from "@/components/CostFlowActionForm";
import IcEvidencePanel from "@/components/IcEvidencePanel";
import IcRevisionDiff, { IcQuotationUpdates } from "@/components/IcRevisionDiff";
import VendorPaymentScheduleTable from "@/components/VendorPaymentScheduleTable";
import EditIcLineModal from "@/components/EditIcLineModal";
import { workingIcRevision } from "@/lib/costflow/budgetRevisions";
import { icStatusProjection, effectiveBaseline } from "@/lib/costflow/icEffectiveness";
import { calculateCost, calculateMargin, displayMoney, totals, type CalculatedCost } from "@/lib/costflow/money";
import { completeIcLines } from "@/lib/costflow/budgetDraft";
import { matchIcLineToQuotation } from "@/lib/costflow/budgetQuotation";
import { currentPurchaseOrders } from "@/lib/costflow/budgetSources";
import type { IcLine, IcRevision } from "@/lib/costflow/types";

import { STATE_LABELS as STATE } from "@/lib/costflow/labels";

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
  working?: ReturnType<typeof workingIcRevision>;
  workingError?: string;
  onOpenApproval: (requestId: string) => void;
  onOpenAdvance?: (params: {
    kind: "ADVANCE" | "VENDOR_PAYMENT";
    recipientKey: string;
    amount: string;
    title: string;
    scheduleMilestoneId?: string;
  }) => void;
};

function IcRevisionSaveFields({ revision, title, lines }: { revision: IcRevision; title: string; lines: IcLine[] }) {
  return (
    <>
      <input type="hidden" name="requestId" value={revision.requestId} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      {revision.poIds.map(id => <input key={`bulk-po-${id}`} type="hidden" name="poIds" value={id} />)}
      {(revision.briefIds ?? []).map(id => <input key={`bulk-brief-${id}`} type="hidden" name="briefIds" value={id} />)}
      {(revision.evidenceIds ?? []).map(id => <input key={`bulk-evidence-${id}`} type="hidden" name="evidenceIds" value={id} />)}
    </>
  );
}

export default function InternalCostPanel({
  finance,
  user,
  canCreate,
  working,
  workingError,
  onOpenApproval,
  onOpenAdvance,
}: Props) {
  const revisions = finance.data.revisions;
  const quotations = finance.data.quotations ?? [];
  const latestQuotation = quotations.at(-1);

  // Sub-view switcher state: "items" (Bảng Hạng Mục & NCC) | "schedule" (Lịch Thanh Toán & Tạm Ứng) | "revisions" (So Sánh & Lịch Sử)
  const [activeSubView, setActiveSubView] = useState<"items" | "schedule" | "revisions">("items");

  // Effective baseline revision (if any)
  const effective = useMemo(() => {
    try {
      return effectiveBaseline(revisions);
    } catch {
      return revisions.find(r => r.effective);
    }
  }, [revisions]);

  // Selected revision for inspection
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>("");
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [quotationFilter, setQuotationFilter] = useState<"ALL" | "LINKED" | "UNLINKED" | "LOW_MARGIN">("ALL");
  const [editingLine, setEditingLine] = useState<IcLine | null | undefined>(undefined);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [bulkVendorOpen, setBulkVendorOpen] = useState(false);
  const [bulkVendorId, setBulkVendorId] = useState("");
  const [createdBeneficiaries, setCreatedBeneficiaries] = useState<{ id: string; name: string }[]>([]);
  const [newBeneficiary, setNewBeneficiary] = useState<{
    name: string;
    bank: string;
    account: string;
    sourceFileId: string;
  } | null>(null);
  const [actionVersion, setActionVersion] = useState(finance.version);
  const [bulkEvidenceOpen, setBulkEvidenceOpen] = useState(false);
  const [bulkEvidenceIds, setBulkEvidenceIds] = useState<string[]>([]);
  const [bulkEvidenceReason, setBulkEvidenceReason] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState(finance.evidence);

  // Active revision being viewed
  const visibleRevision = useMemo(() => {
    if (selectedRevisionId) {
      return revisions.find(r => r.id === selectedRevisionId);
    }
    return working ?? effective ?? revisions.at(-1);
  }, [selectedRevisionId, revisions, working, effective]);

  // Request corresponding to visible revision
  const visibleRequest = useMemo(() => {
    if (!visibleRevision) return undefined;
    return finance.requests.find(q => q.id === visibleRevision.requestId);
  }, [visibleRevision, finance.requests]);

  // Two-axis projection (budget effectiveness vs approval state)
  const visibleStatus = useMemo(() => {
    if (!visibleRevision || !visibleRequest) return undefined;
    return icStatusProjection(visibleRevision, visibleRequest, revisions);
  }, [visibleRevision, visibleRequest, revisions]);

  // Drafts created by current user
  const internalDrafts = useMemo(() => {
    return (finance.data.quotationDrafts ?? []).filter(
      draft => draft.createdBy === user.id && ["paired", "ic"].includes(draft.workspaceMode ?? "paired")
    );
  }, [finance.data.quotationDrafts, user.id]);

  // Users map for displaying names
  const users = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);
  const beneficiariesMap = useMemo(() => new Map(finance.data.beneficiaries.map(b => [b.id, b])), [finance.data.beneficiaries]);
  const beneficiaryOptions = useMemo(() => {
    const merged = new Map(
      finance.data.beneficiaries.map(beneficiary => [beneficiary.id, { id: beneficiary.id, name: beneficiary.name }])
    );
    for (const supplier of finance.suppliers) merged.set(supplier.id, { id: supplier.id, name: supplier.version.legalName });
    for (const beneficiary of createdBeneficiaries) merged.set(beneficiary.id, beneficiary);
    return [...merged.values()];
  }, [createdBeneficiaries, finance.data.beneficiaries, finance.suppliers]);
  const currentActionVersion = Math.max(actionVersion, finance.version);

  // Check if current user can edit visible revision
  const isEditableDraft = Boolean(
    visibleRevision &&
      visibleRevision.createdBy === user.id &&
      visibleRequest?.state === "DRAFT" &&
      canCreate &&
      !finance.data.closed
  );

  // Active quotation for visible revision
  const activeQuotation = useMemo(() => {
    if (!visibleRevision) return undefined;
    if (visibleRevision.quotationId) {
      return (finance.data.quotations ?? []).find(q => q.id === visibleRevision.quotationId);
    }
    return latestQuotation;
  }, [visibleRevision, finance.data.quotations, latestQuotation]);

  // Map each line to its quotation match
  const lineMatches = useMemo(() => {
    const map = new Map<string, ReturnType<typeof matchIcLineToQuotation>>();
    if (!visibleRevision) return map;
    for (const line of visibleRevision.lines) {
      const match = matchIcLineToQuotation(
        line,
        finance.data.quotations ?? [],
        visibleRevision.quotationId
      );
      map.set(line.id, match);
    }
    return map;
  }, [visibleRevision, finance.data.quotations]);

  // Resolve auto-inherited SL (Quantity) & ĐVT (Unit) from quotation match
  const resolvedLines = useMemo(() => {
    if (!visibleRevision) return [];
    return visibleRevision.lines.map(line => {
      const match = lineMatches.get(line.id);
      const quoteQty = match?.line?.quantity || match?.salesRow?.sell?.quantity || "";
      const quoteUnit = match?.line?.unit || match?.salesRow?.sell?.unit || "";

      const hasOwnQty = !!line.quantity?.trim();
      const hasOwnUnit = !!line.unit?.trim();

      const effectiveQty = hasOwnQty ? line.quantity : quoteQty;
      const effectiveUnit = hasOwnUnit ? line.unit : quoteUnit;
      const isAutoQty = !hasOwnQty && !!quoteQty;
      const isAutoUnit = !hasOwnUnit && !!quoteUnit;

      let effectiveCost = line.cost;
      if (!effectiveCost && effectiveQty && line.unitPrice?.trim()) {
        try {
          effectiveCost = calculateCost({
            quantity: effectiveQty,
            unitPrice: line.unitPrice,
            basis: line.basis || "NET",
            vatPercent: line.vatPercent || "8",
          });
        } catch {
          effectiveCost = null;
        }
      }

      return {
        ...line,
        quantity: effectiveQty,
        unit: effectiveUnit,
        cost: effectiveCost,
        isAutoQty,
        isAutoUnit,
        rawLine: line,
      };
    });
  }, [visibleRevision, lineMatches]);

  const autoInheritedCount = useMemo(() => {
    return resolvedLines.filter(l => l.isAutoQty || l.isAutoUnit).length;
  }, [resolvedLines]);

  // Calculate totals for visible revision using resolvedLines
  const visibleTotals = useMemo(() => {
    if (!visibleRevision) return null;
    const validCosts = resolvedLines.flatMap(l => (l.cost ? [l.cost] : []));
    return totals(validCosts);
  }, [visibleRevision, resolvedLines]);

  // Calculate totals for effective baseline
  const effectiveTotals = useMemo(() => {
    if (!effective) return null;
    try {
      const completeLines = completeIcLines(effective.lines);
      const validCosts = completeLines.flatMap(l => (l.cost ? [l.cost] : []));
      return totals(validCosts);
    } catch {
      const validCosts = effective.lines.flatMap(l => (l.cost ? [l.cost] : []));
      return totals(validCosts);
    }
  }, [effective]);

  // Revenue from PO or latest quotation
  const revenueTotal = useMemo(() => {
    const validPos = currentPurchaseOrders(finance.data.pos);
    const poNetTotal = validPos.reduce((acc, p) => acc + (parseFloat(p.net) || 0), 0);
    if (poNetTotal > 0) return poNetTotal;
    if (latestQuotation?.lines?.length) {
      const quoteCosts = latestQuotation.lines.map(l => {
        try {
          return calculateCost({
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            basis: "NET",
            vatPercent: l.vatPercent || "8"
          });
        } catch {
          return null;
        }
      }).filter(Boolean);
      const qTotals = totals(quoteCosts.filter((cost): cost is CalculatedCost => cost !== null));
      return parseFloat(qTotals.net) || 0;
    }
    return 0;
  }, [finance.data.pos, latestQuotation]);

  // Projected margin for effective baseline
  const effectiveMargin = useMemo(() => {
    if (!effectiveTotals || revenueTotal <= 0) return null;
    const costNetNum = parseFloat(effectiveTotals.net) || 0;
    const marginAmount = revenueTotal - costNetNum;
    const marginPercent = ((marginAmount / revenueTotal) * 100).toFixed(1);
    return { amount: Math.round(marginAmount).toString(), percent: marginPercent };
  }, [effectiveTotals, revenueTotal]);

  // Vendor statistics for visible revision
  const vendorStats = useMemo(() => {
    if (!visibleRevision) return { uniqueVendors: 0, assignedLines: 0, evidenceCount: 0, totalLines: 0 };
    const vendorIds = new Set<string>();
    let assigned = 0;
    let evidenceCount = 0;

    visibleRevision.lines.forEach(l => {
      if (l.vendorId) {
        vendorIds.add(l.vendorId);
        assigned++;
      }
      if ((l.evidenceIds && l.evidenceIds.length > 0) || l.evidenceReason) {
        evidenceCount++;
      }
    });

    return {
      uniqueVendors: vendorIds.size,
      assignedLines: assigned,
      evidenceCount,
      totalLines: visibleRevision.lines.length,
    };
  }, [visibleRevision]);

  // Cash disbursed to vendors
  const disbursedTotal = useMemo(() => {
    return finance.cash
      .filter(c => c.direction === "OUT")
      .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
  }, [finance.cash]);

  // Map each line to its calculated margin against matched quotation line
  const lineMargins = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateMargin>>();
    if (!visibleRevision) return map;
    for (const rLine of resolvedLines) {
      const match = lineMatches.get(rLine.id);
      if (match?.line?.cost && rLine.cost) {
        map.set(rLine.id, calculateMargin(match.line.cost, rLine.cost));
      } else {
        map.set(rLine.id, null);
      }
    }
    return map;
  }, [visibleRevision, lineMatches, resolvedLines]);

  // Aggregate totals comparing quotation sell net vs IC buy net
  const parallelTotals = useMemo(() => {
    if (!visibleRevision) return null;
    const sellCosts: CalculatedCost[] = [];
    const buyCosts: CalculatedCost[] = [];

    for (const rLine of resolvedLines) {
      const match = lineMatches.get(rLine.id);
      if (match?.line?.cost && rLine.cost) {
        sellCosts.push(match.line.cost);
        buyCosts.push(rLine.cost);
      }
    }

    if (sellCosts.length === 0) return null;
    const totalSell = totals(sellCosts);
    const totalBuy = totals(buyCosts);
    const margin = calculateMargin(totalSell, totalBuy);

    return {
      totalSellNet: totalSell.net,
      totalBuyNet: totalBuy.net,
      margin,
    };
  }, [visibleRevision, lineMatches, resolvedLines]);

  // Filter counts for tabs
  const filterCounts = useMemo(() => {
    if (!visibleRevision) return { all: 0, linked: 0, unlinked: 0, lowMargin: 0 };
    let linked = 0;
    let lowMargin = 0;
    for (const rLine of resolvedLines) {
      const match = lineMatches.get(rLine.id);
      if (match) {
        linked++;
        const m = lineMargins.get(rLine.id);
        if (m && (!m.isPositive || m.percentNum < 30)) {
          lowMargin++;
        }
      }
    }
    return {
      all: resolvedLines.length,
      linked,
      unlinked: resolvedLines.length - linked,
      lowMargin,
    };
  }, [visibleRevision, resolvedLines, lineMatches, lineMargins]);

  // Filtered lines for display
  const filteredLines = useMemo(() => {
    if (!visibleRevision) return [];
    let list = resolvedLines;

    if (quotationFilter === "LINKED") {
      list = list.filter(l => !!lineMatches.get(l.id));
    } else if (quotationFilter === "UNLINKED") {
      list = list.filter(l => !lineMatches.get(l.id));
    } else if (quotationFilter === "LOW_MARGIN") {
      list = list.filter(l => {
        const m = lineMargins.get(l.id);
        return m && (!m.isPositive || m.percentNum < 30);
      });
    }

    if (!searchFilter.trim()) return list;
    const q = searchFilter.toLowerCase().trim();
    return list.filter(l => {
      const vName = l.vendorId ? beneficiariesMap.get(l.vendorId)?.name?.toLowerCase() ?? "" : "";
      const qName = lineMatches.get(l.id)?.line.description.toLowerCase() ?? "";
      return (
        l.description.toLowerCase().includes(q) ||
        l.unit.toLowerCase().includes(q) ||
        (l.basis && l.basis.toLowerCase().includes(q)) ||
        vName.includes(q) ||
        qName.includes(q)
      );
    });
  }, [visibleRevision, resolvedLines, searchFilter, quotationFilter, lineMatches, lineMargins, beneficiariesMap]);

  const selectedLineIdSet = useMemo(() => {
    const visibleIds = new Set(visibleRevision?.lines.map(line => line.id) ?? []);
    return new Set(selectedLineIds.filter(id => visibleIds.has(id)));
  }, [selectedLineIds, visibleRevision]);
  const selectedLines = useMemo(
    () => visibleRevision?.lines.filter(line => selectedLineIdSet.has(line.id)) ?? [],
    [selectedLineIdSet, visibleRevision]
  );
  const allFilteredSelected = filteredLines.length > 0 && filteredLines.every(line => selectedLineIdSet.has(line.id));
  const bulkVendorLines = useMemo(
    () => visibleRevision?.lines.map(line => selectedLineIdSet.has(line.id) ? { ...line, vendorId: bulkVendorId } : line) ?? [],
    [bulkVendorId, selectedLineIdSet, visibleRevision]
  );
  const bulkEvidenceLines = useMemo(
    () => visibleRevision?.lines.map(line => selectedLineIdSet.has(line.id) ? {
      ...line,
      evidenceIds: [...new Set([...(line.evidenceIds ?? []), ...bulkEvidenceIds])],
      evidenceReason: bulkEvidenceReason.trim() || line.evidenceReason,
    } : line) ?? [],
    [bulkEvidenceIds, bulkEvidenceReason, selectedLineIdSet, visibleRevision]
  );

  const clearBulkSelection = () => setSelectedLineIds([]);
  const toggleAllFilteredLines = () => {
    const filteredIds = new Set(filteredLines.map(line => line.id));
    setSelectedLineIds(current => allFilteredSelected
      ? current.filter(id => !filteredIds.has(id))
      : [...new Set([...current, ...filteredIds])]
    );
  };

  const pairedHref = `/projects/${finance.project.id}/costflow/paired${
    latestQuotation ? `?quotationId=${encodeURIComponent(latestQuotation.id)}` : ""
  }`;

  const worksheetHref = (revision: IcRevision) => {
    const draft = (finance.data.quotationDrafts ?? []).find(
      value =>
        value.createdBy === user.id &&
        (value.id === revision.pairedDraftId || value.icRevisionId === revision.id)
    );
    if (draft) {
      const sourceQuotationId = draft.sourceQuotationId ?? draft.latestQuotationId ?? revision.quotationId;
      if (draft.workspaceMode === "ic" && sourceQuotationId) {
        return `/projects/${finance.project.id}/costflow/quotations/${sourceQuotationId}/ic?draftId=${encodeURIComponent(draft.id)}`;
      }
      return `/projects/${finance.project.id}/costflow/paired?draftId=${encodeURIComponent(draft.id)}`;
    }
    return `/projects/${finance.project.id}/costflow/paired?revisionId=${encodeURIComponent(revision.id)}`;
  };

  const handleOpenAdvance = onOpenAdvance ?? (() => {});

  return (
    <div className="space-y-6">
      {/* 1. TOP TOOLBAR & QUICK ACTIONS */}
      <div className="tf-module-toolbar flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
            Internal Cost & Ngân sách dự toán
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Xác định giá vốn hạng mục, chỉ định Nhà Cung Cấp (NCC) và lập kế hoạch dòng tiền tạm ứng.
          </p>
        </div>

        {canCreate && !finance.data.closed && (
          <div className="flex flex-wrap items-center gap-2">
            <Link className="tf-button-primary text-sm flex items-center gap-1.5" href={pairedHref}>
              <FileSpreadsheet size={15} aria-hidden="true" />
              Soạn Báo giá & IC
              <ArrowRight size={14} aria-hidden="true" />
            </Link>

            {latestQuotation && (
              <Link
                className="tf-button-secondary text-sm flex items-center gap-1.5"
                href={`/projects/${finance.project.id}/costflow/quotations/${latestQuotation.id}/ic`}
              >
                <span>IC từ BG-{latestQuotation.number}</span>
              </Link>
            )}

            <Link
              className="tf-button-secondary text-sm flex items-center gap-1.5"
              href={working ? worksheetHref(working) : effective ? worksheetHref(effective) : pairedHref}
            >
              <Plus size={15} className="mr-1" aria-hidden="true" />
              {working ? `Tiếp tục IC-R${working.number}` : effective ? `Tạo revision từ IC-R${effective.number}` : "Tạo IC độc lập"}
            </Link>
          </div>
        )}
      </div>

      {/* 2. WARNING / WORKING REVISION ALERTS */}
      {workingError && <Alert tone="danger" title={workingError} />}
      {working && (
        <Alert tone="info" title={`Đang xử lý revision IC-R${working.number}`}>
          Project đang có một revision trong vòng xử lý ({STATE[visibleRequest?.state ?? "DRAFT"]}). Bản đã gửi cần rút ở tab Trình duyệt nếu muốn chỉnh sửa.
        </Alert>
      )}

      {/* 3. DRAFTS IN PROGRESS (IF ANY) */}
      {internalDrafts.length > 0 && (
        <Panel className="bg-[var(--surface-soft)] border-dashed border-[var(--border)]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-[var(--warning)]" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Bản nháp IC đang soạn dở</h3>
              <Badge tone="warning">{internalDrafts.length}</Badge>
            </div>
            <span className="text-xs text-[var(--text-secondary)]">Lưu tự động trong trình duyệt / máy chủ</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {internalDrafts.map(draft => {
              const isIcMode = draft.workspaceMode === "ic";
              const targetHref = `/projects/${finance.project.id}/costflow/${
                isIcMode && draft.sourceQuotationId
                  ? `quotations/${draft.sourceQuotationId}/ic`
                  : "paired"
              }?draftId=${encodeURIComponent(draft.id)}`;

              return (
                <div
                  key={draft.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)] transition-colors"
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge tone={isIcMode ? "info" : "neutral"}>
                        {isIcMode ? "IC từ báo giá" : "Báo giá & IC song song"}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium text-[var(--foreground)] truncate" title={draft.title || "Chưa đặt tên"}>
                      {draft.title || "Chưa đặt tên"}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      Phiên bản v{draft.version} · {users.get(draft.createdBy) ?? "Người lập"}
                    </p>
                  </div>
                  <Link className="tf-button-secondary text-xs shrink-0" href={targetHref}>
                    Tiếp tục
                    <ArrowRight size={12} className="ml-1" aria-hidden="true" />
                  </Link>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* 4. HERO EXECUTIVE CARD & 4 KPI METRICS */}
      <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] p-4 sm:p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[#587216] p-2.5 text-white shadow-sm">
              <ShieldCheck size={24} aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#587216]">
                  Ngân sách IC được phép sử dụng
                </span>
                {effective ? (
                  <Badge tone="success">Baseline hiệu lực</Badge>
                ) : (
                  <Badge tone="warning">Chưa có IC được duyệt</Badge>
                )}
                {visibleRevision && visibleRevision.id !== effective?.id && (
                  <Badge tone="info">Đang xem IC-R{visibleRevision.number}</Badge>
                )}
              </div>
              <h3 className="mt-0.5 text-lg font-bold text-[var(--foreground)]">
                {effective
                  ? `IC-R${effective.number} · Dự toán ngân sách dự án`
                  : working
                    ? `IC-R${working.number} chưa được Quản lý duyệt`
                    : "Chưa có IC được Quản lý duyệt"}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {effective && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedRevisionId(effective.id)}
              >
                Xem Baseline IC-R{effective.number}
              </Button>
            )}
            {visibleRequest && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenApproval(visibleRequest.id)}
                className="text-xs"
              >
                <ExternalLink size={13} className="mr-1" />
                Hồ sơ trình duyệt
              </Button>
            )}
            {canCreate && !finance.data.closed && effective && (
              <Link className="tf-button-primary text-sm flex items-center gap-1" href={worksheetHref(effective)}>
                <Plus size={14} className="mr-1" aria-hidden="true" />
                Tạo Revision mới
              </Link>
            )}
          </div>
        </div>

        {/* KPI METRICS (SUMMARY STRIP) */}
        {visibleTotals ? (
          <div className="tf-summary-strip mt-3">
            <div className="tf-summary-item">
              <span className="tf-summary-label">Tổng dự toán Gross</span>
              <span className="tf-summary-value text-[#587216]">{displayMoney(visibleTotals.gross)}</span>
              <span className="tf-summary-hint">Net: {displayMoney(visibleTotals.net)} ({visibleRevision?.lines.length ?? 0} dòng)</span>
            </div>
            <div className="tf-summary-item">
              <span className="tf-summary-label">Dự toán Margin</span>
              <span className="tf-summary-value text-[var(--success)]">{effectiveMargin ? `${effectiveMargin.percent}%` : "—"}</span>
              <span className="tf-summary-hint">{effectiveMargin ? `Lợi nhuận ~ ${displayMoney(effectiveMargin.amount)}` : "Cần doanh thu PO/BG"}</span>
            </div>
            <div className="tf-summary-item">
              <span className="tf-summary-label">Đã giải ngân / Tạm ứng</span>
              <span className="tf-summary-value">{displayMoney(String(disbursedTotal))}</span>
              <span className="tf-summary-hint">
                {visibleTotals && parseFloat(visibleTotals.gross) > 0
                  ? `${((disbursedTotal / parseFloat(visibleTotals.gross)) * 100).toFixed(1)}% ngân sách IC`
                  : "Thực chi sổ quỹ"}
              </span>
            </div>
            <div className="tf-summary-item">
              <span className="tf-summary-label">Tiến độ NCC & Bằng chứng</span>
              <span className="tf-summary-value text-[var(--info)]">{vendorStats.uniqueVendors} Nhà Cung Cấp</span>
              <span className="tf-summary-hint">{vendorStats.evidenceCount}/{vendorStats.totalLines} dòng đủ báo giá NCC</span>
            </div>
          </div>
        ) : (
          <div className="pt-3 text-sm text-[var(--text-secondary)]">
            <p>
              Chưa có phiên bản IC nào được tạo. Vui lòng bấm <strong>Soạn Báo giá & IC</strong> để bắt đầu dự toán.
            </p>
          </div>
        )}
      </div>

      {/* 5. SUB-VIEW SWITCHER (TÁI CẤU TRÚC: CHẤM DỨT TRANG CUỘN DÀI) */}
      {visibleRevision && (
        <div className="flex border-b border-[var(--border)] gap-2 sm:gap-6 text-sm font-semibold">
          <button
            type="button"
            onClick={() => setActiveSubView("items")}
            className={`pb-3 transition-colors relative flex items-center gap-1.5 ${
              activeSubView === "items"
                ? "text-[#587216] border-b-2 border-[#587216] font-bold"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            <Layers3 size={16} aria-hidden="true" />
            <span>Bảng Hạng Mục & NCC ({visibleRevision.lines.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubView("schedule")}
            className={`pb-3 transition-colors relative flex items-center gap-1.5 ${
              activeSubView === "schedule"
                ? "text-[#587216] border-b-2 border-[#587216] font-bold"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            <Building2 size={16} aria-hidden="true" />
            <span>Lịch Thanh Toán NCC & Tạm Ứng ({vendorStats.uniqueVendors} NCC)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubView("revisions")}
            className={`pb-3 transition-colors relative flex items-center gap-1.5 ${
              activeSubView === "revisions"
                ? "text-[#587216] border-b-2 border-[#587216] font-bold"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            <History size={16} aria-hidden="true" />
            <span>So Sánh & Lịch Sử Revisions ({revisions.length})</span>
          </button>
        </div>
      )}

      {/* 6. CONTENT OF SUB-VIEWS */}
      {visibleRevision && (
        <>
          {/* ═══════════ SUB-VIEW 1: BẢNG HẠNG MỤC & NHÀ CUNG CẤP ═══════════ */}
          {activeSubView === "items" && (
            <Panel id={`ic-revision-${visibleRevision.id}`} className="space-y-4">
              <div className="flex flex-wrap items-center justify-end gap-3 pb-3 border-b border-[var(--border)]">
                <div className="flex flex-wrap items-center justify-end gap-2.5">
                  <div className="relative w-full sm:w-64">
                    <Search
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      placeholder="Lọc hạng mục, ĐVT, tên NCC, báo giá..."
                      value={searchFilter}
                      onChange={e => setSearchFilter(e.target.value)}
                      className="tf-field text-xs h-9 w-full"
                      style={{ paddingLeft: "36px", paddingRight: "32px" }}
                      aria-label="Lọc hạng mục IC"
                    />
                    {searchFilter && (
                      <button
                        type="button"
                        onClick={() => setSearchFilter("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                        aria-label="Xóa bộ lọc"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {isEditableDraft ? (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setEditingLine(null)}
                        className="text-xs flex items-center gap-1"
                      >
                        <Plus size={14} />
                        Thêm hạng mục
                      </Button>
                      <Link
                        className="tf-button-secondary text-xs flex items-center gap-1"
                        href={worksheetHref(visibleRevision)}
                        title="Mở Bảng tính toàn màn hình để tính toán song song Báo giá - IC"
                      >
                        <FileSpreadsheet size={14} />
                        Mở Worksheet song song
                      </Link>
                    </>
                  ) : (
                    canCreate && !finance.data.closed && (
                      <Link
                        className="tf-button-primary text-xs flex items-center gap-1"
                        href={worksheetHref(visibleRevision)}
                        title="Tạo Revision mới kế thừa từ bản này để điều chỉnh số liệu"
                      >
                        <Plus size={14} />
                        Tạo Revision điều chỉnh
                      </Link>
                    )
                  )}
                </div>
              </div>

              {/* Notice if newer quote exists */}
              <IcQuotationUpdates
                finance={finance}
                revision={visibleRevision}
                editable={isEditableDraft}
              />

              {/* PARALLEL QUOTATION LINK FILTER PILLS */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[var(--text-secondary)] font-medium mr-1 flex items-center gap-1">
                    <Layers3 size={13} className="text-[#587216]" /> Lọc liên kết:
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuotationFilter("ALL")}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      quotationFilter === "ALL"
                        ? "bg-[var(--surface)] text-[var(--foreground)] shadow-xs font-bold border border-[var(--border)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    Tất cả ({filterCounts.all})
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuotationFilter("LINKED")}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      quotationFilter === "LINKED"
                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 shadow-xs font-bold border border-blue-200 dark:border-blue-900"
                        : "text-[var(--text-secondary)] hover:text-blue-600"
                    }`}
                  >
                    Đã map Báo giá ({filterCounts.linked})
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuotationFilter("UNLINKED")}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      quotationFilter === "UNLINKED"
                        ? "bg-[var(--surface)] text-[var(--foreground)] shadow-xs font-bold border border-[var(--border)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    Chi phí riêng ({filterCounts.unlinked})
                  </button>
                  {filterCounts.lowMargin > 0 && (
                    <button
                      type="button"
                      onClick={() => setQuotationFilter("LOW_MARGIN")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        quotationFilter === "LOW_MARGIN"
                          ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 shadow-xs font-bold border border-amber-300 dark:border-amber-800"
                          : "text-amber-700 hover:text-amber-900"
                      }`}
                    >
                      Margin mỏng / Lỗ ({filterCounts.lowMargin})
                    </button>
                  )}
                </div>

                {activeQuotation && (
                  <div className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1.5">
                    <span>Báo giá đối chiếu: <strong>BG-{activeQuotation.number}</strong> ({activeQuotation.title || "Báo giá"})</span>
                  </div>
                )}
              </div>

              {/* AUTO-SYNC INHERITANCE NOTICE */}
              {autoInheritedCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-900 dark:text-blue-200">
                  <div className="flex items-center gap-2">
                    <Sparkles size={15} className="text-blue-600 shrink-0" />
                    <span>
                      Hệ thống đã <strong>tự động chuyển Số lượng & Đơn vị tính</strong> từ Báo giá song song sang <strong>{autoInheritedCount} dòng IC</strong> đang để trống.
                    </span>
                  </div>
                  <span className="text-[11px] text-blue-700 dark:text-blue-300 font-mono bg-blue-100/70 dark:bg-blue-900/50 px-2 py-0.5 rounded">
                    Thẻ [BG] = Kế thừa tự động
                  </span>
                </div>
              )}

              {isEditableDraft && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5">
                  <div className="text-xs text-[var(--text-secondary)]">
                    Đã chọn <strong className="text-[var(--foreground)]">{selectedLines.length}</strong> dòng
                    {selectedLines.length > 0 && filteredLines.length !== visibleRevision.lines.length
                      ? " (giữ lựa chọn khi đổi bộ lọc)"
                      : ""}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={selectedLines.length === 0}
                      onClick={() => setBulkVendorOpen(true)}
                    >
                      <Building2 size={14} aria-hidden="true" />
                      Gắn NCC hàng loạt
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={selectedLines.length === 0}
                      onClick={() => {
                        setBulkEvidenceIds([]);
                        setBulkEvidenceReason("");
                        setBulkEvidenceOpen(true);
                      }}
                    >
                      <Paperclip size={14} aria-hidden="true" />
                      Gắn Minh chứng hàng loạt
                    </Button>
                    {selectedLines.length > 0 && (
                      <Button type="button" variant="ghost" size="sm" onClick={clearBulkSelection}>
                        <X size={14} aria-hidden="true" />
                        Bỏ chọn
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* COMPACT TABLE WITH PARALLEL QUOTATION & LIVE MARGIN */}
              <Table caption={`Các dòng chi phí và NCC của IC revision ${visibleRevision.number}`} hideCaption>
                <thead>
                  <tr>
                    {isEditableDraft && (
                      <th scope="col" className="w-10 text-center">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAllFilteredLines}
                          aria-label={`Chọn tất cả ${filteredLines.length} dòng đang hiển thị`}
                        />
                      </th>
                    )}
                    <th scope="col" className="w-10 text-center">#</th>
                    <th scope="col">Nội dung chi phí & Ghi chú</th>
                    <th scope="col" className="w-16">ĐVT</th>
                    <th scope="col" className="w-14 text-right">SL</th>
                    <th scope="col" className="w-28 text-right">Chi phí Net</th>
                    <th scope="col" className="w-28 text-right">Chi phí Gross</th>
                    <th scope="col" className="w-36 text-right">Báo giá song song (Net)</th>
                    <th scope="col" className="w-32 text-right">Lãi gộp & % Margin</th>
                    <th scope="col" className="w-40">Nhà Cung Cấp (NCC)</th>
                    <th scope="col" className="w-20 text-center">Minh chứng</th>
                    <th scope="col" className="w-16 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLines.length > 0 ? (
                    filteredLines.map((line, idx) => {
                      const ben = line.vendorId ? beneficiariesMap.get(line.vendorId) : undefined;
                      const hasEvidence = line.evidenceIds && line.evidenceIds.length > 0;
                      const match = lineMatches.get(line.id);
                      const margin = lineMargins.get(line.id);

                      return (
                        <tr key={line.id ? `${line.id}-${idx}` : `line-${idx}`}>
                          {isEditableDraft && (
                            <td className="text-center">
                              <input
                                type="checkbox"
                                checked={selectedLineIdSet.has(line.id)}
                                onChange={event => setSelectedLineIds(current => event.target.checked
                                  ? [...new Set([...current, line.id])]
                                  : current.filter(id => id !== line.id)
                                )}
                                aria-label={`Chọn dòng ${line.description}`}
                              />
                            </td>
                          )}
                          <td className="text-center font-mono text-xs text-[var(--text-secondary)]">
                            {idx + 1}
                          </td>
                          <td>
                            <div className="font-semibold text-sm text-[var(--foreground)]">{line.description}</div>
                            {line.internalNotes && (
                              <div className="text-xs text-[var(--text-secondary)] italic mt-0.5">
                                Lưu ý: {line.internalNotes}
                              </div>
                            )}
                          </td>
                          <td className="text-sm text-[var(--text-secondary)]">
                            <span>{line.unit || "—"}</span>
                            {line.isAutoUnit && (
                              <span
                                className="ml-1 inline-block text-[9px] px-1 py-0.2 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 font-mono font-medium"
                                title="Đơn vị tính tự động kế thừa từ Báo giá"
                              >
                                BG
                              </span>
                            )}
                          </td>
                          <td className="text-right tabular-nums text-sm font-medium">
                            <span>{line.quantity || "—"}</span>
                            {line.isAutoQty && (
                              <span
                                className="ml-1 inline-block text-[9px] px-1 py-0.2 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 font-mono font-medium"
                                title="Số lượng tự động kế thừa từ Báo giá"
                              >
                                BG
                              </span>
                            )}
                          </td>
                          <td className="text-right tabular-nums font-mono text-sm font-medium">
                            {line.cost ? displayMoney(line.cost.net) : "—"}
                          </td>
                          <td className="text-right tabular-nums font-mono text-sm font-bold text-[#587216]">
                            {line.cost ? displayMoney(line.cost.gross) : "—"}
                          </td>

                          {/* CỘT BÁO GIÁ SONG SONG */}
                          <td className="text-right">
                            {match ? (
                              <div>
                                <div className="font-mono text-sm font-semibold text-blue-700 dark:text-blue-300">
                                  {match.line.cost ? displayMoney(match.line.cost.net) : "—"}
                                </div>
                                <div className="text-[11px] text-[var(--text-secondary)]">
                                  Đơn giá: {displayMoney(match.line.unitPrice)}
                                </div>
                                <Badge tone="info" className="text-[10px] mt-0.5">
                                  BG-{match.quotation.number}
                                </Badge>
                              </div>
                            ) : (
                              <div className="text-right">
                                <Badge tone="neutral" className="text-[10px]">
                                  Chi phí riêng
                                </Badge>
                                <div className="text-[10px] text-[var(--text-secondary)] mt-0.5 italic">
                                  Không qua BG
                                </div>
                              </div>
                            )}
                          </td>

                          {/* CỘT LÃI GỘP & MARGIN */}
                          <td className="text-right">
                            {margin ? (
                              <div>
                                <div
                                  className={`font-mono text-sm font-bold ${
                                    !margin.isPositive
                                      ? "text-rose-600"
                                      : margin.percentNum < 30
                                      ? "text-amber-600"
                                      : "text-[#587216]"
                                  }`}
                                >
                                  {margin.marginDisplay}
                                </div>
                                <Badge
                                  tone={!margin.isPositive ? "danger" : margin.percentNum < 30 ? "warning" : "success"}
                                  className="text-[10px] mt-0.5 font-mono"
                                >
                                  {margin.percentDisplay}
                                </Badge>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--text-secondary)] font-mono">—</span>
                            )}
                          </td>

                          <td>
                            {ben ? (
                              <div>
                                <strong className="text-xs font-semibold text-[var(--foreground)] block">
                                  {ben.name}
                                </strong>
                                {ben.account ? (
                                  <span className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1 mt-0.5">
                                    <CreditCard size={11} /> {ben.bank} - {ben.account}
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-amber-600 block">Chưa có STK</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--text-secondary)] italic">
                                Chưa chỉ định NCC
                              </span>
                            )}
                          </td>
                          <td className="text-center">
                            {hasEvidence ? (
                              <Badge tone="success">
                                <Paperclip size={11} className="mr-0.5" />
                                {line.evidenceIds!.length} file BG
                              </Badge>
                            ) : line.evidenceReason ? (
                              <Badge tone="neutral" title={line.evidenceReason}>
                                Có giải trình
                              </Badge>
                            ) : (
                              <Badge tone="warning">Thiếu file BG</Badge>
                            )}
                          </td>
                          <td className="text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 px-2 text-[#587216] hover:bg-[#587216]/10"
                              onClick={() => setEditingLine(line.rawLine ?? line)}
                              title={isEditableDraft ? "Sửa nhanh & đối chiếu song song" : "Xem chi tiết hạng mục"}
                            >
                              <Pencil size={13} className="mr-1" />
                              {isEditableDraft ? "Sửa" : "Xem"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={isEditableDraft ? 13 : 12} className="py-6 text-center text-sm text-[var(--text-secondary)]">
                        {searchFilter || quotationFilter !== "ALL"
                          ? "Không tìm thấy dòng nào khớp với tiêu chí lọc."
                          : "Chưa có dòng hạng mục."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>

              {/* STICKY / BOTTOM TOTALS SUMMARY WITH PARALLEL COMPARISON */}
              {visibleTotals && (
                <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)] pb-2 border-b border-[var(--border)]">
                    <span>
                      Tổng kết <strong>{visibleRevision.lines.length}</strong> hạng mục (
                      {visibleRevision.lines.some(l => !l.cost) ? "Tạm tính các dòng đủ dữ liệu" : "Đã hoàn chỉnh"}
                      ) · <strong className="text-blue-600 dark:text-blue-400">{filterCounts.linked}</strong> dòng đã map Báo giá ·{" "}
                      <strong>{vendorStats.uniqueVendors}</strong> Nhà Cung Cấp phụ trách
                    </span>
                    {activeQuotation && (
                      <span className="flex items-center gap-1.5 font-medium text-[var(--foreground)]">
                        <Layers3 size={13} className="text-[#587216]" />
                        Đối chiếu song song với BG-{activeQuotation.number}: {activeQuotation.title || "Báo giá"}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4">
                    {/* Cụm đối chiếu Báo giá & Margin */}
                    {parallelTotals && (
                      <div className="flex flex-wrap items-center gap-6 pr-6 border-r border-[var(--border)]">
                        <div>
                          <span className="text-xs text-blue-600 dark:text-blue-400 block font-medium">Doanh thu Báo giá (Net)</span>
                          <strong className="text-sm font-mono tabular-nums text-blue-700 dark:text-blue-300">
                            {displayMoney(parallelTotals.totalSellNet)}
                          </strong>
                        </div>

                        <div>
                          <span className="text-xs text-[var(--text-secondary)] block">Lãi gộp dự kiến (VND)</span>
                          <strong
                            className={`text-sm font-mono tabular-nums ${
                              parallelTotals.margin && !parallelTotals.margin.isPositive
                                ? "text-rose-600"
                                : parallelTotals.margin && parallelTotals.margin.percentNum < 30
                                ? "text-amber-600"
                                : "text-[#587216]"
                            }`}
                          >
                            {parallelTotals.margin ? parallelTotals.margin.marginDisplay : "—"}
                          </strong>
                        </div>

                        <div>
                          <span className="text-xs text-[var(--text-secondary)] block">Tỷ suất Margin</span>
                          <strong
                            className={`text-sm font-mono tabular-nums ${
                              parallelTotals.margin && !parallelTotals.margin.isPositive
                                ? "text-rose-600"
                                : parallelTotals.margin && parallelTotals.margin.percentNum < 30
                                ? "text-amber-600"
                                : "text-[#587216]"
                            }`}
                          >
                            {parallelTotals.margin ? parallelTotals.margin.percentDisplay : "—"}
                          </strong>
                        </div>
                      </div>
                    )}

                    {/* Cụm tổng chi phí IC */}
                    <div className="flex flex-wrap items-center gap-6 ml-auto">
                      <div className="text-right">
                        <span className="text-xs text-[var(--text-secondary)] block">Tổng chi phí Net</span>
                        <strong className="text-sm font-mono tabular-nums text-[var(--foreground)]">
                          {displayMoney(visibleTotals.net)}
                        </strong>
                      </div>

                      <div className="text-right">
                        <span className="text-xs text-[var(--text-secondary)] block">Tiền thuế VAT</span>
                        <strong className="text-sm font-mono tabular-nums text-[var(--foreground)]">
                          {displayMoney(visibleTotals.vat)}
                        </strong>
                      </div>

                      <div className="text-right border-l border-[var(--border)] pl-6">
                        <span className="text-xs text-[var(--text-secondary)] block">Tổng gồm VAT (Gross)</span>
                        <strong className="text-lg font-mono tabular-nums text-[#587216]">
                          {displayMoney(visibleTotals.gross)}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Panel>
          )}

          {/* ═══════════ SUB-VIEW 2: LỊCH THANH TOÁN NCC & KẾ HOẠCH TẠM ỨNG ═══════════ */}
          {activeSubView === "schedule" && (
            <VendorPaymentScheduleTable
              finance={finance}
              revision={visibleRevision}
              canCreate={canCreate}
              onOpenAdvance={handleOpenAdvance}
            />
          )}

          {/* ═══════════ SUB-VIEW 3: SO SÁNH & LỊCH SỬ REVISIONS ═══════════ */}
          {activeSubView === "revisions" && (
            <div className="space-y-6">
              {/* CATALOG REVISIONS */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
                    <h3 className="font-semibold text-sm text-[var(--foreground)]">Danh mục các phiên bản IC</h3>
                    <Badge tone="neutral">{revisions.length} phiên bản</Badge>
                  </div>
                  <span className="text-xs text-[var(--text-secondary)]">Bấm phiên bản để xem chi tiết và đối chiếu diff</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[...revisions].reverse().map(rev => {
                    const req = finance.requests.find(q => q.id === rev.requestId);
                    const isSelected = visibleRevision?.id === rev.id;
                    const isEffective = rev.effective;
                    const revTotals = totals(rev.lines.flatMap(l => (l.cost ? [l.cost] : [])));

                    return (
                      <button
                        key={rev.id}
                        type="button"
                        onClick={() => setSelectedRevisionId(rev.id)}
                        className={`text-left p-3.5 rounded-xl border transition-all ${
                          isSelected
                            ? "border-[var(--primary)] bg-[var(--surface)] shadow-md ring-2 ring-[var(--primary)]/20"
                            : "border-[var(--border)] bg-[var(--surface-soft)] hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-base text-[var(--foreground)]">
                              IC-R{rev.number}
                            </span>
                            {isEffective && (
                              <Badge tone="success">Baseline</Badge>
                            )}
                          </div>
                          <Badge
                            tone={
                              req?.state === "APPROVED"
                                ? "success"
                                : req?.state === "REJECTED"
                                ? "danger"
                                : req?.state === "SUBMITTED"
                                ? "info"
                                : req?.state === "RETURNED"
                                ? "warning"
                                : "neutral"
                            }
                          >
                            {STATE[req?.state ?? "DRAFT"]}
                          </Badge>
                        </div>

                        <p className="text-xs text-[var(--text-secondary)] truncate mb-2" title={req?.title ?? "Dự toán chi phí"}>
                          {req?.title ?? "Dự toán chi phí"}
                        </p>

                        <div className="flex items-center justify-between text-xs pt-2 border-t border-[var(--border)]/60">
                          <span className="text-[var(--text-secondary)]">
                            {rev.lines.length} hạng mục
                          </span>
                          <span className="font-semibold tabular-nums text-[var(--foreground)]">
                            {displayMoney(revTotals.gross)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* TWO-AXIS STATUS GRID & MESSAGE */}
              {visibleStatus && visibleRequest && (
                <Panel className="space-y-3">
                  <h4 className="font-semibold text-sm text-[var(--foreground)]">Trạng thái phê duyệt & Hiệu lực ngân sách</h4>
                  <div className="tf-ic-status-grid">
                    <div>
                      <span>Hiệu lực ngân sách</span>
                      <Badge tone={visibleRevision.effective ? "success" : "warning"}>
                        {visibleStatus.budgetLabel}
                      </Badge>
                    </div>
                    <div>
                      <span>Kết quả trình duyệt</span>
                      <Badge
                        tone={
                          visibleRequest.state === "REJECTED"
                            ? "danger"
                            : visibleRequest.state === "APPROVED"
                            ? "success"
                            : "neutral"
                        }
                      >
                        {visibleStatus.approvalLabel}
                      </Badge>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] text-sm flex items-start gap-2.5">
                    <Info size={18} className="text-[#587216] shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="text-[var(--foreground)]">{visibleStatus.message}</p>
                      {visibleStatus.baselineRevisionId && visibleStatus.baselineRevisionId !== visibleRevision.id && (
                        <button
                          type="button"
                          className="tf-link text-xs inline-block"
                          onClick={() => setSelectedRevisionId(visibleStatus.baselineRevisionId!)}
                        >
                          Mở baseline ngân sách IC-R{revisions.find(r => r.id === visibleStatus.baselineRevisionId)?.number}
                        </button>
                      )}
                    </div>
                  </div>
                </Panel>
              )}

              {/* DIFF REVISION SO SÁNH */}
              <Panel className="space-y-3">
                <h4 className="font-semibold text-sm text-[var(--foreground)]">So sánh thay đổi với phiên bản khác</h4>
                <IcRevisionDiff revision={visibleRevision} revisions={revisions} />
              </Panel>

              {/* SNAPSHOTS LỊCH SỬ GỬI DUYỆT */}
              {visibleRevision.submissions && visibleRevision.submissions.length > 0 && (
                <details className="rounded-xl border border-[var(--border)] p-4 bg-[var(--surface)]">
                  <summary className="font-semibold text-sm cursor-pointer text-[var(--foreground)]">
                    Lịch sử các lần gửi duyệt ({visibleRevision.submissions.length} lần)
                  </summary>
                  <div className="mt-3 space-y-4">
                    {visibleRevision.submissions.map(snapshot => (
                      <div key={`${snapshot.requestId}:${snapshot.requestVersion}`} className="border-t border-[var(--border)] pt-3 first:border-0 first:pt-0">
                        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-2">
                          <span className="font-medium text-[var(--foreground)]">
                            Hồ sơ v{snapshot.requestVersion} · {snapshot.title}
                          </span>
                          <span>{snapshot.submittedAt ?? "Thời gian gửi trước đây"}</span>
                        </div>
                        <Table caption="Nội dung IC snapshot đã gửi">
                          <thead>
                            <tr>
                              <th scope="col">Nội dung</th>
                              <th scope="col">Số lượng</th>
                              <th scope="col">Giá vốn & VAT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {snapshot.lines.map((line, lIdx) => (
                              <tr key={line.id ? `${line.id}-${lIdx}` : `snap-line-${lIdx}`}>
                                <td>{line.description}</td>
                                <td>{line.quantity} {line.unit}</td>
                                <td className="tabular-nums">{line.unitPrice} · {line.vatPercent}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* GHI CHÚ NỘI BỘ */}
              {canCreate && visibleRevision.createdBy === user.id && !finance.data.closed && (
                <details className="rounded-xl border border-[var(--border)] p-4 bg-[var(--surface)]">
                  <summary className="font-semibold text-sm cursor-pointer text-[var(--foreground)]">
                    Ghi chú nội bộ cho IC-R{visibleRevision.number}
                  </summary>
                  <div className="mt-3">
                    <ActionForm
                      finance={finance}
                      command="IC_NOTES"
                      requestId={visibleRevision.requestId}
                      label="Lưu ghi chú nội bộ"
                    >
                      <Textarea
                        name="internalNotes"
                        label="Ghi chú nội bộ — không làm thay đổi số liệu dự toán"
                        defaultValue={visibleRevision.internalNotes}
                        hint="Lưu các thông tin khảo sát, liên hệ NCC, lưu ý nội bộ."
                      />
                    </ActionForm>
                  </div>
                </details>
              )}
            </div>
          )}
        </>
      )}

      {/* 7. STANDARDIZED EMPTY STATE (KHÔNG NHÚNG INLINE EDITOR) */}
      {!visibleRevision && (
        <EmptyState
          title="Project chưa có Internal Cost (IC)"
          description={
            latestQuotation
              ? `Đã có Báo giá BG-${latestQuotation.number}. Bạn có thể tạo IC từ báo giá này hoặc soạn thảo độc lập trong Worksheet toàn màn hình.`
              : "Tạo dự toán chi phí đầu tiên, chọn nguồn và nhập chi phí theo từng hạng mục."
          }
          action={
            canCreate && !finance.data.closed ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link className="tf-button-primary text-sm flex items-center gap-1.5" href={pairedHref}>
                  <FileSpreadsheet size={15} aria-hidden="true" />
                  Soạn Báo giá & IC toàn màn hình
                </Link>
                {latestQuotation && (
                  <Link
                    className="tf-button-secondary text-sm flex items-center gap-1.5"
                    href={`/projects/${finance.project.id}/costflow/quotations/${latestQuotation.id}/ic`}
                  >
                    Tạo IC từ BG-{latestQuotation.number}
                  </Link>
                )}
              </div>
            ) : undefined
          }
        />
      )}

      {/* 8. EDIT IC LINE MODAL */}
      {editingLine !== undefined && visibleRevision && (
        <EditIcLineModal
          key={editingLine?.id ?? "new-ic-line"}
          open={editingLine !== undefined}
          onClose={() => setEditingLine(undefined)}
          onSelectLine={setEditingLine}
          line={editingLine}
          revision={visibleRevision}
          request={visibleRequest}
          finance={finance}
          isEditableDraft={isEditableDraft}
          worksheetHref={worksheetHref(visibleRevision)}
        />
      )}

      {visibleRevision && (
        <Dialog
          open={bulkVendorOpen}
          onClose={() => setBulkVendorOpen(false)}
          title={`Gắn NCC cho ${selectedLines.length} dòng`}
          description="NCC đã chọn sẽ thay thế NCC hiện tại trên các dòng được chọn. Các số liệu và Minh chứng khác được giữ nguyên."
        >
          <ActionForm
            finance={{ project: finance.project, version: currentActionVersion }}
            command="SAVE_IC"
            requestId={visibleRevision.requestId}
            label={`Gắn NCC cho ${selectedLines.length} dòng`}
            onSuccess={() => {
              setBulkVendorOpen(false);
              setBulkVendorId("");
              clearBulkSelection();
            }}
          >
            <IcRevisionSaveFields
              revision={visibleRevision}
              title={visibleRequest?.title ?? `IC-R${visibleRevision.number}`}
              lines={bulkVendorLines}
            />
            <Select
              label="Nhà cung cấp áp dụng"
              value={bulkVendorId}
              onChange={event => {
                if (event.target.value === "__CREATE_BENEFICIARY__") {
                  setBulkVendorOpen(false);
                  setNewBeneficiary({ name: "", bank: "", account: "", sourceFileId: "" });
                  return;
                }
                setBulkVendorId(event.target.value);
              }}
              required
            >
              <option value="">Chọn Nhà cung cấp</option>
              {beneficiaryOptions.map(beneficiary => (
                <option key={beneficiary.id} value={beneficiary.id}>{beneficiary.name}</option>
              ))}
              <option value="__CREATE_BENEFICIARY__">＋ Tạo nhà cung cấp mới…</option>
            </Select>
            <p className="tf-ui-help">Chỉ áp dụng cho {selectedLines.length} dòng đã chọn trong IC-R{visibleRevision.number}.</p>
          </ActionForm>
        </Dialog>
      )}

      <Dialog
        open={!!newBeneficiary}
        onClose={() => {
          setNewBeneficiary(null);
          setBulkVendorOpen(true);
        }}
        title="Tạo nhà cung cấp trong danh bạ chung"
        description="Expense/NCC theo JSON project đã chuyển sang chỉ đọc. Tạo NCC tại danh bạ toàn công ty rồi quay lại chọn phiên bản hiện hành."
      >
        <div className="flex items-center justify-between gap-3">
          <p className="tf-ui-help">File chứng minh ngân hàng không bắt buộc; Kế toán xác nhận đúng phiên bản ở lần thanh toán đầu hoặc sau thay đổi.</p>
          <Link href="/suppliers" className="tf-button-primary tf-button-size-md shrink-0">Mở danh bạ NCC</Link>
        </div>
      </Dialog>

      {visibleRevision && (
        <IcEvidencePanel
          finance={finance}
          open={bulkEvidenceOpen}
          onClose={() => setBulkEvidenceOpen(false)}
          targets={selectedLines.map(line => line.description)}
          ids={bulkEvidenceIds}
          reason={bulkEvidenceReason}
          files={evidenceFiles}
          onFiles={file => setEvidenceFiles(current => current.some(item => item.id === file.id) ? current : [...current, file])}
          onChange={(ids, reason) => {
            setBulkEvidenceIds(ids);
            setBulkEvidenceReason(reason);
          }}
          footer={
            <ActionForm
              finance={finance}
              command="SAVE_IC"
              requestId={visibleRevision.requestId}
              label={`Gắn Minh chứng cho ${selectedLines.length} dòng`}
              onSubmit={event => {
                if (bulkEvidenceIds.length === 0 && !bulkEvidenceReason.trim()) event.preventDefault();
              }}
              onSuccess={() => {
                setBulkEvidenceOpen(false);
                setBulkEvidenceIds([]);
                setBulkEvidenceReason("");
                clearBulkSelection();
              }}
            >
              <IcRevisionSaveFields
                revision={visibleRevision}
                title={visibleRequest?.title ?? `IC-R${visibleRevision.number}`}
                lines={bulkEvidenceLines}
              />
              {bulkEvidenceIds.length === 0 && !bulkEvidenceReason.trim() && (
                <Alert tone="warning" title="Chọn ít nhất một Minh chứng hoặc nhập lý do trước khi lưu." />
              )}
            </ActionForm>
          }
        />
      )}
    </div>
  );
}
