"use client";

import Link from "next/link";
import { Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Presentation";
import type { Finance } from "@/components/CostFlowPanel";

type Props = {
  open: boolean;
  onClose: () => void;
  finance: Finance;
  currentUserId: string;
  preselectedLineId?: string;
  preselectedRecipientKey?: string;
  onSuccess?: () => void;
};

/** Compatibility shell. Phase 14 permits new records only through normalized AC. */
export default function ExpenseUploadModal({ open, onClose, finance }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-lg rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Receipt size={22} className="text-[var(--primary)]" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold text-[var(--foreground)]">Expense cũ đã chuyển sang chỉ đọc</h2>
              <p className="text-sm text-[var(--text-secondary)]">Ghi nhận mới qua AC chuẩn hóa.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-secondary)]" aria-label="Đóng">
            <X size={18} />
          </button>
        </div>
        <Alert tone="info" title="Không thể tạo Expense legacy">
          Dùng Actual Cost chuẩn hóa; với NCC, chọn hồ sơ đã duyệt và hóa đơn VAT khi lập ĐNTT sau AC.
        </Alert>
        <div className="flex justify-between gap-3">
          <Link href={`/projects/${finance.project.id}?tab=actual-cost`} className="tf-button-primary tf-button-size-md">
            Mở AC chuẩn hóa
          </Link>
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </div>
  );
}
