"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import {
  Lock,
  Building2,
  User,
  History,
  XCircle,
  ShieldCheck,
  Clock,
  ArrowDownLeft,
  ShieldAlert,
  FileText,
  Coins,
} from "lucide-react";
import type { Finance, Request } from "@/components/CostFlowPanel";
import type { RequestPayload } from "@/lib/costflow/types";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";
import ActionForm from "@/components/CostFlowActionForm";
import CashConfirmationEditor from "@/components/costflow/payments/CashConfirmationEditor";
import PaymentLedgerTable from "@/components/costflow/payments/PaymentLedgerTable";
import { reconcile, isExpenseApproved } from "@/lib/costflow/reconciliation";
import { displayMoney } from "@/lib/costflow/money";

import { ACTION_LABELS as ACTION_LABEL, recipientDisplayName } from "@/lib/costflow/labels";

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
};

export default function SettlementPanel({ finance, user, canCreate }: Props) {
  // Modal states for Cash confirmation & Direct cash entries
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [selectedDisbursementReq, setSelectedDisbursementReq] = useState<Request | null>(null);
  const [cashDirection, setCashDirection] = useState<"OUT" | "IN">("OUT");

  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  const recipientName = (key: string) =>
    recipientDisplayName(key, usersMap, finance.data.beneficiaries);

  // Cash statistics & Pending disbursements
  const cashStats = useMemo(() => {
    let outTotal = 0;
    let inTotal = 0;
    finance.cash.forEach(c => {
      const amt = parseFloat(c.amount) || 0;
      if (c.direction === "IN") inTotal += amt;
      else outTotal += amt;
    });

    const pendingDisbursements = finance.requests.filter(
      r => r.state === "APPROVED" &&
           ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(r.kind) &&
           (finance.paymentDossiers?.find(dossier => dossier.requestId === r.id)?.recipients.some(recipient => recipient.progress !== "DA_CHI_DU") ?? !finance.cash.some(c => c.requestId === r.id))
    );

    return {
      outTotal,
      inTotal,
      netTotal: outTotal - inTotal,
      pendingCount: pendingDisbursements.length,
      pendingDisbursements
    };
  }, [finance.cash, finance.paymentDossiers, finance.requests]);

  // Multi-party reconciliation ledger
  const ledger = useMemo(() => {
    return reconcile(finance.data, finance.cash);
  }, [finance.data, finance.cash]);

  // Reconciliation summary
  const summary = useMemo(() => {
    let totalGross = 0;
    let totalPaid = 0;
    let totalRefunded = 0;
    let balancedCount = 0;
    let pendingCount = 0;

    ledger.forEach(row => {
      totalGross += parseFloat(row.actualGross) || 0;
      totalPaid += parseFloat(row.paid) || 0;
      totalRefunded += parseFloat(row.refunded) || 0;
      if (!row.payable && !row.receivable) balancedCount++;
      else pendingCount++;
    });

    const isAllBalanced = ledger.length > 0 && pendingCount === 0;

    return {
      totalGross,
      totalPaid,
      totalRefunded,
      balancedCount,
      pendingCount,
      isAllBalanced
    };
  }, [ledger]);

  // Approved requests with no cash transactions (can be cancelled)
  const cancellableRequests = useMemo(() => {
    return finance.requests.filter(
      r => r.state === "APPROVED" && !finance.cash.some(c => c.requestId === r.id)
    );
  }, [finance.requests, finance.cash]);

  const canManageCash = ["ADMIN", "ACCOUNT"].includes(user.role);

  const handleOpenDisbursementModal = (req: Request) => {
    setSelectedDisbursementReq(req);
    setCashDirection("OUT");
    setCashModalOpen(true);
  };

  const handleOpenDirectCashModal = (dir: "OUT" | "IN") => {
    setSelectedDisbursementReq(null);
    setCashDirection(dir);
    setCashModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER & METRICS */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
              Tiền & Quyết toán
            </h2>
            <Badge tone={finance.data.closed ? "neutral" : "success"}>
              {finance.data.closed ? "Tài chính đã đóng" : "Tài chính đang mở"}
            </Badge>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Theo dõi sổ quỹ thực tế, giải ngân hồ sơ duyệt và đối soát công nợ theo người nhận/NCC.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canManageCash && !finance.data.closed && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleOpenDirectCashModal("IN")}
            >
              <ArrowDownLeft size={14} className="mr-1 text-[var(--success)]" aria-hidden="true" />
              Ghi nhận thu hoàn quỹ
            </Button>
          )}
        </div>
      </div>

      {/* KPI METRICS (SUMMARY STRIP) */}
      <div className="tf-summary-strip">
        <div className="tf-summary-item">
          <span className="tf-summary-label">Tổng chi phí AC (Gross)</span>
          <span className="tf-summary-value">{displayMoney(Math.round(summary.totalGross).toString())}</span>
          <span className="tf-summary-hint">Nghĩa vụ chi phí đã ghi nhận</span>
        </div>
        <div className="tf-summary-item">
          <span className="tf-summary-label">Thực chi từ quỹ</span>
          <span className="tf-summary-value text-rose-600 dark:text-rose-400">{displayMoney(Math.round(cashStats.outTotal).toString())}</span>
          <span className="tf-summary-hint">{finance.cash.filter(c => c.direction === "OUT").length} giao dịch xuất tiền</span>
        </div>
        <div className="tf-summary-item">
          <span className="tf-summary-label">Thu hoàn vào quỹ</span>
          <span className="tf-summary-value text-[var(--success)]">{displayMoney(Math.round(cashStats.inTotal).toString())}</span>
          <span className="tf-summary-hint">{finance.cash.filter(c => c.direction === "IN").length} giao dịch nhập quỹ</span>
        </div>
        <div className="tf-summary-item">
          <span className="tf-summary-label">Chờ giải ngân</span>
          <span className="tf-summary-value text-amber-600 dark:text-amber-400">{cashStats.pendingCount} hồ sơ</span>
          <span className="tf-summary-hint">Đã duyệt 3 cấp, chưa xuất tiền</span>
        </div>
      </div>

      {/* 2. SECTION: HỒ SƠ ĐÃ DUYỆT CHỜ GIẢI NGÂN (PENDING DISBURSEMENTS) */}
      {cashStats.pendingDisbursements.length > 0 && (
        <Panel className="space-y-4 border-[var(--warning)] bg-[var(--warning-soft)]/40">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]/60">
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-[var(--warning)]" aria-hidden="true" />
              <h3 className="font-bold text-sm text-[var(--foreground)]">
                Hồ sơ đã duyệt đang chờ giải ngân ({cashStats.pendingDisbursements.length})
              </h3>
            </div>
            <span className="text-xs text-[var(--text-secondary)]">
              Account được phân công xác nhận khi tiền đã chuyển thực tế
            </span>
          </div>

          <div className="divide-y divide-[var(--border)]">
            {cashStats.pendingDisbursements.map(req => {
              const reqPayload = req.payload as RequestPayload;
              const reqExpenseIds = reqPayload?.expenseIds;
              const targetExpenses = finance.data.expenses.filter(e =>
                reqExpenseIds?.length
                  ? reqExpenseIds.includes(e.id)
                  : (req.kind === "REIMBURSEMENT" && e.recipientKey === reqPayload?.recipientKey)
              );
              const isBlockedByPendingAc = targetExpenses.length > 0 && targetExpenses.some(e => !isExpenseApproved(e));

              return (
                <div key={req.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-[var(--foreground)]">{req.title}</p>
                      <Badge tone={isBlockedByPendingAc ? "warning" : "success"}>
                        {isBlockedByPendingAc ? "Chờ duyệt AC (Chưa thể giải ngân)" : "Đã duyệt AC (Đủ điều kiện chi)"}
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Người đề nghị: <strong>{usersMap.get(req.creatorId) ?? "Người lập"}</strong> ·
                      Người nhận: <strong>{recipientName(req.payload.recipientKey || "")}</strong> ·
                      Số tiền: <strong className="text-[var(--foreground)]">{req.payload.amount ? displayMoney(req.payload.amount) : "Theo đối soát"}</strong>
                    </p>
                    {isBlockedByPendingAc && (
                      <span className="text-xs text-amber-700 dark:text-amber-400 block font-medium">
                        ⚠ Cần duyệt AC đầy đủ (hoặc duyệt ngoại lệ) cho các khoản chi trước khi Kế toán / Thủ quỹ chi tiền.
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isBlockedByPendingAc ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled
                        className="text-xs opacity-60 cursor-not-allowed"
                        title="Phiếu chưa có hiệu lực chi vì AC tương ứng chưa được phê duyệt đầy đủ"
                      >
                        <ShieldAlert size={13} className="mr-1 text-amber-600" />
                        Chưa có hiệu lực chi
                      </Button>
                    ) : (
                      canManageCash && req.cashAssigneeId === user.id && !finance.data.closed && (
                        <Button
                          size="sm"
                          onClick={() => handleOpenDisbursementModal(req)}
                        >
                          <Coins size={14} className="mr-1" aria-hidden="true" />
                          Xác nhận chi tiền (Giải ngân)
                        </Button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* 3. SECTION: SỔ QUỸ & LỊCH SỬ GIAO DỊCH TIỀN THỰC TẾ (CASHBOOK) */}
      <Panel className="space-y-4">
        <div><h3 className="font-bold text-base text-[var(--foreground)]">Đối soát theo hồ sơ và người nhận</h3><p className="text-xs text-[var(--text-secondary)] mt-0.5">Các trục duyệt, xác minh NCC, tiền thật, AC và đóng tài chính được hiển thị riêng.</p></div>
        <PaymentLedgerTable projectId={finance.project.id} rows={finance.paymentLedger ?? []} />
      </Panel>

      <Panel className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base text-[var(--foreground)]">
              Sổ quỹ giao dịch tiền thực tế (Cashbook)
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Ghi nhận đầy đủ chứng từ chuyển khoản, số phiếu thu/chi và người nhận tiền từ quỹ dự án.
            </p>
          </div>
          <Badge tone="neutral">{finance.cash.length} giao dịch</Badge>
        </div>

        {finance.cash.length > 0 ? (
          <Table caption="Danh sách các giao dịch tiền thực tế">
            <thead>
              <tr>
                <th scope="col" className="w-32">Mã tham chiếu</th>
                <th scope="col">Người nhận / Thụ hưởng</th>
                <th scope="col" className="w-28 text-center">Luồng tiền</th>
                <th scope="col" className="w-40 text-right">Số tiền thực tế</th>
                <th scope="col" className="w-32 text-center">Chứng từ đính kèm</th>
              </tr>
            </thead>
            <tbody>
              {finance.cash.map(c => {
                const isRefund = c.direction === "IN";
                return (
                  <tr key={c.id}>
                    <td className="font-mono text-xs font-semibold text-[var(--foreground)]">
                      {c.reference}
                    </td>
                    <td>
                      <span className="font-medium text-sm text-[var(--foreground)]">
                        {recipientName(c.recipientKey)}
                      </span>
                    </td>
                    <td className="text-center">
                      <Badge tone={isRefund ? "success" : "danger"}>
                        {isRefund ? "Thu hoàn" : "Chi tiền"}
                      </Badge>
                    </td>
                    <td className="text-right tabular-nums font-mono font-bold text-sm">
                      <span className={isRefund ? "text-[var(--success)]" : "text-rose-600 dark:text-rose-400"}>
                        {isRefund ? "+" : "-"}{displayMoney(c.amount)}
                      </span>
                    </td>
                    <td className="text-center">
                      {c.evidenceId ? (
                        <Link
                          className="tf-link text-xs inline-flex items-center gap-1"
                          href={`/api/projects/${finance.project.id}/costflow/evidence/${c.evidenceId}`}
                          target="_blank"
                        >
                          <FileText size={12} aria-hidden="true" />
                          <span>Xem chứng từ</span>
                        </Link>
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="Chưa có giao dịch tiền nào"
            description="Các giao dịch tiền sẽ được ghi nhận sau khi Kế toán/Thủ quỹ xác nhận đã chi hoặc thu hoàn cho hồ sơ đã duyệt."
          />
        )}
      </Panel>

      {/* 4. SECTION: BẢNG ĐỐI SOÁT ĐA CHIỀU (RECONCILIATION LEDGER) */}
      <Panel className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base text-[var(--foreground)]">
              Bảng đối soát đa chiều (Reconciliation Ledger)
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Cân đối độc lập từng tài khoản nội bộ và NCC; đối chiếu giữa nghĩa vụ chi phí AC và dòng tiền thực tế.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)]">
              Tiến độ: <strong>{summary.balancedCount}/{ledger.length}</strong> đối tượng
            </span>
            <Badge tone={summary.isAllBalanced ? "success" : "warning"}>
              {summary.isAllBalanced ? "Đã đối soát hoàn tất" : "Đang xử lý cân đối"}
            </Badge>
          </div>
        </div>

        {ledger.length > 0 ? (
          <Table caption="Đối soát riêng từng người nhận / NCC">
            <thead>
              <tr>
                <th scope="col">Người nhận / Nhà cung cấp</th>
                <th scope="col" className="text-right">Chi phí gồm VAT</th>
                <th scope="col" className="text-right">Đã thực chi</th>
                <th scope="col" className="text-right">Đã thu hoàn</th>
                <th scope="col" className="text-right">Số dư công nợ</th>
                <th scope="col" className="text-center w-36">Tình trạng đối soát</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map(row => {
                const isInternal = row.recipientKey.startsWith("USER:");
                const isBalanced = !row.payable && !row.receivable;

                return (
                  <tr key={row.recipientKey}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="p-1 rounded bg-[var(--surface-soft)] text-[var(--text-secondary)]">
                          {isInternal ? <User size={13} aria-hidden="true" /> : <Building2 size={13} aria-hidden="true" />}
                        </div>
                        <div>
                          <strong className="text-sm text-[var(--foreground)] block">
                            {recipientName(row.recipientKey)}
                          </strong>
                          <span className="text-[11px] text-[var(--text-secondary)]">
                            {isInternal ? "Nhân viên phụ trách" : "Nhà cung cấp đối tác"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="text-right tabular-nums font-mono text-sm">
                      {displayMoney(row.actualGross)}
                    </td>
                    <td className="text-right tabular-nums font-mono text-sm text-rose-600 dark:text-rose-400">
                      {displayMoney(row.paid)}
                    </td>
                    <td className="text-right tabular-nums font-mono text-sm text-emerald-600 dark:text-emerald-400">
                      {displayMoney(row.refunded)}
                    </td>
                    <td className="text-right tabular-nums font-mono font-bold text-sm">
                      {displayMoney(row.balance)}
                    </td>
                    <td className="text-center">
                      <Badge tone={isBalanced ? "success" : row.payable ? "warning" : "info"}>
                        {isBalanced ? "Đã khớp 100%" : row.payable ? "Còn phải trả" : "Cần thu hoàn"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title="Chưa có dữ liệu đối soát"
            description="Bảng đối soát sẽ tự động tổng hợp khi có phát sinh Actual Cost hoặc giao dịch tiền thực tế."
          />
        )}
      </Panel>

      {/* 5. SECTION: QUY TRÌNH ĐÓNG / MỞ TÀI CHÍNH DỰ ÁN */}
      {finance.fullAccess && (
        <Panel className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              {finance.data.closed ? (
                <Lock size={18} className="text-zinc-600 dark:text-zinc-400" aria-hidden="true" />
              ) : (
                <ShieldCheck size={18} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              )}
              <h3 className="font-bold text-base text-[var(--foreground)]">
                {finance.data.closed ? "Yêu cầu mở lại tài chính dự án" : "Yêu cầu đóng tài chính dự án"}
              </h3>
            </div>
            <Badge tone={finance.data.closed ? "neutral" : "success"}>
              {finance.data.closed ? "Đã đóng" : "Đang mở"}
            </Badge>
          </div>

          {!finance.data.closed && !summary.isAllBalanced && (
            <Alert tone="warning" title="Lưu ý trước khi đóng tài chính">
              Dự án hiện vẫn còn {summary.pendingCount} đối tượng chưa hoàn tất cân đối số dư công nợ. Hãy kiểm tra kỹ trước khi trình Quản lý đóng tài chính.
            </Alert>
          )}

          <ActionForm
            finance={finance}
            command="CREATE_REQUEST"
            label={finance.data.closed ? "Gửi yêu cầu mở lại tài chính" : "Gửi yêu cầu đóng tài chính"}
          >
            <input type="hidden" name="kind" value={finance.data.closed ? "REOPEN" : "CLOSE"} />
            <Input
              name="title"
              label="Tên yêu cầu"
              defaultValue={finance.data.closed ? "Mở lại tài chính dự án" : "Đóng tài chính dự án"}
              required
            />
            <Textarea
              name="explanation"
              label="Lý do / Giải trình"
              placeholder={
                finance.data.closed
                  ? "Nêu lý do cần mở lại (phát sinh chi phí bổ sung, điều chỉnh chứng từ...)"
                  : "Xác nhận đối soát hoàn tất, đủ chứng từ và đề nghị khóa sổ dự án..."
              }
              required
            />
          </ActionForm>
        </Panel>
      )}

      {/* 6. SECTION: YÊU CẦU HỦY HỒ SƠ ĐÃ DUYỆT, CHƯA CHI */}
      {canCreate && !finance.data.closed && cancellableRequests.length > 0 && (
        <details className="rounded-xl border border-[var(--border)] p-4 bg-[var(--surface)]">
          <summary className="font-semibold text-sm cursor-pointer text-[var(--foreground)] flex items-center justify-between">
            <span className="flex items-center gap-2">
              <XCircle size={16} className="text-rose-500" aria-hidden="true" />
              <span>Yêu cầu hủy hồ sơ đã duyệt, chưa chi ({cancellableRequests.length})</span>
            </span>
            <span className="text-xs text-[var(--text-secondary)] font-normal">Hủy an toàn các hồ sơ chưa giải ngân tiền</span>
          </summary>
          <div className="mt-4 pt-3 border-t border-[var(--border)]/60">
            <ActionForm finance={finance} command="CREATE_REQUEST" label="Gửi yêu cầu hủy">
              <input type="hidden" name="kind" value="CANCEL" />
              <Input name="title" label="Tên yêu cầu hủy" placeholder="Ví dụ: Hủy đề nghị tạm ứng số..." required />
              <Select name="targetRequestId" label="Chọn hồ sơ cần hủy" required>
                <option value="">Chọn hồ sơ trong danh sách đã duyệt</option>
                {cancellableRequests.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.payload.amount ? displayMoney(r.payload.amount) : "Chưa ghi số"})
                  </option>
                ))}
              </Select>
              <Textarea name="explanation" label="Lý do hủy hồ sơ" placeholder="Nêu rõ lý do không thực hiện chi tiền..." required />
            </ActionForm>
          </div>
        </details>
      )}

      {/* 7. SECTION: SỔ NHẬT KÝ KIỂM TOÁN (AUDIT HISTORY TIMELINE) */}
      <Panel className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History size={18} className="text-[var(--text-secondary)]" aria-hidden="true" />
            <h3 className="font-bold text-base text-[var(--foreground)]">
              Nhật ký kiểm toán tài chính ({finance.history.length})
            </h3>
          </div>
          <span className="text-xs text-[var(--text-secondary)]">Bảo toàn 100% lịch sử các phiên bản</span>
        </div>

        {finance.history.length > 0 ? (
          <div className="divide-y divide-[var(--border)] max-h-96 overflow-y-auto pr-1">
            {finance.history.map(h => (
              <div key={h.id} className="py-2.5 flex items-center justify-between text-xs gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface-soft)] border border-[var(--border)]">
                    v{h.version}
                  </span>
                  <span className="font-semibold text-[var(--foreground)]">
                    {ACTION_LABEL[h.action] ?? h.action}
                  </span>
                  <span className="text-[var(--text-secondary)]">bởi</span>
                  <span className="font-medium text-[var(--foreground)]">
                    {usersMap.get(h.actorId) ?? "Người xử lý"}
                  </span>
                </div>
                <span className="text-[11px] text-[var(--text-secondary)] shrink-0">
                  {new Date(h.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-secondary)] italic">
            Chưa có lịch sử thay đổi phiên bản.
          </p>
        )}
      </Panel>

      {/* DIALOG XÁC NHẬN TIỀN THỰC TẾ (CASH MODAL) */}
      <Dialog
        open={cashModalOpen}
        onClose={() => setCashModalOpen(false)}
        title={
          selectedDisbursementReq
            ? `Xác nhận giải ngân: ${selectedDisbursementReq.title}`
            : cashDirection === "IN"
            ? "Ghi nhận tiền thu hoàn vào quỹ"
            : "Ghi nhận chi tiền thực tế"
        }
        description={
          selectedDisbursementReq
            ? "Ghi nhận tiền đã chuyển khoản thực tế cho hồ sơ đã duyệt 3 cấp. Dữ liệu sẽ cập nhật vào Sổ quỹ và Bảng đối soát công nợ."
            : "Ghi nhận trực tiếp khoản thu/chi thực tế từ quỹ dự án."
        }
      >
        {selectedDisbursementReq ? (() => {
          const dossier = finance.paymentDossiers?.find(item => item.requestId === selectedDisbursementReq.id);
          if (!dossier) return <Alert tone="danger" title="Hồ sơ chưa có dữ liệu dòng thanh toán chuẩn hóa." />;
          return <div className="space-y-4">{dossier.recipients.map(recipient => <CashConfirmationEditor key={recipient.recipientKey} finance={finance} request={selectedDisbursementReq} dossier={dossier} recipient={recipient} userId={user.id} onSuccess={() => setCashModalOpen(false)} />)}</div>;
        })() : <Alert tone="warning" title="Thu hoàn sau AC chưa khả dụng cho đến khi Phase 8 cung cấp AC đã duyệt." />}
      </Dialog>
    </div>
  );
}
