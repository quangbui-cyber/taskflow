"use client";

import { useActionState, useEffect, useState } from "react";
import { actualCostAction, type ActualCostActionState } from "@/app/actions/costflow";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Alert, Badge } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import { AlertCircle, AlertTriangle, CheckCircle2, Send, X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  finance: Finance;
};

export default function ActualCostPreflightModal({ open, onClose, finance }: Props) {
  const [state, action, pending] = useActionState(actualCostAction, {} as ActualCostActionState);
  const [note, setNote] = useState("");
  const [missingEvidenceExplanation, setMissingEvidenceExplanation] = useState("");
  const [overBudgetExplanation, setOverBudgetExplanation] = useState("");

  const sheet = finance.actualCosts?.sheet;
  const lines = finance.actualCosts?.lines ?? [];
  const comparisons = finance.actualCosts?.comparisons ?? [];

  const totalLines = lines.length;
  const reviewedLines = lines.filter(l => l.internalStatus === "ACCOUNT_REVIEWED").length;
  const missingEvidenceLines = lines.filter(l => l.missingEvidenceWarnings.length > 0).length;
  const overBudgetLines = comparisons.filter(c => c.status === "OVER_BUDGET").length;

  const isAllReviewed = totalLines > 0 && reviewedLines === totalLines;
  const hasBlockingErrors = !isAllReviewed || totalLines === 0;

  useEffect(() => {
    if (state.success) {
      const timer = setTimeout(() => { onClose(); }, 1200);
      return () => clearTimeout(timer);
    }
  }, [state.success, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4" role="dialog" aria-modal="true" aria-labelledby="preflight-title">
      <div className="w-full max-w-xl rounded-2xl bg-[var(--surface)] shadow-2xl border border-[var(--border)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4 bg-[var(--surface-soft)]">
          <div className="flex items-center gap-2">
            <Send size={18} className="text-[var(--primary)]" />
            <h2 id="preflight-title" className="text-base font-bold text-[var(--foreground)]">
              Kiểm tra trước khi gửi Duyệt AC
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <form action={action} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          <input type="hidden" name="projectId" value={finance.project.id} />
          <input type="hidden" name="actualCostCommand" value="SUBMIT_SHEET" />
          <input type="hidden" name="sheetRevisionId" value={sheet?.revisionId ?? ""} />
          <input type="hidden" name="sheetMutationVersion" value={sheet?.mutationVersion ?? 0} />

          {/* 1. Review status */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-2">
                {isAllReviewed ? (
                  <CheckCircle2 size={16} className="text-[var(--success)]" />
                ) : (
                  <AlertCircle size={16} className="text-[var(--danger)]" />
                )}
                Tiến độ rà soát của Account
              </span>
              <Badge tone={isAllReviewed ? "success" : "danger"}>
                {reviewedLines} / {totalLines} dòng đã kiểm tra
              </Badge>
            </div>
            {!isAllReviewed && (
              <p className="text-xs text-[var(--danger)]">
                Lỗi chặn: 100% dòng trong Bảng AC phải được Account đánh dấu &quot;Account đã kiểm tra&quot; trước khi gửi DD.
              </p>
            )}
          </div>

          {/* 2. Evidence status */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-2">
                {missingEvidenceLines === 0 ? (
                  <CheckCircle2 size={16} className="text-[var(--success)]" />
                ) : (
                  <AlertTriangle size={16} className="text-[var(--warning)]" />
                )}
                Chứng từ cốt lõi (BBNT, Hóa đơn VAT, UNC)
              </span>
              <Badge tone={missingEvidenceLines === 0 ? "success" : "warning"}>
                {missingEvidenceLines === 0 ? "Đầy đủ" : `${missingEvidenceLines} dòng cần bổ sung`}
              </Badge>
            </div>
            {missingEvidenceLines > 0 && (
              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                <p className="text-xs text-[var(--text-secondary)]">
                  Có {missingEvidenceLines} dòng chưa đủ chứng từ. Vui lòng nhập giải trình gửi DD:
                </p>
                <Textarea
                  name="missingEvidenceExplanation"
                  label="Giải trình về chứng từ thiếu gửi DD"
                  value={missingEvidenceExplanation}
                  onChange={e => setMissingEvidenceExplanation(e.target.value)}
                  placeholder="VD: Hóa đơn VAT sẽ được NCC xuất vào cuối tháng..."
                  rows={2}
                  required
                />
              </div>
            )}
          </div>

          {/* 3. Budget Variance */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-2">
                {overBudgetLines === 0 ? (
                  <CheckCircle2 size={16} className="text-[var(--success)]" />
                ) : (
                  <AlertTriangle size={16} className="text-[var(--warning)]" />
                )}
                Ngân sách theo Bản IC
              </span>
              <Badge tone={overBudgetLines === 0 ? "success" : "warning"}>
                {overBudgetLines === 0 ? "Trong ngân sách" : `${overBudgetLines} nhóm vượt IC`}
              </Badge>
            </div>
            {overBudgetLines > 0 && (
              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                <p className="text-xs text-[var(--text-secondary)]">
                  Có hạng mục vượt dự toán IC ban đầu. Vui lòng giải trình nguyên nhân:
                </p>
                <Textarea
                  name="overBudgetExplanation"
                  label="Giải trình vượt dự toán gửi DD"
                  value={overBudgetExplanation}
                  onChange={e => setOverBudgetExplanation(e.target.value)}
                  placeholder="VD: Giá thuê thiết bị tăng do dời ngày sự kiện..."
                  rows={2}
                  required
                />
              </div>
            )}
          </div>

          {/* 4. Overall submission note */}
          <Textarea
            name="note"
            label="Ghi chú tổng thể gửi kèm (Tùy chọn)"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Ý kiến hoặc lưu ý chung dành cho DD khi phê duyệt toàn bảng..."
            rows={2}
          />

          {state.error && <Alert tone="danger" title={state.error} />}
          {state.success && <Alert tone="success" title={state.success} />}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border)]">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Đóng & Kiểm tra lại
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={pending}
              disabled={hasBlockingErrors || !sheet?.revisionId || !sheet.canSubmit}
            >
              <Send size={14} className="mr-1.5" />
              Gửi Duyệt toàn bộ Bảng AC
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
