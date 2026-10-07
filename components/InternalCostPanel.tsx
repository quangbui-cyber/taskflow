"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import {
  Layers3,
  ShieldCheck,
  Plus,
  ArrowRight,
  TrendingUp,
  CircleDollarSign,
  Wallet,
  History,
  ExternalLink,
  FileSpreadsheet,
  Clock,
  FileCheck2,
  Info,
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import ActionForm from "@/components/CostFlowActionForm";
import { IcLineProvenance } from "@/components/IcLineProvenance";
import IcRevisionDiff, { IcQuotationUpdates } from "@/components/IcRevisionDiff";
import PairedQuotationIcEditor from "@/components/PairedQuotationIcEditor";
import { workingIcRevision } from "@/lib/costflow/budgetRevisions";
import { icStatusProjection, effectiveBaseline } from "@/lib/costflow/icEffectiveness";
import { calculateCost, displayMoney, totals, type CalculatedCost } from "@/lib/costflow/money";
import { completeIcLines } from "@/lib/costflow/budgetDraft";
import { currentPurchaseOrders } from "@/lib/costflow/budgetSources";
import type { IcRevision } from "@/lib/costflow/types";

const STATE: Record<string, string> = {
  DRAFT: "Nháp",
  SUBMITTED: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  RETURNED: "Đã trả",
  REJECTED: "Từ chối",
  WITHDRAWN: "Đã rút",
  CANCELLED: "Đã hủy"
};

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
  working?: ReturnType<typeof workingIcRevision>;
  workingError?: string;
  onOpenApproval: (requestId: string) => void;
};

