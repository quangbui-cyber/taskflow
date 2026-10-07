"use client";

import { useMemo } from "react";
import {
  Scale,
  Lock,
  Unlock,
  Building2,
  User,
  History,
  XCircle,
  TrendingDown,
  TrendingUp,
  FileSpreadsheet,
  ShieldCheck
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import ActionForm from "@/components/CostFlowActionForm";
import { reconcile } from "@/lib/costflow/reconciliation";
import { displayMoney } from "@/lib/costflow/money";

const ACTION_LABEL: Record<string, string> = {
  APPROVE: "Duyệt",
  RETURN: "Trả hồ sơ",
  REJECT: "Từ chối",
  WITHDRAW: "Rút hồ sơ",
  CONFIGURE: "Phân công",
  ADD_PO: "Thêm PO",
  ADD_BRIEF: "Thêm Brief",
  SAVE_QUOTATION: "Lưu phiên bản báo giá",
  SAVE_IC: "Lưu IC nháp",
  SUBMIT: "Gửi duyệt",
  BENEFICIARY: "Cập nhật người thụ hưởng",
  EXPENSE: "Ghi chi phí AC",
  EXPENSE_EVIDENCE: "Bổ sung chứng từ",
  REVISE_EXPENSE: "Trình bản sửa chi phí",
  CREATE_REQUEST: "Lập hồ sơ",
  DECIDE: "Ghi quyết định",
  TRANSFER: "Chuyển giao",
  CASH: "Xác nhận tiền thực tế"
};

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
};

export default function SettlementPanel({ finance, canCreate }: Props) {
  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  const recipientName = (key: string) =>
    key.startsWith("USER:")
      ? usersMap.get(key.slice(5)) ?? "Nhân viên"
      : finance.data.beneficiaries.find(b => b.id === key.slice(7))?.name ?? "NCC";

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

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER & METRICS */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
              Quyết toán & Đối soát công nợ
            </h2>
            <Badge tone={finance.data.closed ? "neutral" : "success"}>
              {finance.data.closed ? "Tài chính đã đóng" : "Tài chính đang mở"}
            </Badge>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Đối soát đa chiều độc lập theo từng người nhận/NCC giữa chi phí AC, tiền đã chi và tiền hoàn trả.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {finance.data.closed ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              <Lock size={14} aria-hidden="true" />
              Sổ tài chính đã khóa
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <Unlock size={14} aria-hidden="true" />
              Cho phép phát sinh & quyết toán
            </span>
          )}
        </div>
      </div>

      {/* KPI METRICS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Tổng chi phí AC</span>
            <FileSpreadsheet size={16} className="text-blue-600 dark:text-blue-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-[var(--foreground)] mt-2">
            {displayMoney(Math.round(summary.totalGross).toString())}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Nghĩa vụ chi phí đã ghi nhận
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Thực chi đã thanh toán</span>
            <TrendingDown size={16} className="text-rose-600 dark:text-rose-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400 mt-2">
            {displayMoney(Math.round(summary.totalPaid).toString())}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Đã chuyển khoản thực tế
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Thu hồi / Hoàn quỹ</span>
            <TrendingUp size={16} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-2">
            {displayMoney(Math.round(summary.totalRefunded).toString())}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Đã nhập lại quỹ dự án
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Tiến độ đối soát</span>
            <Scale size={16} className="text-purple-600 dark:text-purple-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-[var(--foreground)] mt-2">
            {summary.balancedCount}/{ledger.length}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {summary.pendingCount > 0 ? `Còn ${summary.pendingCount} đối tượng chưa khớp` : "Đã khớp 100% đối tượng"}
          </span>
        </div>
      </div>

      {/* 2. RECONCILIATION LEDGER TABLE */}
      <Panel className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base text-[var(--foreground)]">
              Bảng đối soát đa chiều (Reconciliation Ledger)
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Cân đối độc lập từng tài khoản nội bộ và NCC; tách biệt giữa nghĩa vụ chi phí và dòng tiền thực tế.
            </p>
          </div>
          <Badge tone={summary.isAllBalanced ? "success" : "warning"}>
            {summary.isAllBalanced ? "Đã đối soát hoàn tất" : "Đang xử lý cân đối"}
          </Badge>
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

      {/* 3. QUY TRÌNH ĐÓNG / MỞ TÀI CHÍNH DỰ ÁN */}
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

      {/* 4. YÊU CẦU HỦY HỒ SƠ ĐÃ DUYỆT, CHƯA CHI */}
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

      {/* 5. SỔ NHẬT KÝ KIỂM TOÁN (AUDIT HISTORY TIMELINE) */}
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
    </div>
  );
}
