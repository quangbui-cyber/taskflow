"use client";

import { Fragment, startTransition, useActionState, useCallback, useMemo, useRef, useState } from "react";
import { actualCostAction, type ActualCostActionState } from "@/app/actions/costflow";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Alert, Badge } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import { recipientDisplayName } from "@/lib/costflow/labels";
import type { ActualCostReadLine } from "@/lib/costflow/actualCostReadModel";
import ActualCostPastePreview from "./ActualCostPastePreview";
import { CheckCircle2, Plus, Search, Edit3 } from "lucide-react";

type Props = {
  finance: Finance;
  onSelectLine: (line: ActualCostReadLine) => void;
  onAddNew: () => void;
  canEdit: boolean;
  canReview: boolean;
  currentUserId: string;
};

const signed = (value: string) => value === "0" ? displayMoney(value) : `${value.startsWith("-") ? "" : "+"}${displayMoney(value)}`;

export default function ActualCostSheetView({
  finance,
  onSelectLine,
  onAddNew,
  canEdit,
  canReview,
  currentUserId,
}: Props) {
  const actualCosts = finance.actualCosts;
  const lines = useMemo(() => actualCosts?.lines ?? [], [actualCosts?.lines]);
  const comparisons = useMemo(() => actualCosts?.comparisons ?? [], [actualCosts?.comparisons]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "UNREVIEWED" | "REVIEWED" | "MISSING_EVIDENCE" | "OVER_BUDGET" | "UNBUDGETED">("ALL");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);

  const users = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);
  const recipient = useCallback((key: string) => recipientDisplayName(key, users, finance.data.beneficiaries), [users, finance.data.beneficiaries]);

  const [bulkState, bulkAction, bulkPending] = useActionState(actualCostAction, {} as ActualCostActionState);
  const [restoreState, restoreAction, restorePending] = useActionState(actualCostAction, {} as ActualCostActionState);

  const alertCounts = useMemo(() => ({
    unreviewed: lines.filter(line => line.internalStatus !== "ACCOUNT_REVIEWED").length,
    missingEvidence: lines.filter(line => line.missingEvidenceWarnings.length > 0).length,
    overBudget: lines.filter(line => comparisons.some(item => item.status === "OVER_BUDGET" && item.actualLineIds.includes(line.id))).length,
    unbudgeted: lines.filter(line => line.sourceKind === "UNBUDGETED").length,
  }), [lines, comparisons]);

  // Filtered lines
  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lines.filter(line => {
      if (filter === "UNREVIEWED" && line.internalStatus === "ACCOUNT_REVIEWED") return false;
      if (filter === "REVIEWED" && line.internalStatus !== "ACCOUNT_REVIEWED") return false;
      if (filter === "MISSING_EVIDENCE" && line.missingEvidenceWarnings.length === 0) return false;
      if (filter === "UNBUDGETED" && line.sourceKind !== "UNBUDGETED") return false;
      if (filter === "OVER_BUDGET") {
        const comp = comparisons.find(c => c.actualLineIds.includes(line.id));
        if (comp?.status !== "OVER_BUDGET") return false;
      }
      if (q) {
        const text = `${line.description} ${recipient(line.recipientKey)} ${line.unit ?? ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [lines, filter, search, comparisons, recipient]);

  // Group lines by IC line or Unbudgeted
  const grouped = useMemo(() => {
    const icGroups: { key: string; title: string; lines: ActualCostReadLine[] }[] = [];
    const unbudgetedLines: ActualCostReadLine[] = [];

    const map = new Map<string, ActualCostReadLine[]>();
    for (const l of filteredLines) {
      if (l.sourceKind === "UNBUDGETED") {
        unbudgetedLines.push(l);
      } else {
        const groupKey = l.icLineId ?? "unknown";
        if (!map.has(groupKey)) map.set(groupKey, []);
        map.get(groupKey)!.push(l);
      }
    }

    const icLines = finance.data.revisions.find(revision => revision.effective)?.lines ?? [];
    for (const [key, groupLines] of map.entries()) {
      const title = icLines.find(line => line.id === key)?.description ?? "Hạng mục IC chưa xác định";
      icGroups.push({ key, title, lines: groupLines });
    }

    return { icGroups, unbudgetedLines };
  }, [filteredLines, finance.data.revisions]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLines.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLines.map(l => l.id)));
    }
  };

  const handleMarkAllReviewed = () => {
    const fd = new FormData();
    fd.set("projectId", finance.project.id);
    fd.set("actualCostCommand", "UPDATE_LINES_STATUS");
    for (const id of selectedIds) fd.append("lineId", id);
    fd.set("internalStatus", "ACCOUNT_REVIEWED");
    fd.set("sheetRevisionId", finance.actualCosts?.sheet?.revisionId ?? "");
    fd.set("sheetMutationVersion", String(finance.actualCosts?.sheet?.mutationVersion ?? 0));
    startTransition(() => bulkAction(fd));
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 max-w-xl">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm theo nội dung chi, người nhận, NCC..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            />
          </div>

          <select
            value={filter}
            onChange={e => setFilter(e.target.value as typeof filter)}
            className="py-1.5 px-3 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
          >
            <option value="ALL">Tất cả ({lines.length} dòng)</option>
            <option value="UNREVIEWED">Chờ Account kiểm tra</option>
            <option value="REVIEWED">Account đã kiểm tra</option>
            <option value="MISSING_EVIDENCE">Cần bổ sung chứng từ</option>
            <option value="OVER_BUDGET">Vượt ngân sách IC</option>
            <option value="UNBUDGETED">Phát sinh ngoài IC</option>
          </select>
        </div>

        {canEdit && <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setShowPaste(value => !value)} className="min-h-11">Dán từ Excel</Button>
          <Button size="sm" onClick={onAddNew} className="min-h-11">
            <Plus size={14} className="mr-1" />
            Thêm khoản chi
          </Button>
        </div>}
      </div>

      {lines.length > 0 && Object.values(alertCounts).some(Boolean) && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-xs" role="group" aria-label="Các khoản cần xem lại">
        <span className="font-semibold mr-1">Cần xem lại:</span>
        {alertCounts.unreviewed > 0 && <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setFilter("UNREVIEWED")}>{alertCounts.unreviewed} chờ Account kiểm tra</Button>}
        {alertCounts.missingEvidence > 0 && <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setFilter("MISSING_EVIDENCE")}>{alertCounts.missingEvidence} thiếu chứng từ</Button>}
        {alertCounts.overBudget > 0 && <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setFilter("OVER_BUDGET")}>{alertCounts.overBudget} vượt ngân sách IC</Button>}
        {alertCounts.unbudgeted > 0 && <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setFilter("UNBUDGETED")}>{alertCounts.unbudgeted} phát sinh ngoài IC</Button>}
        {filter !== "ALL" && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setFilter("ALL")}>Xem toàn bộ</Button>}
      </div>}

      {showPaste && canEdit && <ActualCostPastePreview finance={finance} onClose={() => setShowPaste(false)} />}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--primary-soft)] border border-[var(--primary)]/30 text-xs">
          <span className="font-semibold text-[var(--primary)]">
            Đã chọn {selectedIds.size} / {filteredLines.length} dòng
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setSelectedIds(new Set())}>
              Bỏ chọn
            </Button>
            {canReview && lines.some(line => selectedIds.has(line.id) && line.internalStatus !== "ACCOUNT_REVIEWED") && (
              <Button size="sm" onClick={handleMarkAllReviewed} loading={bulkPending}>
                <CheckCircle2 size={14} className="mr-1" />
                Đánh dấu &quot;Account đã kiểm tra&quot;
              </Button>
            )}
          </div>
        </div>
      )}
      {bulkState.error && <Alert tone="danger" title={bulkState.error} />}
      {bulkState.success && <Alert tone="success" title={bulkState.success} />}

      {/* Main Table */}
      {canEdit && (actualCosts?.removedLines?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-[var(--border)] p-3 space-y-2">
          <h3 className="text-sm font-semibold">Khoản đã loại khỏi bản nháp</h3>
          {actualCosts!.removedLines.map(line => (
            <div key={line.id} className="flex items-center justify-between gap-3 text-xs">
              <span>{line.description}</span>
              <Button type="button" size="sm" variant="secondary" loading={restorePending} onClick={() => {
                const form = new FormData();
                form.set("projectId", finance.project.id);
                form.set("actualCostCommand", "DELETE_LINE");
                form.set("restore", "true");
                form.set("lineId", line.id);
                form.set("sheetRevisionId", actualCosts?.sheet?.revisionId ?? "");
                form.set("sheetMutationVersion", String(actualCosts?.sheet?.mutationVersion ?? 0));
                startTransition(() => restoreAction(form));
              }}>Khôi phục khoản chi</Button>
            </div>
          ))}
          {restoreState.error && <Alert tone="danger" title={restoreState.error} />}
        </div>
      )}
      {lines.length === 0 ? (
        <Alert title="Bảng AC chưa có dòng chi phí">
          Hãy bấm &quot;Thêm khoản chi&quot; để ghi nhận chi phí thực tế cho dự án.
        </Alert>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-xs">
          <div className="md:hidden p-3 space-y-4" aria-label="Các khoản thực chi">
            {[
              ...grouped.icGroups.map(group => ({ key: group.key, title: group.title, items: group.lines })),
              ...(grouped.unbudgetedLines.length > 0 ? [{ key: "unbudgeted", title: "Phát sinh ngoài IC", items: grouped.unbudgetedLines }] : []),
            ].map(group => (
              <section key={group.key} className="space-y-2" aria-label={group.title}>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">{group.title} <span className="font-normal text-[var(--text-secondary)]">({group.items.length})</span></h3>
                {group.items.map(line => (
                  <article key={line.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-3 min-w-0">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(line.id)}
                        onChange={() => toggleSelect(line.id)}
                        aria-label={`Chọn ${line.description}`}
                        className="h-5 w-5 mt-1 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold break-words">{line.description}</h4>
                        <p className="text-xs text-[var(--text-secondary)] break-words">{recipient(line.recipientKey)}</p>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div><dt className="text-[var(--text-secondary)]">SL × Ngày · Đơn vị</dt><dd>{line.quantity ?? "—"} × {line.days ?? "—"} {line.unit ?? ""}</dd></div>
                      <div><dt className="text-[var(--text-secondary)]">Đơn giá</dt><dd>{line.unitPrice ? displayMoney(line.unitPrice) : "—"}</dd></div>
                      <div><dt className="text-[var(--text-secondary)]">Thành tiền</dt><dd className="font-semibold">{displayMoney(line.amount)}</dd></div>
                      <div><dt className="text-[var(--text-secondary)]">Chứng từ</dt><dd>{line.evidence.length} file</dd></div>
                    </dl>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={line.internalStatus === "ACCOUNT_REVIEWED" ? "success" : line.internalStatus === "NEEDS_INFO" ? "warning" : "info"}>
                        {line.internalStatus === "ACCOUNT_REVIEWED" ? "Account đã kiểm tra" : line.internalStatus === "NEEDS_INFO" ? "Cần bổ sung" : "Chờ Account kiểm tra"}
                      </Badge>
                      {line.missingEvidenceWarnings.length > 0 && <Badge tone="warning">Cần bổ sung chứng từ</Badge>}
                    </div>
                    <Button type="button" size="sm" variant="secondary" onClick={() => onSelectLine(line)} className="min-h-11 w-full">Xem và sửa khoản chi</Button>
                  </article>
                ))}
              </section>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto border border-[var(--border)] rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--primary)] text-[var(--color-brand-900)] font-semibold [&>th:first-child]:rounded-tl-[11px] [&>th:last-child]:rounded-tr-[11px]">
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredLines.length && filteredLines.length > 0}
                      onChange={toggleSelectAll}
                      aria-label="Chọn tất cả"
                    />
                  </th>
                  <th className="p-3 min-w-[220px]">Hạng mục & Nội dung thực chi</th>
                  <th className="p-3 min-w-[160px]">Người nhận / NCC</th>
                  <th className="p-3 text-right">SL × Ngày</th>
                  <th className="p-3 text-center">ĐVT</th>
                  <th className="p-3 text-right">Đơn giá (VND)</th>
                  <th className="p-3 text-right min-w-[120px]">Thành tiền (GROSS)</th>
                  <th className="p-3 text-right">Chênh lệch IC</th>
                  <th className="p-3 min-w-[130px]">Nguồn tiền</th>
                  <th className="p-3 text-center">Chứng từ</th>
                  <th className="p-3 min-w-[140px]">Trạng thái Account</th>
                  <th className="p-3 text-center w-24">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {/* 1. IC Grouped Rows */}
                {grouped.icGroups.map(group => (
                  <Fragment key={group.key}>
                    {/* Group Header Row */}
                    <tr className="bg-[var(--surface-soft)]/60 font-semibold text-[var(--foreground)] border-t-2 border-[var(--border)]">
                      <td colSpan={12} className="p-2.5 px-3">
                        <span className="text-[var(--primary)] font-bold mr-2">●</span>
                        <span>{group.title}</span>
                        <span className="text-[var(--text-secondary)] text-[11px] font-normal ml-2">
                          ({group.lines.length} lần phát sinh)
                        </span>
                      </td>
                    </tr>

                    {/* Occurrence Rows */}
                    {group.lines.map(l => {
                      const comp = comparisons.find(c => c.actualLineIds.includes(l.id));
                      const isSelected = selectedIds.has(l.id);
                      return (
                        <Fragment key={l.id}>
                        <tr
                          key={l.id}
                          className={`hover:bg-[var(--surface-soft)] transition-colors cursor-pointer ${
                            isSelected ? "bg-[var(--primary-soft)]/30" : ""
                          }`}
                          onClick={() => onSelectLine(l)}
                        >
                          <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(l.id)}
                              aria-label={`Chọn ${l.description}`}
                            />
                          </td>
                          <td className="p-3">
                            <span className="font-semibold text-[var(--foreground)] block">
                              {l.description}
                            </span>
                            <span className="text-[11px] text-[var(--text-secondary)]">
                              {actualCosts?.sheet?.revisionId ? `Phiên bản AC-R${actualCosts.sheet.version}` : "Bản nháp chưa gửi"}
                            </span>
                          </td>
                          <td className="p-3 text-[var(--foreground)]">
                            {recipient(l.recipientKey)}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {l.quantity ?? "—"} × {l.days ?? "—"}
                          </td>
                          <td className="p-3 text-center text-[var(--text-secondary)]">
                            {l.unit || "—"}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {l.unitPrice ? displayMoney(l.unitPrice) : "—"}
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-[var(--foreground)]">
                            {displayMoney(l.amount)}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {comp ? (
                              <span className={comp.status === "OVER_BUDGET" ? "text-[var(--danger)] font-bold" : "text-[var(--success)]"}>
                                {signed(comp.variance.gross)}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="p-3">
                            <Badge tone="neutral">
                              {l.fundingSource === "EMPLOYEE_ADVANCE" ? "Tạm ứng nhân sự" :
                               l.fundingSource === "EMPLOYEE_OUT_OF_POCKET" ? "Nhân sự tự chi" :
                               l.fundingSource === "VENDOR_ADVANCE" ? "Tạm ứng NCC" :
                               l.fundingSource === "VENDOR_PAYMENT" ? "Thanh toán NCC" : (l.fundingSource ?? "—")}
                            </Badge>
                          </td>
                          <td className="p-3 text-center">
                            <Badge tone={l.missingEvidenceWarnings.length > 0 ? "warning" : "success"}>
                              {l.evidence.length} file
                            </Badge>
                          </td>
                          <td className="p-3">
                            <Badge tone={l.internalStatus === "ACCOUNT_REVIEWED" ? "success" : l.internalStatus === "NEEDS_INFO" ? "warning" : "info"}>
                              {l.internalStatus === "ACCOUNT_REVIEWED" ? "Account đã kiểm tra" :
                               l.internalStatus === "NEEDS_INFO" ? "Cần bổ sung" :
                               l.internalStatus === "IN_PROGRESS" ? "Đang nhập" : "Chờ Account kiểm tra"}
                            </Badge>
                          </td>
                          <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                            {canEdit && (canReview || l.createdById === currentUserId) && (
                              <Button size="sm" variant="secondary" onClick={() => setEditingId(l.id)} className="text-xs h-7 px-2 mr-1">
                                Sửa nhanh
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => onSelectLine(l)}
                              className="text-xs h-7 px-2"
                            >
                              <Edit3 size={12} className="mr-1" />
                              Chi tiết
                            </Button>
                          </td>
                        </tr>
                        {editingId === l.id && <QuickEditRow line={l} finance={finance} onCancel={() => setEditingId(null)} />}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}

                {/* 2. Unbudgeted Section */}
                {grouped.unbudgetedLines.length > 0 && (
                  <Fragment>
                    <tr className="bg-[var(--warning-soft)]/50 font-semibold text-[var(--warning)] border-t-2 border-[var(--warning)]">
                      <td colSpan={12} className="p-2.5 px-3">
                        <span className="font-bold mr-2">▲</span>
                        <span>[Phát sinh ngoài IC] · Không có dự toán ban đầu</span>
                        <span className="text-[var(--text-secondary)] text-[11px] font-normal ml-2">
                          ({grouped.unbudgetedLines.length} khoản chi)
                        </span>
                      </td>
                    </tr>

                    {grouped.unbudgetedLines.map(l => {
                      const isSelected = selectedIds.has(l.id);
                      return (
                        <Fragment key={l.id}>
                        <tr
                          key={l.id}
                          className={`hover:bg-[var(--surface-soft)] transition-colors cursor-pointer ${
                            isSelected ? "bg-[var(--primary-soft)]/30" : ""
                          }`}
                          onClick={() => onSelectLine(l)}
                        >
                          <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(l.id)}
                              aria-label={`Chọn ${l.description}`}
                            />
                          </td>
                          <td className="p-3">
                            <span className="font-semibold text-[var(--foreground)] block">
                              {l.description}
                            </span>
                            <span className="text-[11px] text-[var(--warning)] font-medium">
                              [Ngoài IC] {l.billable ? "· Thu thêm từ khách" : "· Nội bộ"}
                            </span>
                          </td>
                          <td className="p-3 text-[var(--foreground)]">
                            {recipient(l.recipientKey)}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {l.quantity ?? "—"} × {l.days ?? "—"}
                          </td>
                          <td className="p-3 text-center text-[var(--text-secondary)]">
                            {l.unit || "—"}
                          </td>
                          <td className="p-3 text-right font-mono">
                            {l.unitPrice ? displayMoney(l.unitPrice) : "—"}
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-[var(--foreground)]">
                            {displayMoney(l.amount)}
                          </td>
                          <td className="p-3 text-right text-[var(--text-secondary)]">
                            +100% ngoài IC
                          </td>
                          <td className="p-3">
                            <Badge tone="neutral">
                              {l.fundingSource === "EMPLOYEE_ADVANCE" ? "Tạm ứng nhân sự" :
                               l.fundingSource === "EMPLOYEE_OUT_OF_POCKET" ? "Nhân sự tự chi" :
                               l.fundingSource === "VENDOR_ADVANCE" ? "Tạm ứng NCC" :
                               l.fundingSource === "VENDOR_PAYMENT" ? "Thanh toán NCC" : (l.fundingSource ?? "—")}
                            </Badge>
                          </td>
                          <td className="p-3 text-center">
                            <Badge tone={l.missingEvidenceWarnings.length > 0 ? "warning" : "success"}>
                              {l.evidence.length} file
                            </Badge>
                          </td>
                          <td className="p-3">
                            <Badge tone={l.internalStatus === "ACCOUNT_REVIEWED" ? "success" : l.internalStatus === "NEEDS_INFO" ? "warning" : "info"}>
                              {l.internalStatus === "ACCOUNT_REVIEWED" ? "Account đã kiểm tra" :
                               l.internalStatus === "NEEDS_INFO" ? "Cần bổ sung" :
                               l.internalStatus === "IN_PROGRESS" ? "Đang nhập" : "Chờ Account kiểm tra"}
                            </Badge>
                          </td>
                          <td className="p-3 text-center" onClick={e => e.stopPropagation()}>
                            {canEdit && (canReview || l.createdById === currentUserId) && (
                              <Button size="sm" variant="secondary" onClick={() => setEditingId(l.id)} className="text-xs h-7 px-2 mr-1">
                                Sửa nhanh
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => onSelectLine(l)}
                              className="text-xs h-7 px-2"
                            >
                              <Edit3 size={12} className="mr-1" />
                              Chi tiết
                            </Button>
                          </td>
                        </tr>
                        {editingId === l.id && <QuickEditRow line={l} finance={finance} onCancel={() => setEditingId(null)} />}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                )}
              </tbody>

              {/* Table Footer: Sums VND only, NEVER sums quantity */}
              <tfoot>
                <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-soft)] font-bold text-[var(--foreground)]">
                  <td colSpan={6} className="p-3 text-right">
                    Tổng tiền chi phí thực tế (VND):
                  </td>
                  <td className="p-3 text-right font-mono text-sm text-[var(--primary)]">
                    {actualCosts ? displayMoney(actualCosts.summary.actual.gross) : "0"}
                  </td>
                  <td className="p-3 text-right font-mono">
                    {actualCosts ? signed(actualCosts.summary.variance.gross) : "0"}
                  </td>
                  <td colSpan={4} className="p-3 text-xs text-[var(--text-secondary)] font-normal">
                    (NET: {actualCosts ? displayMoney(actualCosts.summary.actual.net) : "0"} · VAT: {actualCosts ? displayMoney(actualCosts.summary.actual.vat) : "0"})
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickEditRow({ line, finance, onCancel }: { line: ActualCostReadLine; finance: Finance; onCancel: () => void }) {
  const [state, action, pending] = useActionState(actualCostAction, {} as ActualCostActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const effective = finance.data.revisions.find(revision => revision.effective);
  const recipientOptions = [
    ...finance.project.members.map(member => ({ value: `USER:${member.userId}`, label: finance.users.find(user => user.id === member.userId)?.name ?? "Thành viên" })),
    ...finance.data.beneficiaries.map(vendor => ({ value: `VENDOR:${vendor.id}`, label: vendor.name })),
    ...finance.suppliers.flatMap(supplier => supplier.accounts.map(account => ({ value: account.recipientKey, label: `${supplier.version.legalName} · ${account.bankName} •••• ${account.accountLast4}` }))),
  ];
  if (!recipientOptions.some(option => option.value === line.recipientKey)) {
    recipientOptions.unshift({ value: line.recipientKey, label: line.recipientKey });
  }
  const handleKeys = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      const fields = Array.from(formRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-quick-field]") ?? []);
      const index = fields.indexOf(event.target);
      if (index >= 0 && index < fields.length - 1) fields[index + 1].focus();
      else formRef.current?.requestSubmit();
    }
  };

  return <tr className="bg-[var(--primary-soft)]/30"><td colSpan={12} className="p-3">
    <form ref={formRef} action={action} onKeyDown={handleKeys} className="space-y-3" aria-label={`Sửa nhanh ${line.description}`}>
      <input type="hidden" name="projectId" value={finance.project.id} />
      <input type="hidden" name="actualCostCommand" value="SAVE_LINE" />
      <input type="hidden" name="lineId" value={line.id} />
      <input type="hidden" name="sourceKind" value={line.sourceKind} />
      <input type="hidden" name="revisionId" value={effective?.id ?? line.revisionId ?? ""} />
      <input type="hidden" name="icLineId" value={line.icLineId ?? ""} />
      <input type="hidden" name="reason" value={line.sourceReason ?? ""} />
      <input type="hidden" name="basis" value={line.basis} />
      <input type="hidden" name="vatPercent" value={line.vatPercent} />
      <input type="hidden" name="fundingSource" value={line.fundingSource ?? "EMPLOYEE_OUT_OF_POCKET"} />
      {!!line.fundingAllocations?.length && <input type="hidden" name="fundingAllocations" value={JSON.stringify(line.fundingAllocations)} />}
      {line.evidence.map(item => <input key={item.id} type="hidden" name="evidenceIds" value={item.id} />)}
      <input type="hidden" name="billable" value={String(line.billable)} />
      <input type="hidden" name="saleQuantity" value={line.saleSnapshot?.quantity ?? ""} />
      <input type="hidden" name="saleDays" value={line.saleSnapshot?.days ?? ""} />
      <input type="hidden" name="saleUnitPrice" value={line.saleSnapshot?.unitPrice ?? ""} />
      <input type="hidden" name="sheetRevisionId" value={finance.actualCosts?.sheet?.revisionId ?? ""} />
      <input type="hidden" name="sheetMutationVersion" value={finance.actualCosts?.sheet?.mutationVersion ?? 0} />
      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        <label className="text-xs md:col-span-2">Nội dung chi<input data-quick-field name="description" defaultValue={line.description} required className="mt-1 w-full rounded border p-2 bg-[var(--surface)]" /></label>
        <label className="text-xs">Người nhận / NCC<select data-quick-field name="recipientKey" defaultValue={line.recipientKey} required className="mt-1 w-full rounded border p-2 bg-[var(--surface)]">{recipientOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="text-xs">Số lượng<input data-quick-field name="quantity" type="number" min="0" step="any" defaultValue={line.quantity ?? "1"} required className="mt-1 w-full rounded border p-2 bg-[var(--surface)]" /></label>
        <label className="text-xs">Số ngày<input data-quick-field name="days" type="number" min="0" step="any" defaultValue={line.days ?? "1"} required className="mt-1 w-full rounded border p-2 bg-[var(--surface)]" /></label>
        <label className="text-xs">Đơn vị<input data-quick-field name="unit" defaultValue={line.unit ?? ""} required className="mt-1 w-full rounded border p-2 bg-[var(--surface)]" /></label>
        <label className="text-xs">Đơn giá<input data-quick-field name="unitPrice" type="number" min="0" step="any" defaultValue={line.unitPrice ?? "0"} required className="mt-1 w-full rounded border p-2 bg-[var(--surface)]" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--text-secondary)]">Enter: ô kế tiếp/lưu · Tab, Shift+Tab: di chuyển · Esc: hủy</span>
        <Button type="submit" size="sm" loading={pending}>Lưu khoản chi</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Hủy sửa</Button>
      </div>
      {state.error && <Alert tone="danger" title={state.error} />}
      {state.success && <Alert tone="success" title={state.success} />}
    </form>
  </td></tr>;
}