export default function InternalCostPanel({
  finance,
  user,
  canCreate,
  working,
  workingError,
  onOpenApproval,
}: Props) {
  const revisions = finance.data.revisions;
  const quotations = finance.data.quotations ?? [];
  const latestQuotation = quotations.at(-1);

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

  // Inline draft for latest quotation
  const inlineIcDraft = useMemo(() => {
    if (!latestQuotation) return undefined;
    return (finance.data.quotationDrafts ?? [])
      .filter(
        draft =>
          draft.createdBy === user.id &&
          draft.workspaceMode === "ic" &&
          (draft.sourceQuotationId === latestQuotation.id || draft.latestQuotationId === latestQuotation.id)
      )
      .at(-1);
  }, [finance.data.quotationDrafts, latestQuotation, user.id]);

  // Users map for displaying names
  const users = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  // Check if current user can edit visible revision
  const isEditableDraft = Boolean(
    visibleRevision &&
      visibleRevision.createdBy === user.id &&
      visibleRequest?.state === "DRAFT" &&
      canCreate &&
      !finance.data.closed
  );

  // Calculate totals for visible revision
  const visibleTotals = useMemo(() => {
    if (!visibleRevision) return null;
    const validCosts = visibleRevision.lines.flatMap(l => (l.cost ? [l.cost] : []));
    return totals(validCosts);
  }, [visibleRevision]);

  // Calculate totals for effective baseline
  const effectiveTotals = useMemo(() => {
    if (!effective) return null;
    const completeLines = completeIcLines(effective.lines);
    const validCosts = completeLines.flatMap(l => (l.cost ? [l.cost] : []));
    return totals(validCosts);
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

  // Filtered lines for display
  const filteredLines = useMemo(() => {
    if (!visibleRevision) return [];
    if (!searchFilter.trim()) return visibleRevision.lines;
    const q = searchFilter.toLowerCase().trim();
    return visibleRevision.lines.filter(
      l =>
        l.description.toLowerCase().includes(q) ||
        l.unit.toLowerCase().includes(q) ||
        (l.basis && l.basis.toLowerCase().includes(q))
    );
  }, [visibleRevision, searchFilter]);

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

  return (
    <div className="space-y-6">
      {/* 1. TOP TOOLBAR & QUICK ACTIONS */}
      <div className="tf-module-toolbar flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)] flex items-center gap-2">
            <Layers3 size={22} className="text-[#587216]" aria-hidden="true" />
            Internal Cost & Ngân sách dự toán
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Quản lý dự toán chi phí nội bộ, phân bổ hạn mức, phê duyệt Quản lý/CEO và lịch sử revision.
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

            <Link className="tf-button-secondary text-sm flex items-center gap-1.5" href={working || effective ? worksheetHref(working ?? effective!) : pairedHref}>
              <Plus size={15} className="mr-1" aria-hidden="true" />
              Tạo IC độc lập
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

      {/* 4. HERO CARD: ACTIVE BASELINE NGÂN SÁCH */}
      <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-[var(--primary)] p-2.5 text-[var(--foreground)] shadow-sm">
              <ShieldCheck size={24} aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--primary)]">
                  Baseline Ngân Sách Hiệu Lực
                </span>
                {effective ? (
                  <Badge tone="success">Đang có hiệu lực</Badge>
                ) : (
                  <Badge tone="warning">Chưa thiết lập</Badge>
                )}
              </div>
              <h3 className="mt-0.5 text-lg font-bold text-[var(--foreground)]">
                {effective
                  ? `IC-R${effective.number} · Dự toán ngân sách dự án`
                  : "Dự án chưa có Baseline IC hiệu lực"}
              </h3>
            </div>
          </div>

          {effective && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedRevisionId(effective.id)}
              >
                Xem chi tiết IC-R{effective.number}
              </Button>
              {canCreate && !finance.data.closed && (
                <Link className="tf-button-primary text-sm flex items-center gap-1" href={worksheetHref(effective)}>
                  <Plus size={14} className="mr-1" aria-hidden="true" />
                  Tạo Revision điều chỉnh
                </Link>
              )}
            </div>
          )}
        </div>

        {effective ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <span className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                <Wallet size={13} aria-hidden="true" /> Chi phí dự toán Net
              </span>
              <p className="mt-1 text-lg font-bold tabular-nums text-[var(--foreground)]">
                {effectiveTotals ? displayMoney(effectiveTotals.net) : "—"}
              </p>
              <span className="text-[11px] text-[var(--text-secondary)]">Chưa bao gồm VAT</span>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <span className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                <CircleDollarSign size={13} aria-hidden="true" /> Tổng gồm VAT (Gross)
              </span>
              <p className="mt-1 text-lg font-bold tabular-nums text-[var(--foreground)]">
                {effectiveTotals ? displayMoney(effectiveTotals.gross) : "—"}
              </p>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {effective.lines.length} hạng mục chi phí
              </span>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <span className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                <FileCheck2 size={13} aria-hidden="true" /> Doanh thu đối ứng
              </span>
              <p className="mt-1 text-lg font-bold tabular-nums text-[var(--foreground)]">
                {revenueTotal > 0 ? displayMoney(Math.round(revenueTotal).toString()) : "Chưa có PO/BG"}
              </p>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {currentPurchaseOrders(finance.data.pos).length > 0
                  ? `${currentPurchaseOrders(finance.data.pos).length} PO liên kết`
                  : latestQuotation
                  ? `Từ BG-${latestQuotation.number}`
                  : "Chưa ghi nhận"}
              </span>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <span className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                <TrendingUp size={13} aria-hidden="true" /> Dự toán Margin %
              </span>
              <p className="mt-1 text-lg font-bold tabular-nums text-[var(--success)]">
                {effectiveMargin ? `${effectiveMargin.percent}%` : "—"}
              </p>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {effectiveMargin ? `Lợi nhuận ~ ${displayMoney(effectiveMargin.amount)}` : "Cần doanh thu"}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm text-[var(--text-secondary)]">
            <p className="max-w-xl">
              Internal Cost bắt đầu có hiệu lực ngân sách ngay sau khi Quản lý phê duyệt (bước 1 của quy trình trình duyệt).
              Khi chưa có IC hiệu lực, dự án chưa thể tạo phát sinh Actual Cost mới dựa trên IC.
            </p>
            {canCreate && !finance.data.closed && (
              <Link className="tf-button-primary text-sm flex items-center gap-1" href={pairedHref}>
                <Plus size={15} className="mr-1" aria-hidden="true" />
                Lập dự toán đầu tiên
              </Link>
            )}
          </div>
        )}
      </div>

      {/* 5. REVISION CATALOG & NAVIGATOR */}
      {revisions.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
              <h3 className="font-semibold text-sm text-[var(--foreground)]">Danh mục các phiên bản IC</h3>
              <Badge tone="neutral">{revisions.length} phiên bản</Badge>
            </div>
            <span className="text-xs text-[var(--text-secondary)]">Chọn phiên bản để kiểm tra chi tiết & so sánh diff</span>
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
                        <Badge tone="success">Baseline hiệu lực</Badge>
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

                  <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] mt-1.5">
                    <span>{users.get(rev.createdBy) ?? "Người lập"}</span>
                    <span>{req?.createdAt ? new Date(req.createdAt).toLocaleDateString("vi-VN") : "Bản thảo"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          title="Project chưa có Internal Cost"
          description="Khởi tạo IC đầu tiên bằng cách nhập độc lập hoặc chuyển đổi hạng mục từ báo giá khách hàng."
        />
      )}

      {/* 6. CHI TIẾT REVISION ĐANG CHỌN (ACTIVE REVISION WORKSPACE) */}
      {visibleRevision && visibleRequest && (
        <Panel id={`ic-revision-${visibleRevision.id}`} className="space-y-5">
          {/* A. REVISION HEADER & METADATA */}
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[var(--border)]">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge tone="neutral">Phiên bản {visibleRevision.number}</Badge>
                {visibleRevision.effective && <Badge tone="success">Baseline ngân sách</Badge>}
                <Badge
                  tone={
                    visibleRequest.state === "APPROVED"
                      ? "success"
                      : visibleRequest.state === "REJECTED"
                      ? "danger"
                      : visibleRequest.state === "SUBMITTED"
                      ? "info"
                      : "neutral"
                  }
                >
                  {STATE[visibleRequest.state]}
                </Badge>
              </div>

              <h3 className="text-xl font-bold text-[var(--foreground)]">
                IC-R{visibleRevision.number} · {visibleRequest.title || "Dự toán chi phí"}
                {visibleRequest.state !== "DRAFT" ? " (Chỉ đọc)" : ""}
              </h3>

              {visibleRevision.parentRevisionId && (
                <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
                  <span>Kế thừa từ IC-R{revisions.find(r => r.id === visibleRevision.parentRevisionId)?.number}</span>
                  {visibleRevision.lineageReason && <span>· {visibleRevision.lineageReason}</span>}
                </p>
              )}
            </div>

            {/* Quick Actions for Selected Revision */}
            <div className="flex flex-wrap items-center gap-2">
              {isEditableDraft ? (
                <Link className="tf-button-primary text-sm flex items-center gap-1" href={worksheetHref(visibleRevision)}>
                  <FileSpreadsheet size={14} aria-hidden="true" />
                  Tiếp tục chỉnh IC-R{visibleRevision.number}
                </Link>
              ) : (
                canCreate &&
                !finance.data.closed && (
                  <Link className="tf-button-secondary text-sm flex items-center gap-1" href={worksheetHref(visibleRevision)}>
                    <Plus size={14} className="mr-1" aria-hidden="true" />
                    Tạo revision từ IC-R{visibleRevision.number}
                  </Link>
                )
              )}

              {/* Deep link to the centralized approval timeline. */}
              <button
                type="button"
                className="tf-button-secondary text-sm flex items-center gap-1"
                onClick={() => onOpenApproval(visibleRequest.id)}
              >
                <span>Hồ sơ trình duyệt</span>
                <ExternalLink size={13} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* B. TWO-AXIS STATUS GRID & MESSAGE */}
          {visibleStatus && (
            <div className="space-y-3">
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
            </div>
          )}

          {/* C. QUOTATION UPDATES NOTIFICATION (IF NEWER QUOTE EXISTS) */}
          <IcQuotationUpdates
            finance={finance}
            revision={visibleRevision}
            editable={isEditableDraft}
          />

          {/* D. SEARCH & TABLE OF COST ITEMS */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold text-base text-[var(--foreground)]">
                  Các dòng hạng mục IC-R{visibleRevision.number}
                </h4>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Đơn vị tiền tệ: VND · Đơn giá gốc & Giá nhập (Net/Gross) · Thuế VAT rõ ràng
                </p>
              </div>

              <div className="w-full sm:w-64">
                <Input
                  label="Tìm kiếm nhanh"
                  placeholder="Lọc hạng mục, ĐVT..."
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                />
              </div>
            </div>

            <Table caption={`Các dòng chi phí của IC revision ${visibleRevision.number}`}>
              <thead>
                <tr>
                  <th scope="col" className="w-12 text-center">#</th>
                  <th scope="col">Nội dung chi phí & Căn cứ</th>
                  <th scope="col" className="w-24">ĐVT</th>
                  <th scope="col" className="w-20 text-right">SL</th>
                  <th scope="col" className="w-32 text-right">Đơn giá gốc</th>
                  <th scope="col" className="w-20 text-center">VAT</th>
                  <th scope="col" className="w-36 text-right">Chi phí Net</th>
                  <th scope="col" className="w-36 text-right">Chi phí Gross</th>
                  <th scope="col" className="w-32">Nguồn báo giá</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.length > 0 ? (
                  filteredLines.map((line, idx) => (
                    <tr key={line.id ? `${line.id}-${idx}` : `line-${idx}`}>
                      <td className="text-center font-mono text-xs text-[var(--text-secondary)]">
                        {idx + 1}
                      </td>
                      <td>
                        <div className="font-medium text-[var(--foreground)]">{line.description}</div>
                        <IcLineProvenance finance={finance} line={line} />
                      </td>
                      <td className="text-sm text-[var(--text-secondary)]">{line.unit}</td>
                      <td className="text-right tabular-nums text-sm">{line.quantity}</td>
                      <td className="text-right tabular-nums text-sm">
                        <span>{line.unitPrice}</span>{" "}
                        <span className="text-[11px] text-[var(--text-secondary)]">({line.basis})</span>
                      </td>
                      <td className="text-center tabular-nums text-sm">
                        {line.vatPercent ? `${line.vatPercent}%` : "0%"}
                      </td>
                      <td className="text-right tabular-nums font-mono text-sm font-medium">
                        {line.cost ? displayMoney(line.cost.net) : "—"}
                      </td>
                      <td className="text-right tabular-nums font-mono text-sm font-semibold">
                        {line.cost ? displayMoney(line.cost.gross) : "—"}
                      </td>
                      <td>
                        {line.quotationId ? (
                          <Link
                            className="tf-link text-xs flex items-center gap-1"
                            href={`/projects/${finance.project.id}/costflow/quotations/${line.quotationId}/print`}
                          >
                            <span>BG-{finance.data.quotations?.find(q => q.id === line.quotationId)?.number}</span>
                          </Link>
                        ) : (
                          <span className="text-xs text-[var(--text-secondary)]">Nhập trực tiếp</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-sm text-[var(--text-secondary)]">
                      {searchFilter ? "Không tìm thấy dòng nào khớp với từ khóa." : "Chưa có dòng hạng mục."}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>

            {/* STICKY / BOTTOM TOTALS SUMMARY */}
            {visibleTotals && (
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs text-[var(--text-secondary)]">
                  Tổng kết {visibleRevision.lines.length} hạng mục (
                  {visibleRevision.lines.some(l => !l.cost) ? "Tạm tính các dòng đủ dữ liệu" : "Đã hoàn chỉnh"}
                  )
                </div>

                <div className="flex flex-wrap items-center gap-6">
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
                    <strong className="text-lg font-mono tabular-nums text-[#587216] dark:text-[#a3c83a]">
                      {displayMoney(visibleTotals.gross)}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* F. DIFF SO SÁNH VỚI BASELINE HOẶC REVISION KHÁC */}
          <div className="pt-2">
            <IcRevisionDiff revision={visibleRevision} revisions={revisions} />
          </div>

          {/* G. SNAPSHOTS LỊCH SỬ CÁC LẦN GỬI DUYỆT */}
          {visibleRevision.submissions && visibleRevision.submissions.length > 0 && (
            <details className="mt-4 rounded-xl border border-[var(--border)] p-4 bg-[var(--surface)]">
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

          {/* H. GHI CHÚ NỘI BỘ (INTERNAL NOTES) */}
          {canCreate && visibleRevision.createdBy === user.id && !finance.data.closed && (
            <details className="mt-2 rounded-xl border border-[var(--border)] p-4 bg-[var(--surface)]">
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
        </Panel>
      )}

      {/* 7. FALLBACK INLINE WORKSHEET IF NO REVISIONS BUT HAS QUOTATION */}
      {!visibleRevision && latestQuotation && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-semibold text-sm text-[var(--foreground)]">
                Soạn thảo IC trực tiếp từ Báo giá BG-{latestQuotation.number}
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Nhập giá vốn khảo sát cho từng hạng mục để hoàn thiện dự toán nội bộ
              </p>
            </div>
            <Link
              className="tf-button-primary text-xs"
              href={`/projects/${finance.project.id}/costflow/quotations/${latestQuotation.id}/ic`}
            >
              Mở Worksheet toàn màn hình
              <ArrowRight size={13} className="ml-1" aria-hidden="true" />
            </Link>
          </div>

          <PairedQuotationIcEditor
            key={`inline-ic:${latestQuotation.id}:${inlineIcDraft?.id ?? "new"}`}
            finance={finance}
            mode="ic"
            embedded
            source={latestQuotation}
            initial={inlineIcDraft}
          />
        </div>
      )}
    </div>
  );
}
