"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  X,
  FileText,
  CreditCard,
  Paperclip,
  Upload,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge } from "@/components/ui/Presentation";
import ActionForm from "@/components/CostFlowActionForm";
import { costFlowAction } from "@/app/actions/costflow";
import { displayMoney } from "@/lib/costflow/money";
import type { Expense } from "@/lib/costflow/types";

type Props = {
  expense: Expense | null;
  onClose: () => void;
  finance: Finance;
  currentUser: { id: string; role: string };
  canCreate: boolean;
  onSelectTab?: (tab: string) => void;
};

export default function ExpenseDetailDrawer({
  expense,
  onClose,
  finance,
  currentUser,
  canCreate,
  onSelectTab,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [showReviseForm, setShowReviseForm] = useState(false);
  const [showEvidenceUpload, setShowEvidenceUpload] = useState(false);

  if (!expense) return null;

  const usersMap = new Map(finance.users.map(u => [u.id, u.name]));
  const effectiveRevision = finance.data.revisions.find(r => r.effective);
  const sourceRevision = finance.data.revisions.find(r => r.id === expense.revisionId);
  const sourceLine = sourceRevision?.lines.find(l => l.id === expense.lineId);

  const recipientLabel = expense.recipientKey.startsWith("USER:")
    ? `${usersMap.get(expense.recipientKey.slice(5)) ?? "Nhân viên"} (Nội bộ)`
    : `${finance.data.beneficiaries.find(b => b.id === expense.recipientKey.slice(7))?.name ?? "NCC"} (Nhà cung cấp)`;

  const creatorName = usersMap.get(expense.createdBy) ?? expense.createdBy;

  const variance = Number(expense.cost.gross) - Number(sourceLine?.cost?.gross ?? 0);
  const isOverBudget = variance > 0;
  const isUnderBudget = variance < 0;

  const hasInvoice = !!expense.invoiceId;
  const hasPayment = !!expense.paymentProofId;
  const isComplete = hasInvoice && hasPayment;

  const isAccountant = currentUser.id === finance.data.config.accountantId;
  const isProjectManager = currentUser.id === finance.project.ownerId || currentUser.id === finance.data.config.managerId;
  const isAdmin = currentUser.role === "ADMIN";
  const canReviewException = isAccountant || isProjectManager || isAdmin;

  // Handle Approve / Reject Exception
  function handleExceptionDecision(decision: "APPROVED" | "REJECTED") {
    if (!expense) return;
    setActionError("");
    startTransition(async () => {
      const form = new FormData();
      form.append("projectId", finance.project.id);
      form.append("version", String(finance.version));
      form.append("command", "EXPENSE_EVIDENCE");
      form.append("expenseId", expense.id);
      form.append("exceptionStatus", decision);

      const res = await costFlowAction({}, form);
      if (res.error) {
        setActionError(res.error);
      } else {
        setActionSuccess(
          decision === "APPROVED"
            ? "Đã duyệt ngoại lệ chứng từ thành công."
            : "Đã từ chối ngoại lệ chứng từ."
        );
      }
    });
  }

  const fundingSourceLabel = {
    ADVANCE: "Khấu trừ vào khoản tạm ứng nhân viên (ĐNTU)",
    OUT_OF_POCKET: "Nhân viên tự ứng tiền túi — Thu hồi qua Phiếu Hoàn Tạm Ứng (ĐNHTU)",
    VENDOR_DIRECT: "Chi trả trực tiếp cho NCC — Thanh toán qua Phiếu Đề Nghị Thanh Toán (ĐNTT)",
  }[expense.fundingSource ?? "ADVANCE"];

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="fixed inset-y-0 right-0 max-w-full flex pl-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-screen max-w-md bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-[var(--border)] bg-[var(--surface-soft)]">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={isComplete ? "success" : expense.exceptionStatus === "APPROVED" ? "success" : "warning"}>
                  {isComplete
                    ? "Đủ chứng từ"
                    : expense.exceptionStatus === "APPROVED"
                    ? "Ngoại lệ đã duyệt"
                    : expense.exceptionReason
                    ? "Chờ duyệt ngoại lệ"
                    : "Chờ bổ sung chứng từ"}
                </Badge>
                {expense.fundingSource && (
                  <Badge tone="neutral">
                    {expense.fundingSource === "ADVANCE" ? "Tạm ứng" : expense.fundingSource === "OUT_OF_POCKET" ? "Tiền túi" : "NCC"}
                  </Badge>
                )}
              </div>
              <h3 className="font-bold text-base text-[var(--foreground)] mt-1.5 leading-snug">
                {expense.description}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface)]"
              aria-label="Đóng"
            >
              <X size={18} />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {actionError && <Alert tone="danger" title={actionError} />}
            {actionSuccess && <Alert tone="success" title={actionSuccess} />}

            {/* Khối tiền số liệu */}
            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Thành tiền Gross (gồm VAT)</span>
                <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {displayMoney(expense.cost.gross)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border)] text-xs">
                <div>
                  <span className="text-[var(--text-secondary)] block">Trước VAT (Net)</span>
                  <span className="font-mono font-semibold text-[var(--foreground)]">
                    {displayMoney(expense.cost.net)}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-secondary)] block">Thuế VAT ({expense.input.vatPercent}%)</span>
                  <span className="font-mono font-semibold text-[var(--text-secondary)]">
                    {displayMoney(expense.cost.vat)}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--border)] flex justify-between text-xs text-[var(--text-secondary)]">
                <span>Số lượng: {expense.input.quantity}</span>
                <span>Đơn giá: {displayMoney(expense.input.unitPrice)} ({expense.input.basis})</span>
              </div>
            </div>

            {/* Khối thông tin đối ứng IC */}
            <div className="space-y-2.5 text-xs">
              <h4 className="font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[11px]">
                Căn cứ ngân sách & Đối soát
              </h4>

              <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--text-secondary)]">Dòng IC căn cứ:</span>
                  <span className="font-semibold text-[var(--foreground)]">
                    IC-R{sourceRevision?.number ?? "—"}
                  </span>
                </div>
                <p className="text-[var(--foreground)] font-medium bg-[var(--surface-soft)] p-2 rounded">
                  {sourceLine?.description ?? expense.lineId}
                </p>

                {sourceLine && (
                  <div className="flex items-center justify-between pt-1 text-[var(--text-secondary)]">
                    <span>Ngân sách dự toán: {displayMoney(sourceLine.cost?.gross ?? "0")}</span>
                    <span className={isOverBudget ? "text-rose-600 font-semibold" : isUnderBudget ? "text-emerald-600 font-semibold" : ""}>
                      {isOverBudget ? `Vượt +${displayMoney(String(variance))}` : isUnderBudget ? `Dưới -${displayMoney(String(Math.abs(variance)))}` : "Khớp dự toán"}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                  <span className="text-[var(--text-secondary)] block text-[11px]">Người chi / Thụ hưởng</span>
                  <span className="font-medium text-[var(--foreground)] mt-0.5 block truncate">
                    {recipientLabel}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                  <span className="text-[var(--text-secondary)] block text-[11px]">Người tạo hồ sơ</span>
                  <span className="font-medium text-[var(--foreground)] mt-0.5 block truncate">
                    {creatorName}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs space-y-1">
                <span className="text-[var(--text-secondary)] block text-[11px]">Nguồn tiền & Loại phiếu đề nghị</span>
                <span className="font-medium text-[var(--foreground)] block">
                  {fundingSourceLabel}
                </span>
                {expense.fundingSource !== "ADVANCE" && (
                  <p className="text-[11px] text-[var(--text-secondary)] pt-1 border-t border-[var(--border)]">
                    * Phiếu có thể lập trước; chỉ chính thức có hiệu lực thanh toán khi khoản chi AC này được phê duyệt ({isComplete || expense.exceptionStatus === "APPROVED" ? "Hiện đã hợp lệ" : "Đang chờ hoàn tất chứng từ / duyệt ngoại lệ"}).
                  </p>
                )}
              </div>
            </div>

            {/* Khối chứng từ đính kèm */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[11px]">
                  Tệp chứng từ đính kèm
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowEvidenceUpload(prev => !prev)}
                >
                  <Upload size={13} className="mr-1" />
                  {showEvidenceUpload ? "Đóng" : "Bổ sung"}
                </Button>
              </div>

              <div className="space-y-2">
                {/* Hóa đơn VAT */}
                <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText size={18} className={hasInvoice ? "text-emerald-600" : "text-amber-500"} />
                    <div className="min-w-0">
                      <span className="font-semibold text-[var(--foreground)] block">Hóa đơn VAT</span>
                      <span className="text-[11px] text-[var(--text-secondary)] block truncate">
                        {hasInvoice ? "Đã đính kèm chứng từ hóa đơn" : "Chưa có hóa đơn VAT"}
                      </span>
                    </div>
                  </div>
                  {hasInvoice ? (
                    <Link
                      href={`/api/projects/${finance.project.id}/costflow/evidence/${expense.invoiceId}`}
                      target="_blank"
                      className="tf-button-secondary tf-button-size-sm"
                    >
                      <Paperclip size={12} className="mr-1" />
                      Xem file
                    </Link>
                  ) : (
                    <Badge tone="warning">Thiếu</Badge>
                  )}
                </div>

                {/* Bằng chứng thanh toán */}
                <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CreditCard size={18} className={hasPayment ? "text-emerald-600" : "text-amber-500"} />
                    <div className="min-w-0">
                      <span className="font-semibold text-[var(--foreground)] block">UNC / Bill chuyển khoản</span>
                      <span className="text-[11px] text-[var(--text-secondary)] block truncate">
                        {hasPayment ? "Đã đính kèm xác nhận thanh toán" : "Chưa có UNC / biên nhận"}
                      </span>
                    </div>
                  </div>
                  {hasPayment ? (
                    <Link
                      href={`/api/projects/${finance.project.id}/costflow/evidence/${expense.paymentProofId}`}
                      target="_blank"
                      className="tf-button-secondary tf-button-size-sm"
                    >
                      <Paperclip size={12} className="mr-1" />
                      Xem file
                    </Link>
                  ) : (
                    <Badge tone="warning">Thiếu</Badge>
                  )}
                </div>
              </div>

              {/* Form bổ sung chứng từ */}
              {showEvidenceUpload && (
                <div className="p-3.5 rounded-xl border border-[var(--primary)]/40 bg-[var(--surface-soft)] space-y-3">
                  <p className="font-bold text-xs text-[var(--foreground)]">Chọn tài liệu đã lưu trong dự án:</p>
                  <ActionForm finance={finance} command="EXPENSE_EVIDENCE" label="Cập nhật chứng từ">
                    <input type="hidden" name="expenseId" value={expense.id} />
                    <Select label="Hóa đơn VAT" name="invoiceFileId" defaultValue={expense.invoiceId ?? ""}>
                      <option value="">-- Giữ nguyên hoặc chọn file mới --</option>
                      {finance.files.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </Select>
                    <Select label="UNC / Bằng chứng thanh toán" name="paymentFileId" defaultValue={expense.paymentProofId ?? ""}>
                      <option value="">-- Giữ nguyên hoặc chọn file mới --</option>
                      {finance.files.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </Select>
                  </ActionForm>
                </div>
              )}
            </div>

            {/* Khối ngoại lệ & Duyệt của Kế toán */}
            {expense.exceptionReason && (
              <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle size={15} />
                    Ngoại lệ chi phí không hóa đơn
                  </span>
                  <Badge tone={expense.exceptionStatus === "APPROVED" ? "success" : expense.exceptionStatus === "REJECTED" ? "danger" : "warning"}>
                    {expense.exceptionStatus === "APPROVED" ? "Đã duyệt ngoại lệ" : expense.exceptionStatus === "REJECTED" ? "Bị từ chối" : "Chờ Kế toán duyệt"}
                  </Badge>
                </div>

                <p className="text-amber-950 dark:text-amber-100 bg-[var(--surface)] p-2.5 rounded border border-amber-200 dark:border-amber-900">
                  {expense.exceptionReason}
                </p>

                {/* Quyết định của Kế toán / Quản lý */}
                {canReviewException && expense.exceptionStatus !== "APPROVED" && (
                  <div className="pt-2 flex items-center justify-end gap-2 border-t border-amber-200 dark:border-amber-900">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleExceptionDecision("REJECTED")}
                      disabled={isPending}
                    >
                      Từ chối ngoại lệ
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleExceptionDecision("APPROVED")}
                      disabled={isPending}
                    >
                      Duyệt ngoại lệ hợp lệ
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Trình sửa chi phí (REVISE_EXPENSE) */}
            {canCreate && !finance.data.closed && (
              <div className="pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowReviseForm(prev => !prev)}
                  className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1 font-semibold"
                >
                  <RotateCcw size={13} />
                  {showReviseForm ? "Thu gọn form sửa" : "Đề nghị sửa chi phí này (Trình duyệt lại)"}
                </button>

                {showReviseForm && effectiveRevision && (
                  <div className="mt-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-3">
                    <ActionForm finance={finance} command="REVISE_EXPENSE" label="Gửi bản sửa AC">
                      <input type="hidden" name="expenseId" value={expense.id} />
                      <input type="hidden" name="revisionId" value={effectiveRevision.id} />
                      <input type="hidden" name="lineId" value={expense.lineId} />
                      <Input name="title" label="Tiêu đề bản sửa" defaultValue={`Sửa ${expense.description}`} required />
                      <Input name="description" label="Nội dung" defaultValue={expense.description} required />
                      <div className="grid grid-cols-2 gap-2">
                        <Input name="quantity" label="SL" defaultValue={expense.input.quantity} required />
                        <Input name="unitPrice" label="Đơn giá" defaultValue={expense.input.unitPrice} required />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Select name="basis" label="Cơ sở" defaultValue={expense.input.basis}>
                          <option value="GROSS">GROSS</option>
                          <option value="NET">NET</option>
                        </Select>
                        <Input name="vatPercent" label="VAT %" defaultValue={expense.input.vatPercent} required />
                      </div>
                      <Select label="Hóa đơn VAT bản sửa" name="invoiceFileId" required defaultValue={expense.invoiceId ?? ""}>
                        <option value="">Chọn file hóa đơn</option>
                        {finance.files.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </Select>
                      <Select label="UNC bản sửa" name="paymentFileId" required defaultValue={expense.paymentProofId ?? ""}>
                        <option value="">Chọn file UNC</option>
                        {finance.files.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </Select>
                      <Textarea name="explanation" label="Lý do sửa chi phí" placeholder="Nêu rõ lý do thay đổi..." required />
                    </ActionForm>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[var(--border)] bg-[var(--surface-soft)] flex items-center justify-between gap-3">
            <div>
              {canCreate && expense.fundingSource === "OUT_OF_POCKET" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      const url = new URL(window.location.href);
                      url.searchParams.set("tab", "approvals");
                      url.searchParams.set("kind", "REIMBURSEMENT");
                      url.searchParams.set("recipientKey", expense.recipientKey);
                      window.history.pushState(null, "", url.toString());
                      if (onSelectTab) onSelectTab("approvals");
                      onClose();
                    }
                  }}
                  className="text-xs font-semibold"
                >
                  <RotateCcw size={13} className="mr-1 text-[var(--primary)]" />
                  Lập Phiếu Hoàn tạm ứng (ĐNHTU)
                </Button>
              )}

              {canCreate && expense.fundingSource === "VENDOR_DIRECT" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      const url = new URL(window.location.href);
                      url.searchParams.set("tab", "approvals");
                      url.searchParams.set("kind", "VENDOR_PAYMENT");
                      url.searchParams.set("recipientKey", expense.recipientKey);
                      url.searchParams.set("amount", expense.cost.gross);
                      url.searchParams.set("expenseIds", JSON.stringify([expense.id]));
                      window.history.pushState(null, "", url.toString());
                      if (onSelectTab) onSelectTab("approvals");
                      onClose();
                    }
                  }}
                  className="text-xs font-semibold"
                >
                  <FileText size={13} className="mr-1 text-[var(--primary)]" />
                  Lập Phiếu Đề nghị thanh toán (ĐNTT)
                </Button>
              )}
            </div>

            <Button variant="secondary" onClick={onClose}>
              Đóng
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
