"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Wallet,
  AlertCircle,
  CheckCircle2,
  Plus,
  Layers3,
  Paperclip
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import ActionForm from "@/components/CostFlowActionForm";
import { displayMoney } from "@/lib/costflow/money";

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
};

export default function ActualCostPanel({ finance, canCreate }: Props) {
  const [search, setSearch] = useState("");
  const [evidenceFilter, setEvidenceFilter] = useState<"ALL" | "COMPLETE" | "MISSING">("ALL");
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);

  const effective = finance.data.revisions.find(r => r.effective);
  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  const recipientName = useCallback((key: string) =>
    key.startsWith("USER:")
      ? usersMap.get(key.slice(5)) ?? "Nhân viên"
      : finance.data.beneficiaries.find(b => b.id === key.slice(7))?.name ?? "NCC", [finance.data.beneficiaries, usersMap]);

  const recipients = useMemo(() => [
    ...finance.project.members.map(m => ({
      value: `USER:${m.userId}`,
      label: `${usersMap.get(m.userId) ?? "Nhân viên"} (Nội bộ)`
    })),
    ...finance.data.beneficiaries.map(b => ({
      value: `VENDOR:${b.id}`,
      label: `${b.name} (NCC)`
    }))
  ], [finance.project.members, finance.data.beneficiaries, usersMap]);

  // Statistics
  const stats = useMemo(() => {
    let totalGross = 0;
    let completeEvidence = 0;
    let missingEvidence = 0;

    finance.data.expenses.forEach(e => {
      totalGross += parseFloat(e.cost.gross) || 0;
      if (e.invoiceId && e.paymentProofId) completeEvidence++;
      else missingEvidence++;
    });

    return {
      count: finance.data.expenses.length,
      totalGross,
      completeEvidence,
      missingEvidence
    };
  }, [finance.data.expenses]);

  // Filtered expense list
  const filteredExpenses = useMemo(() => {
    return finance.data.expenses.filter(e => {
      if (evidenceFilter === "COMPLETE" && (!e.invoiceId || !e.paymentProofId)) return false;
      if (evidenceFilter === "MISSING" && e.invoiceId && e.paymentProofId) return false;

      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const descMatch = e.description.toLowerCase().includes(q);
        const recMatch = recipientName(e.recipientKey).toLowerCase().includes(q);
        if (!descMatch && !recMatch) return false;
      }

      return true;
    });
  }, [finance.data.expenses, evidenceFilter, search, recipientName]);

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER & METRICS */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
              Actual Cost theo dòng IC
            </h2>
            <Badge tone="neutral">{stats.count} khoản chi</Badge>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Ghi nhận chi phí thực tế phát sinh gắn trực tiếp với từng dòng IC ngân sách đã duyệt. Duyệt hồ sơ không tự suy ra là đã chi tiền.
          </p>
        </div>

        {canCreate && !finance.data.closed && effective && (
          <Button onClick={() => setAddExpenseOpen(prev => !prev)}>
            <Plus size={15} className="mr-1" aria-hidden="true" />
            {addExpenseOpen ? "Đóng form ghi chi phí" : "Ghi chi phí AC phát sinh"}
          </Button>
        )}
      </div>

      {/* KPI METRICS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Tổng Actual Cost</span>
            <Wallet size={16} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-[var(--foreground)] mt-2">
            {displayMoney(Math.round(stats.totalGross).toString())}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Tổng chi phí đã ghi nhận (gồm VAT)
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">IC Căn cứ</span>
            <Layers3 size={16} className="text-blue-600 dark:text-blue-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold text-[var(--foreground)] mt-2">
            {effective ? `IC-R${effective.number}` : "Chưa có"}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {effective ? "Baseline ngân sách hiệu lực" : "Cần Quản lý phê duyệt IC"}
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Đủ chứng từ</span>
            <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-2">
            {stats.completeEvidence} khoản
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Có đủ hóa đơn và chứng từ chi
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Chờ bổ sung chứng từ</span>
            <AlertCircle size={16} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400 mt-2">
            {stats.missingEvidence} khoản
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Cần bổ sung trước khi hoàn ứng
          </span>
        </div>
      </div>

      {!effective && (
        <Alert
          tone="warning"
          title="Dự án chưa có Internal Cost hiệu lực"
        >
          Để ghi nhận chi phí phát sinh Actual Cost, dự án cần có ít nhất một phiên bản IC đã được Quản lý phê duyệt để làm baseline ngân sách.
        </Alert>
      )}

      {/* 2. FORM GHI CHI PHÍ AC PHÁT SINH */}
      {addExpenseOpen && canCreate && !finance.data.closed && effective && (
        <Panel className="space-y-4 border-2 border-[var(--primary)]/40 bg-[var(--surface)]">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
            <div>
              <h3 className="font-bold text-base text-[var(--foreground)]">
                Ghi nhận chi phí phát sinh mới
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Gắn trực tiếp với dòng dự toán IC-R{effective.number} để tự động theo dõi hạn mức và chênh lệch (Variance).
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setAddExpenseOpen(false)}>
              Đóng
            </Button>
          </div>

          <ActionForm
            finance={finance}
            command="EXPENSE"
            label="Lưu khoản chi AC"
            onSuccess={() => setAddExpenseOpen(false)}
          >
            <input type="hidden" name="revisionId" value={effective.id} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Dòng IC ngân sách nguồn" name="lineId" required>
                <option value="">Chọn dòng chi phí trong IC</option>
                {effective.lines.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.description} ({l.cost ? displayMoney(l.cost.gross) : "chưa tính"})
                  </option>
                ))}
              </Select>

              <Select label="Người nhận tiền / NCC" name="recipientKey" required>
                <option value="">Chọn người nhận</option>
                {recipients.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </Select>
            </div>

            <Input
              name="description"
              label="Nội dung khoản chi"
              placeholder="Ví dụ: Thuê loa đài sân khấu chính theo thực tế"
              required
            />

            <div className="grid gap-3 sm:grid-cols-4">
              <Input label="Số lượng" name="quantity" defaultValue="1" required inputMode="decimal" />
              <Input label="Đơn giá (VND)" name="unitPrice" required inputMode="decimal" placeholder="Không dấu chấm" />
              <Select label="Giá nhập" name="basis" defaultValue="NET">
                <option value="NET">Net (chưa VAT)</option>
                <option value="GROSS">Gross (đã VAT)</option>
              </Select>
              <Input label="VAT (%)" name="vatPercent" defaultValue="8" required inputMode="decimal" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-[var(--border)]/60">
              <Select name="invoiceFileId" label="Hóa đơn / Chứng từ chi phí">
                <option value="">Bổ sung sau (không bắt buộc ngay)</option>
                {finance.files.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>

              <Select name="paymentFileId" label="Bằng chứng đã chi (UNC / Phiếu chi)">
                <option value="">Bổ sung sau (không bắt buộc ngay)</option>
                {finance.files.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            </div>
            <p className="tf-ui-help">
              Có thể ghi phát sinh khi còn thiếu chứng từ để theo dõi chi phí kịp thời. Hồ sơ Hoàn Tạm Ứng bắt buộc phải có đủ chứng từ.
            </p>
          </ActionForm>
        </Panel>
      )}

      {/* 3. BẢNG ACTUAL COST & VARIANCE */}
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Evidence Filter Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-[var(--surface-soft)] rounded-lg border border-[var(--border)] text-xs font-medium">
            <button
              type="button"
              onClick={() => setEvidenceFilter("ALL")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                evidenceFilter === "ALL"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm font-semibold"
                  : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              Tất cả ({stats.count})
            </button>
            <button
              type="button"
              onClick={() => setEvidenceFilter("COMPLETE")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                evidenceFilter === "COMPLETE"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm font-semibold"
                  : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              Đủ chứng từ ({stats.completeEvidence})
            </button>
            <button
              type="button"
              onClick={() => setEvidenceFilter("MISSING")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                evidenceFilter === "MISSING"
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 shadow-sm font-semibold"
                  : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              Chờ bổ sung ({stats.missingEvidence})
            </button>
          </div>

          <div className="w-full sm:w-64">
            <Input
              label="Tìm kiếm khoản chi"
              placeholder="Lọc nội dung, người nhận..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {filteredExpenses.length > 0 ? (
          <Table caption="Actual Cost theo dòng IC và người nhận">
            <thead>
              <tr>
                <th scope="col">Khoản chi</th>
                <th scope="col">IC nguồn</th>
                <th scope="col">Người nhận / NCC</th>
                <th scope="col" className="text-right">AC gồm VAT</th>
                <th scope="col" className="text-right">Chênh lệch (Variance)</th>
                <th scope="col" className="text-center">Chứng từ</th>
                <th scope="col" className="text-center w-24">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map(expense => {
                const sourceRevision = finance.data.revisions.find(r => r.id === expense.revisionId);
                const sourceLine = sourceRevision?.lines.find(l => l.id === expense.lineId);
                const variance = Number(expense.cost.gross) - Number(sourceLine?.cost?.gross ?? 0);
                const isOverBudget = variance > 0;
                const isUnderBudget = variance < 0;
                const hasFullEvidence = !!(expense.invoiceId && expense.paymentProofId);

                return (
                  <tr key={expense.id}>
                    <td>
                      <strong className="text-sm text-[var(--foreground)] block">
                        {expense.description}
                      </strong>
                      <span className="text-xs text-[var(--text-secondary)]">
                        {expense.input.quantity} × {expense.input.unitPrice} ({expense.input.basis}) · VAT {expense.input.vatPercent}%
                      </span>
                    </td>
                    <td>
                      <span className="text-xs font-semibold text-[var(--foreground)]">
                        IC-R{sourceRevision?.number ?? "—"}
                      </span>
                      <p className="text-xs text-[var(--text-secondary)] truncate max-w-[180px]" title={sourceLine?.description}>
                        {sourceLine?.description ?? expense.lineId}
                      </p>
                    </td>
                    <td>
                      <span className="text-sm font-medium text-[var(--foreground)]">
                        {recipientName(expense.recipientKey)}
                      </span>
                    </td>
                    <td className="text-right tabular-nums font-mono font-semibold text-sm">
                      {displayMoney(expense.cost.gross)}
                    </td>
                    <td className="text-right tabular-nums font-mono text-sm">
                      {sourceLine ? (
                        <span className={isOverBudget ? "text-rose-600 dark:text-rose-400 font-semibold" : isUnderBudget ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--text-secondary)]"}>
                          {isOverBudget ? `+${displayMoney(String(variance))}` : isUnderBudget ? `-${displayMoney(String(Math.abs(variance)))}` : "Khớp 0 đ"}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      <Badge tone={hasFullEvidence ? "success" : "warning"}>
                        {hasFullEvidence ? "Đủ chứng từ" : "Còn thiếu"}
                      </Badge>
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Evidence preview links */}
                        {[expense.invoiceId, expense.paymentProofId].filter(Boolean).map(id => (
                          <Link
                            key={id}
                            className="tf-link text-xs p-1 rounded hover:bg-[var(--surface-soft)]"
                            href={`/api/projects/${finance.project.id}/costflow/evidence/${id}`}
                            title="Xem chứng từ"
                            target="_blank"
                          >
                            <Paperclip size={13} aria-hidden="true" />
                          </Link>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="Chưa có khoản chi Actual Cost nào"
            description={
              effective
                ? "Bấm nút 'Ghi chi phí AC phát sinh' ở góc trên để ghi nhận chi phí thực tế theo các dòng IC."
                : "Cần phê duyệt IC trước để làm baseline ghi nhận chi phí phát sinh."
            }
          />
        )}
      </Panel>

      {/* 4. DETAILS DRAWER / ACCORDION CHO SỬA VÀ BỔ SUNG CHỨNG TỪ */}
      {filteredExpenses.length > 0 && canCreate && !finance.data.closed && (
        <details className="rounded-xl border border-[var(--border)] p-4 bg-[var(--surface)]">
          <summary className="font-semibold text-sm cursor-pointer text-[var(--foreground)] flex items-center justify-between">
            <span>Quản lý & Trình sửa chi phí cho từng khoản</span>
            <span className="text-xs text-[var(--text-secondary)] font-normal">Mở để sửa chi phí hoặc bổ sung hóa đơn</span>
          </summary>
          <div className="mt-4 space-y-4 pt-3 border-t border-[var(--border)]/60">
            {filteredExpenses.map(expense => (
              <div key={`manage-${expense.id}`} className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-sm text-[var(--foreground)]">{expense.description}</h4>
                    <p className="text-xs text-[var(--text-secondary)]">Số tiền: {displayMoney(expense.cost.gross)} · {recipientName(expense.recipientKey)}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-[var(--border)]/60">
                  {/* Bổ sung chứng từ */}
                  <div className="p-3 rounded bg-[var(--surface)] border border-[var(--border)]">
                    <p className="font-semibold text-xs text-[var(--foreground)] mb-2">Bổ sung chứng từ</p>
                    <ActionForm finance={finance} command="EXPENSE_EVIDENCE" label="Lưu chứng từ">
                      <input type="hidden" name="expenseId" value={expense.id} />
                      <Select label="Hóa đơn VAT" name="invoiceFileId" defaultValue={expense.invoiceId ?? ""}>
                        <option value="">Chọn file hóa đơn đã tải</option>
                        {finance.files.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </Select>
                      <Select label="Bằng chứng thanh toán" name="paymentFileId" defaultValue={expense.paymentProofId ?? ""}>
                        <option value="">Chọn file UNC / Phiếu chi</option>
                        {finance.files.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </Select>
                    </ActionForm>
                  </div>

                  {/* Đề nghị sửa chi phí */}
                  <div className="p-3 rounded bg-[var(--surface)] border border-[var(--border)]">
                    <p className="font-semibold text-xs text-[var(--foreground)] mb-2">Đề nghị sửa chi phí (Trình duyệt lại)</p>
                    <ActionForm finance={finance} command="REVISE_EXPENSE" label="Gửi bản sửa">
                      <input type="hidden" name="expenseId" value={expense.id} />
                      <Input name="title" label="Tên bản sửa" defaultValue={`Sửa ${expense.description}`} required />
                      <Textarea name="explanation" label="Lý do sửa chi phí" placeholder="Nêu rõ lý do thay đổi số tiền hoặc nhà cung cấp..." required />
                    </ActionForm>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
