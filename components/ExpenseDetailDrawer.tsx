"use client";

import Link from "next/link";
import { CreditCard, FileText, Paperclip, X } from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Presentation";
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

export default function ExpenseDetailDrawer({ expense, onClose, finance }: Props) {
  if (!expense) return null;

  const usersMap = new Map(finance.users.map(user => [user.id, user.name]));
  const sourceRevision = finance.data.revisions.find(revision => revision.id === expense.revisionId);
  const sourceLine = sourceRevision?.lines.find(line => line.id === expense.lineId);
  const recipientLabel = expense.recipientKey.startsWith("USER:")
    ? `${usersMap.get(expense.recipientKey.slice(5)) ?? "Nhân viên"} (Nội bộ)`
    : `${finance.data.beneficiaries.find(item => item.id === expense.recipientKey.slice(7))?.name ?? "NCC legacy"} (Nhà cung cấp)`;
  const variance = Number(expense.cost.gross) - Number(sourceLine?.cost?.gross ?? 0);
  const hasInvoice = Boolean(expense.invoiceId);
  const hasPayment = Boolean(expense.paymentProofId);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10" onClick={event => event.stopPropagation()}>
        <div className="w-screen max-w-md bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col">
          <div className="flex items-start justify-between gap-4 p-5 border-b border-[var(--border)] bg-[var(--surface-soft)]">
            <div className="space-y-2">
              <Badge tone="neutral">Expense legacy · chỉ đọc</Badge>
              <h3 className="font-bold text-base text-[var(--foreground)] leading-snug">{expense.description}</h3>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-secondary)]" aria-label="Đóng">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              Bản ghi lịch sử được giữ nguyên để đối soát và tải chứng từ. Không thể bổ sung, sửa hoặc dùng lại làm nguồn chi mới; ghi nhận mới qua AC chuẩn hóa.
            </div>

            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Thành tiền Gross</span>
                <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">{displayMoney(expense.cost.gross)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border)] text-xs">
                <div><span className="block text-[var(--text-secondary)]">Net</span><strong>{displayMoney(expense.cost.net)}</strong></div>
                <div><span className="block text-[var(--text-secondary)]">VAT ({expense.input.vatPercent}%)</span><strong>{displayMoney(expense.cost.vat)}</strong></div>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <h4 className="font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[11px]">Nguồn lịch sử</h4>
              <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
                <div className="flex justify-between gap-3"><span className="text-[var(--text-secondary)]">IC căn cứ</span><strong>IC-R{sourceRevision?.number ?? "—"}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--text-secondary)]">Dòng IC</span><strong className="text-right">{sourceLine?.description ?? expense.lineId}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--text-secondary)]">Người nhận</span><strong className="text-right">{recipientLabel}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--text-secondary)]">Chênh lệch Gross</span><strong>{variance === 0 ? "Khớp" : displayMoney(String(variance))}</strong></div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-bold uppercase tracking-wider text-[var(--text-secondary)] text-[11px]">Chứng từ gốc</h4>
              <LegacyEvidenceRow
                icon={<FileText size={18} />}
                label="Hóa đơn / biên lai lịch sử"
                evidenceId={expense.invoiceId}
                projectId={finance.project.id}
                present={hasInvoice}
              />
              <LegacyEvidenceRow
                icon={<CreditCard size={18} />}
                label="UNC / bằng chứng thanh toán lịch sử"
                evidenceId={expense.paymentProofId}
                projectId={finance.project.id}
                present={hasPayment}
              />
            </div>

            {expense.exceptionReason && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
                <div className="flex justify-between gap-3"><strong>Ngoại lệ lịch sử</strong><Badge tone={expense.exceptionStatus === "APPROVED" ? "success" : expense.exceptionStatus === "REJECTED" ? "danger" : "warning"}>{expense.exceptionStatus ?? "PENDING"}</Badge></div>
                <p className="mt-2 text-[var(--text-secondary)]">{expense.exceptionReason}</p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-[var(--border)] bg-[var(--surface-soft)] flex items-center justify-between gap-3">
            <Link href={`/projects/${finance.project.id}?tab=actual-cost`} className="tf-button-secondary tf-button-size-md">Mở AC chuẩn hóa</Link>
            <Button variant="secondary" onClick={onClose}>Đóng</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegacyEvidenceRow({ icon, label, evidenceId, projectId, present }: { icon: React.ReactNode; label: string; evidenceId: string | null; projectId: string; present: boolean }) {
  return (
    <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-2.5 min-w-0"><span className={present ? "text-emerald-600" : "text-amber-500"}>{icon}</span><span className="font-semibold">{label}</span></div>
      {present && evidenceId ? (
        <Link href={`/api/projects/${projectId}/costflow/evidence/${evidenceId}`} target="_blank" className="tf-button-secondary tf-button-size-sm"><Paperclip size={12} className="mr-1" />Xem file</Link>
      ) : <Badge tone="warning">Không có</Badge>}
    </div>
  );
}
