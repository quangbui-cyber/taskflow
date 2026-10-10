"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Plus,
  ArrowRight,
  Printer,
  Eye,
  Layers3,
  Clock,
  Sparkles,
  ExternalLink,
  Copy,
  LayoutTemplate,
  Download
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";
import { displayMoney, totals } from "@/lib/costflow/money";
import { projectQuotation } from "@/lib/costflow/quotationProjection";
import type { Quotation } from "@/lib/costflow/types";
import CustomerQuotationView from "./CustomerQuotationView";
import QuotationTemplateProposalButton from "./QuotationTemplateProposalButton";
import ExcelIntakeDialog from "./ExcelIntakeDialog";

type Props = {
  finance: Finance;
  canCreate: boolean;
  userId?: string;
  createDialogOpen?: boolean;
  onOpenCreateChange?: (open: boolean) => void;
};

export default function QuotationPanel({
  finance,
  canCreate,
  userId,
  createDialogOpen: controlledCreateDialogOpen,
  onOpenCreateChange
}: Props) {
  const quotations = useMemo(() => finance.data.quotations ?? [], [finance.data.quotations]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [internalCreateDialogOpen, setInternalCreateDialogOpen] = useState(false);
  const isCreateDialogOpen = controlledCreateDialogOpen !== undefined ? controlledCreateDialogOpen : internalCreateDialogOpen;
  const setCreateDialogOpen = (open: boolean) => {
    onOpenCreateChange?.(open);
    setInternalCreateDialogOpen(open);
  };
  const [previewQuotation, setPreviewQuotation] = useState<Quotation | null>(null);
  const [cloneSourceId, setCloneSourceId] = useState<string>(quotations.at(-1)?.id ?? "");

  // Active or selected quotation
  const selected = useMemo(() => {
    if (selectedId) return quotations.find(q => q.id === selectedId) ?? quotations.at(-1);
    return quotations.at(-1);
  }, [quotations, selectedId]);

  const latestQuotation = quotations.at(-1);
  const isLatest = selected && latestQuotation && selected.id === latestQuotation.id;

  // Active customer projection for selected quote
  const selectedProjection = useMemo(() => {
    if (!selected) return null;
    try {
      return projectQuotation(selected);
    } catch {
      return null;
    }
  }, [selected]);

  // Drafts for current user
  const userDrafts = useMemo(() => {
    return (finance.data.quotationDrafts ?? []).filter(
      draft => draft.createdBy === userId && ["quote", "paired"].includes(draft.workspaceMode ?? "paired")
    );
  }, [finance.data.quotationDrafts, userId]);

  // Input evidence / sources
  const briefs = finance.data.briefs ?? [];
  const pos = finance.data.pos ?? [];
  const files = finance.files ?? [];

  return (
    <div className="space-y-6">
      {/* 1. TOP HUB BAR */}
      <div className="tf-module-toolbar flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">Scope & Báo giá</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Tổng hợp Brief, PO, tài liệu dự án và quản lý các phiên bản báo giá
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            className="tf-link text-sm"
            href={`/projects/${finance.project.id}?tab=files`}
          >
            Tài liệu dự án ({files.length})
          </Link>
          {canCreate && !finance.data.closed && (
            <>
              <a
                className="tf-button-secondary tf-button-size-sm"
                href={`/api/projects/${finance.project.id}/costflow/excel-intake/template`}
              >
                <Download size={15} className="mr-1" aria-hidden="true" />
                Tải mẫu Excel v4
              </a>
              <ExcelIntakeDialog projectId={finance.project.id} version={finance.version} />
              <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                <Plus size={15} className="mr-1" aria-hidden="true" />
                Tạo báo giá mới
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 2. CĂN CỨ & TÀI LIỆU ĐẦU VÀO (COMPACT STRIP) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--foreground)]">Căn cứ & tài liệu:</span>
          <span>Brief <strong className="text-[var(--foreground)]">({briefs.length})</strong></span>
          <span>·</span>
          <span>PO <strong className="text-[var(--foreground)]">({pos.length})</strong></span>
          <span>·</span>
          <span>Tệp dự án <strong className="text-[var(--foreground)]">({files.length})</strong></span>
        </div>
        <Link
          className="tf-link text-xs flex items-center gap-1 font-medium"
          href={`/projects/${finance.project.id}?tab=files`}
        >
          <span>Xem tất cả tài liệu</span>
          <ExternalLink size={12} aria-hidden="true" />
        </Link>
      </div>

      {/* 3. KHỐI BÁO GIÁ HIỆN HÀNH (ACTIVE BASELINE) */}
      {selected ? (
        <Panel className="space-y-5 border-l-4 border-l-[#a8d431] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
          {/* Card Header & Selector */}
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[var(--border)]">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[#587216]">
                  {isLatest ? "Báo giá hiện hành" : "Phiên bản lịch sử"}
                </span>
                <Badge tone={isLatest ? "success" : "neutral"}>
                  {isLatest ? "Đã chốt" : "Lịch sử"}
                </Badge>
                {selected.salesRows && selected.salesRows.length > 0 && (
                  <Badge tone="info">{selected.salesRows.length} nhóm/dòng cấu trúc</Badge>
                )}
              </div>
              <h3 className="text-xl font-bold text-[var(--foreground)] tracking-tight">
                BG-{String(selected.number).padStart(2, "0")} · {selected.title}
              </h3>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-[var(--text-secondary)]">
                <span>Khách hàng: <strong className="text-[var(--foreground)]">{selected.customer || "Chưa xác định"}</strong></span>
                <span>•</span>
                <span>Ngày lập: {new Date(selected.createdAt).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
                {selected.createdBy && (
                  <>
                    <span>•</span>
                    <span>Người tạo: {finance.users.find(u => u.id === selected.createdBy)?.name ?? "Thành viên dự án"}</span>
                  </>
                )}
              </div>
            </div>

            {/* Quick version switch */}
            {quotations.length > 1 && (
              <div className="min-w-[200px]">
                <Select
                  label="Xem phiên bản khác"
                  value={selected.id}
                  onChange={e => setSelectedId(e.target.value)}
                >
                  {[...quotations].reverse().map(q => (
                    <option key={q.id} value={q.id}>
                      BG-{String(q.number).padStart(2, "0")} · {q.title} {q.id === latestQuotation?.id ? "(Hiện hành)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {/* 3 Metric Cards for Financial Totals */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="p-4 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] block">
                Doanh thu trước VAT (Net)
              </span>
              <strong className="text-xl font-bold text-[var(--foreground)] tabular-nums mt-1 block">
                {selectedProjection ? displayMoney(selectedProjection.amount.net) : "—"}
              </strong>
              <small className="text-xs text-[var(--text-secondary)] mt-0.5 block">
                Cơ sở bán không gồm thuế
              </small>
            </div>

            <div className="p-4 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] block">
                Thuế giá trị gia tăng (VAT)
              </span>
              <strong className="text-xl font-bold text-[var(--foreground)] tabular-nums mt-1 block">
                {selectedProjection ? displayMoney(selectedProjection.amount.vat) : "—"}
              </strong>
              <small className="text-xs text-[var(--text-secondary)] mt-0.5 block">
                Tổng VAT các hạng mục
              </small>
            </div>

            <div className="p-4 rounded-lg bg-[#f7fbe9] border border-[#dfecb1]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#465a16] block">
                Tổng thanh toán sau VAT (Gross)
              </span>
              <strong className="text-xl font-bold text-[#182008] tabular-nums mt-1 block">
                {selectedProjection ? displayMoney(selectedProjection.amount.gross) : "—"}
              </strong>
              <small className="text-xs text-[#587216] mt-0.5 block">
                Tổng giá trị khách thanh toán
              </small>
            </div>
          </div>

          {/* Event Parameters if configured */}
          {selected.parameterConfig && (
            <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                <Sparkles size={14} className="text-[#587216]" aria-hidden="true" />
                Tham số chương trình:
              </span>
              {selected.parameterConfig.definitions
                .filter(def => def.scope === "SHARED")
                .map(def => {
                  const val = selected.parameterConfig?.sharedValues[def.key] || def.defaultValue;
                  return (
                    <span
                      key={def.key}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-[var(--surface)] border border-[var(--border)] font-medium text-[var(--foreground)]"
                    >
                      <span className="text-[var(--text-secondary)]">{def.label}:</span>
                      <strong>{val}</strong>
                    </span>
                  );
                })}
              {selected.parameterConfig.modules.map(mod => (
                <span
                  key={mod.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-[var(--primary-soft)] text-[#465a16] border border-[#dfecb1] font-semibold"
                >
                  {mod.label} · {mod.eventType || "Sự kiện"}
                </span>
              ))}
            </div>
          )}

          {/* Notes if present */}
          {selected.notes && (
            <div className="p-3 rounded-lg bg-[var(--surface-soft)] text-xs text-[var(--text-secondary)]">
              <strong className="text-[var(--foreground)] block mb-0.5">Ghi chú thương mại:</strong>
              <p className="whitespace-pre-wrap">{selected.notes}</p>
            </div>
          )}

          {/* Primary Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--border)]">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="tf-button-primary"
                href={`/projects/${finance.project.id}/costflow/paired?quotationId=${selected.id}`}
              >
                Mở Worksheet
                <ArrowRight size={15} className="ml-1" aria-hidden="true" />
              </Link>
              <Button
                variant="secondary"
                onClick={() => setPreviewQuotation(selected)}
              >
                <Eye size={14} className="mr-1.5" aria-hidden="true" />
                Xem bản khách
              </Button>
              <Link
                className="tf-button-secondary"
                href={`/projects/${finance.project.id}/costflow/quotations/${selected.id}/print`}
              >
                <Printer size={14} className="mr-1.5" aria-hidden="true" />
                Xuất báo giá (PDF)
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canCreate && !finance.data.closed && (
                <Link className="tf-button-secondary" href={`/projects/${finance.project.id}/costflow/quotations/${selected.id}/ic`}>
                  <Layers3 size={14} className="mr-1.5" aria-hidden="true" />
                  Lập IC từ bản này
                </Link>
              )}
              <QuotationTemplateProposalButton
                projectId={finance.project.id}
                quotationId={selected.id}
                quotationTitle={selected.title}
              />
            </div>
          </div>
        </Panel>
      ) : (
        <Panel className="text-center py-10 space-y-4">
          <EmptyState
            title="Dự án chưa có báo giá chính thức"
            description="Bạn có thể bắt đầu bằng việc tạo báo giá từ template mẫu của công ty hoặc tạo bảng trống."
            action={
              canCreate && !finance.data.closed ? (
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus size={16} className="mr-1" aria-hidden="true" />
                  Tạo báo giá đầu tiên
                </Button>
              ) : undefined
            }
          />
        </Panel>
      )}

      {/* 4. KHỐI LỊCH SỬ PHIÊN BẢN & BẢN NHÁP */}
      <div className="space-y-4">
        {/* User Drafts */}
        {userDrafts.length > 0 && (
          <Panel className="space-y-3 bg-[var(--surface)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-[#b86a08]" aria-hidden="true" />
                <h3 className="font-semibold text-sm text-[var(--foreground)]">Bản nháp đang thực hiện của bạn</h3>
              </div>
              <Badge tone="warning">{userDrafts.length} bản nháp</Badge>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {userDrafts.map(draft => {
                const draftRoute =
                  draft.workspaceMode === "quote"
                    ? `/projects/${finance.project.id}/costflow/quotations/new?draftId=${encodeURIComponent(draft.id)}`
                    : `/projects/${finance.project.id}/costflow/paired?draftId=${encodeURIComponent(draft.id)}`;
                return (
                  <div
                    key={draft.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Badge tone="warning">Nháp</Badge>
                        <span className="text-xs text-[var(--text-secondary)]">
                          {draft.workspaceMode === "quote" ? "Báo giá độc lập" : "Báo giá & IC"}
                        </span>
                      </div>
                      <h4 className="font-semibold text-sm truncate mt-1 text-[var(--foreground)]">
                        {draft.title || "Báo giá chưa đặt tên"}
                      </h4>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                        {draft.customer || "Chưa chọn khách"} · {draft.rows.length} dòng
                      </p>
                    </div>
                    <Link
                      className="tf-button-primary tf-button-size-sm text-xs font-semibold whitespace-nowrap"
                      href={draftRoute}
                    >
                      Tiếp tục nháp
                      <ArrowRight size={13} className="ml-1" aria-hidden="true" />
                    </Link>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* Saved Versions Registry Table */}
        <Panel className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-semibold text-base text-[var(--foreground)]">Danh mục các phiên bản báo giá</h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Lịch sử toàn bộ các lần chốt báo giá đã lưu trong dự án
              </p>
            </div>
            <Badge tone="neutral">{quotations.length} phiên bản</Badge>
          </div>

          {quotations.length > 0 ? (
            <Table caption="Danh sách các phiên bản báo giá đã chốt của dự án">
              <thead>
                <tr>
                  <th scope="col" className="w-[10%]">Mã</th>
                  <th scope="col" className="w-[30%]">Tên phiên bản</th>
                  <th scope="col" className="w-[18%]">Khách hàng</th>
                  <th scope="col" className="w-[16%] text-right">Doanh thu Net</th>
                  <th scope="col" className="w-[14%]">Ngày lập</th>
                  <th scope="col" className="w-[12%] text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {[...quotations].reverse().map(q => {
                  const isCurrent = q.id === latestQuotation?.id;
                  const itemNet = totals(q.lines.map(l => l.cost)).net;
                  return (
                    <tr
                      key={q.id}
                      className={q.id === selected?.id ? "bg-[var(--surface-soft)] font-medium" : undefined}
                    >
                      <td>
                        <span className="font-bold text-xs uppercase tracking-wider text-[#587216]">
                          BG-{String(q.number).padStart(2, "0")}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="tf-link text-left font-semibold text-sm"
                            onClick={() => setSelectedId(q.id)}
                          >
                            {q.title}
                          </button>
                          {isCurrent && <Badge tone="success">Hiện hành</Badge>}
                        </div>
                      </td>
                      <td className="text-sm text-[var(--text-secondary)] truncate">
                        {q.customer || "—"}
                      </td>
                      <td className="text-right tabular-nums text-sm font-semibold">
                        {displayMoney(itemNet)}
                      </td>
                      <td className="text-sm text-[var(--text-secondary)] whitespace-nowrap">
                        {new Date(q.createdAt).toLocaleDateString("vi-VN")}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Xem trước BG-${q.number}`}
                            onClick={() => setPreviewQuotation(q)}
                          >
                            <Eye size={14} aria-hidden="true" />
                          </Button>
                          <Link
                            className="tf-button-ghost tf-button-size-sm"
                            href={`/projects/${finance.project.id}/costflow/paired?quotationId=${q.id}`}
                            aria-label={`Mở Worksheet BG-${q.number}`}
                          >
                            <ArrowRight size={14} aria-hidden="true" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-[var(--text-secondary)] py-4 text-center">
              Chưa có phiên bản báo giá nào được lưu.
            </p>
          )}
        </Panel>
      </div>

      {/* 5. DIALOG: TẠO BÁO GIÁ MỚI */}
      <Dialog
        open={isCreateDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="Tạo báo giá mới"
        description="Chọn phương thức khởi tạo phù hợp với yêu cầu của dự án."
      >
        <div className="space-y-4 py-2">
          {/* Option 1: Template */}
          <Link
            className="flex items-start gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] transition-all hover:border-[var(--primary)] hover:bg-[var(--surface-soft)] text-left group"
            href={`/projects/${finance.project.id}/costflow/quotations/new`}
            onClick={() => setCreateDialogOpen(false)}
          >
            <div className="p-2.5 rounded bg-[var(--primary-soft)] text-[#465a16] border border-[#dfecb1] shrink-0">
              <LayoutTemplate size={22} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-[var(--foreground)] group-hover:text-[#465a16]">
                  Dùng Template chuẩn công ty
                </h4>
                <Badge tone="success">Khuyên dùng</Badge>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Kế thừa cấu trúc định dạng chuẩn cho Teambuilding, Gala, Hội nghị với công thức tham số tự động.
              </p>
            </div>
          </Link>

          {/* Option 2: Clone from historical quote */}
          {quotations.length > 0 && (
            <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded bg-[var(--surface-soft)] text-[var(--info)] border border-[var(--border)] shrink-0">
                  <Copy size={22} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm text-[var(--foreground)]">
                    Sao chép từ phiên bản đã có
                  </h4>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    Nhân bản toàn bộ các nhóm và hạng mục từ một báo giá đã chốt trong dự án để tiếp tục điều chỉnh.
                  </p>
                </div>
              </div>
              <div className="pt-2 flex items-center gap-2">
                <div className="flex-1">
                  <Select
                    label="Chọn bản báo giá nguồn"
                    value={cloneSourceId}
                    onChange={e => setCloneSourceId(e.target.value)}
                  >
                    {[...quotations].reverse().map(q => (
                      <option key={q.id} value={q.id}>
                        BG-{String(q.number).padStart(2, "0")} · {q.title}
                      </option>
                    ))}
                  </Select>
                </div>
                <Link
                  className="tf-button-secondary text-sm mt-5 whitespace-nowrap"
                  href={`/projects/${finance.project.id}/costflow/quotations/new?quotationId=${encodeURIComponent(cloneSourceId)}`}
                  onClick={() => setCreateDialogOpen(false)}
                >
                  Sao chép bản này
                </Link>
              </div>
            </div>
          )}

          {/* Option 3: Blank Canvas */}
          <Link
            className="flex items-start gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] transition-all hover:border-[var(--primary)] hover:bg-[var(--surface-soft)] text-left group"
            href={`/projects/${finance.project.id}/costflow/quotations/new?start=blank`}
            onClick={() => setCreateDialogOpen(false)}
          >
            <div className="p-2.5 rounded bg-[var(--surface-soft)] text-[var(--muted)] border border-[var(--border)] shrink-0">
              <Plus size={22} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-sm text-[var(--foreground)] group-hover:text-[#465a16]">
                Bắt đầu từ bảng trống
              </h4>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Tự xây dựng cấu trúc nhóm và hạng mục hoàn toàn mới từ đầu.
              </p>
            </div>
          </Link>
        </div>
      </Dialog>

      {/* 6. DIALOG: XEM TRƯỚC BẢN KHÁCH HÀNG */}
      {previewQuotation && (
        <Dialog
          open={!!previewQuotation}
          onClose={() => setPreviewQuotation(null)}
          title={`Xem trước bản khách hàng · BG-${String(previewQuotation.number).padStart(2, "0")}`}
        >
          <div className="py-2 max-h-[75vh] overflow-y-auto">
            <CustomerQuotationView
              project={finance.project.name}
              quotation={projectQuotation(previewQuotation)}
            />
          </div>
          <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
            <span className="text-xs text-[var(--text-secondary)]">
              Chế độ xem trước dành cho khách hàng. Không hiển thị chi phí giá vốn IC.
            </span>
            <div className="flex items-center gap-2">
              <Link
                className="tf-button-primary tf-button-size-sm"
                href={`/projects/${finance.project.id}/costflow/quotations/${previewQuotation.id}/print`}
              >
                <Printer size={13} className="mr-1" aria-hidden="true" />
                In hoặc xuất PDF
              </Link>
              <Button variant="secondary" size="sm" onClick={() => setPreviewQuotation(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
