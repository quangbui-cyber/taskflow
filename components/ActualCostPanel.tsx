"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Wallet,
  AlertCircle,
  CheckCircle2,
  Plus,
  Layers3,
  Paperclip,
  Users,
  Receipt,
  ArrowRight,
  Search,
  ChevronDown,
  ChevronRight,
  Coins,
  RotateCcw,
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Alert, Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import { reconcile, margin } from "@/lib/costflow/reconciliation";
import type { Expense } from "@/lib/costflow/types";
import ExpenseUploadModal from "@/components/ExpenseUploadModal";
import ExpenseDetailDrawer from "@/components/ExpenseDetailDrawer";

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
  onSelectTab?: (tab: string) => void;
};

type ViewMode = "by-line" | "by-member" | "all-expenses";

export default function ActualCostPanel({ finance, user, canCreate, onSelectTab }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("by-member");
  const [search, setSearch] = useState("");
  const [evidenceFilter, setEvidenceFilter] = useState<"ALL" | "COMPLETE" | "MISSING" | "EXCEPTION">("ALL");
  const [selectedMemberFilter, setSelectedMemberFilter] = useState<string>("ALL");

  // Expanded IC lines in accordion view
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});

  // Modal & Drawer states
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [preselectedLineId, setPreselectedLineId] = useState<string | undefined>();
  const [preselectedRecipientKey, setPreselectedRecipientKey] = useState<string | undefined>();

  const [selectedExpenseForDrawer, setSelectedExpenseForDrawer] = useState<Expense | null>(null);

  const effective = finance.data.revisions.find(r => r.effective);
  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  // Project members can report expenses
  const isProjectMember = finance.fullAccess;

  const recipientName = useCallback((key: string) =>
    key.startsWith("USER:")
      ? usersMap.get(key.slice(5)) ?? "Nhân viên"
      : finance.data.beneficiaries.find(b => b.id === key.slice(7))?.name ?? "NCC",
    [finance.data.beneficiaries, usersMap]
  );

  const getMemberRoleLabel = useCallback((uId: string, role: string) => {
    if (uId === finance.project.ownerId) return "Project Owner / Account Lead";
    if (uId === finance.data.config.accountantId) return "Kế toán phụ trách";
    if (uId === finance.data.config.managerId) return "Quản lý dự án";
    if (role === "ACCOUNT") return "Account (Quản lý dự án)";
    if (role === "ADMIN") return "Admin";
    return "Thành viên dự án";
  }, [finance.project.ownerId, finance.data.config.accountantId, finance.data.config.managerId]);

  const handleCreateReimbursement = useCallback((recipientKey: string) => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "approvals");
      url.searchParams.set("kind", "REIMBURSEMENT");
      url.searchParams.set("recipientKey", recipientKey);
      window.history.pushState(null, "", url.toString());
      if (onSelectTab) onSelectTab("approvals");
    }
  }, [onSelectTab]);

  // Reconciliation data per recipient
  const reconciliationRows = useMemo(() => {
    return reconcile(finance.data, finance.cash);
  }, [finance.data, finance.cash]);

  const reconciliationMap = useMemo(() => {
    return new Map(reconciliationRows.map(r => [r.recipientKey, r]));
  }, [reconciliationRows]);

  // Overall statistics
  const stats = useMemo(() => {
    let totalGross = 0;
    let completeEvidence = 0;
    let missingEvidence = 0;
    let exceptionPending = 0;
    let exceptionApproved = 0;

    finance.data.expenses.forEach(e => {
      totalGross += parseFloat(e.cost.gross) || 0;
      if (e.invoiceId && e.paymentProofId) {
        completeEvidence++;
      } else if (e.exceptionStatus === "APPROVED") {
        exceptionApproved++;
        completeEvidence++;
      } else if (e.exceptionReason) {
        exceptionPending++;
        missingEvidence++;
      } else {
        missingEvidence++;
      }
    });

    // Advance funding disbursed (cash OUT)
    const totalDisbursedAdvance = finance.cash
      .filter(c => c.direction === "OUT")
      .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

    const totalRefunded = finance.cash
      .filter(c => c.direction === "IN")
      .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

    const effectiveAdvance = totalDisbursedAdvance - totalRefunded;
    const projectBalance = totalGross - effectiveAdvance;

    const marginData = margin(finance.data);

    return {
      count: finance.data.expenses.length,
      totalGross,
      completeEvidence,
      missingEvidence,
      exceptionPending,
      exceptionApproved,
      totalDisbursedAdvance,
      effectiveAdvance,
      projectBalance,
      marginData,
    };
  }, [finance.data, finance.cash]);

  // Per-member summary cards data
  const memberSummaries = useMemo(() => {
    return finance.project.members.map(member => {
      const uId = member.userId;
      const key = `USER:${uId}`;
      const name = usersMap.get(uId) ?? "Nhân viên";
      const userExpenses = finance.data.expenses.filter(e => e.recipientKey === key);

      let memberGross = 0;
      let memberComplete = 0;
      let memberMissing = 0;

      userExpenses.forEach(e => {
        memberGross += parseFloat(e.cost.gross) || 0;
        if ((e.invoiceId && e.paymentProofId) || e.exceptionStatus === "APPROVED") {
          memberComplete++;
        } else {
          memberMissing++;
        }
      });

      const recon = reconciliationMap.get(key);
      const paid = recon ? parseFloat(recon.paid) || 0 : 0;
      const refunded = recon ? parseFloat(recon.refunded) || 0 : 0;
      const netAdvance = paid - refunded;
      const balance = memberGross - netAdvance;

      return {
        userId: uId,
        key,
        name,
        role: finance.users.find(u => u.id === uId)?.role ?? "MEMBER",
        expensesCount: userExpenses.length,
        gross: memberGross,
        completeCount: memberComplete,
        missingCount: memberMissing,
        advancePaid: paid,
        advanceRefunded: refunded,
        netAdvance,
        balance, // balance > 0: cty nợ NV; balance < 0: NV còn giữ tiền thừa cty
        expenses: userExpenses,
      };
    });
  }, [finance.project.members, usersMap, finance.data.expenses, reconciliationMap, finance.users]);

  // Filtered expense list
  const filteredExpenses = useMemo(() => {
    return finance.data.expenses.filter(e => {
      if (evidenceFilter === "COMPLETE") {
        if (!((e.invoiceId && e.paymentProofId) || e.exceptionStatus === "APPROVED")) return false;
      }
      if (evidenceFilter === "MISSING") {
        if ((e.invoiceId && e.paymentProofId) || e.exceptionStatus === "APPROVED") return false;
      }
      if (evidenceFilter === "EXCEPTION") {
        if (!e.exceptionReason) return false;
      }

      if (selectedMemberFilter !== "ALL" && e.recipientKey !== selectedMemberFilter) {
        return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const descMatch = e.description.toLowerCase().includes(q);
        const recMatch = recipientName(e.recipientKey).toLowerCase().includes(q);
        if (!descMatch && !recMatch) return false;
      }

      return true;
    });
  }, [finance.data.expenses, evidenceFilter, selectedMemberFilter, search, recipientName]);

  const toggleLineExpand = (lineId: string) => {
    setExpandedLines(prev => ({ ...prev, [lineId]: !prev[lineId] }));
  };

  const openUploadModalWithDefaults = (lId?: string, rKey?: string) => {
    setPreselectedLineId(lId);
    setPreselectedRecipientKey(rKey);
    setUploadModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER & HERO METRICS */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
              Actual Cost (Chi phí thực tế & Tạm ứng)
            </h2>
            <Badge tone="neutral">{stats.count} khoản chi</Badge>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Theo dõi chi phí thực tế theo dòng IC ngân sách và đối soát từng khoản ứng của nhân sự dự án.
          </p>
        </div>

        {isProjectMember && !finance.data.closed && (
          <Button
            size="md"
            onClick={() => openUploadModalWithDefaults()}
            className="shadow-sm"
          >
            <Plus size={16} className="mr-1.5" aria-hidden="true" />
            Báo chi phí / Upload AC
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
            {stats.count} khoản chi đã báo (gồm VAT)
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">IC Căn cứ Ngân sách</span>
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
            <span className="font-medium">Chứng từ Hợp lệ</span>
            <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-2">
            {stats.completeEvidence} / {stats.count} khoản
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {stats.missingEvidence > 0 ? `${stats.missingEvidence} khoản cần bổ sung` : "Đầy đủ chứng từ"}
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Tạm ứng Toàn dự án</span>
            <Coins size={16} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-[var(--foreground)] mt-2">
            {displayMoney(Math.round(stats.effectiveAdvance).toString())}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {stats.projectBalance > 0
              ? `Chi vượt ứng ${displayMoney(String(stats.projectBalance))}`
              : stats.projectBalance < 0
              ? `Dư ứng ${displayMoney(String(Math.abs(stats.projectBalance)))}`
              : "Khớp 100% với AC"}
          </span>
        </div>
      </div>

      {!effective && (
        <Alert tone="warning" title="Dự án chưa có Internal Cost hiệu lực">
          Để ghi nhận chi phí phát sinh Actual Cost, dự án cần có ít nhất một phiên bản IC đã được Quản lý phê duyệt để làm baseline ngân sách.
        </Alert>
      )}

      {/* 2. NAVIGATION SUB-TABS (CHẾ ĐỘ XEM) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="flex items-center gap-1.5 p-1 bg-[var(--surface-soft)] rounded-xl border border-[var(--border)] text-xs font-medium">
          <button
            type="button"
            onClick={() => setViewMode("by-member")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              viewMode === "by-member"
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm font-semibold"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            <Users size={14} />
            <span>Theo Nhân sự & Tạm ứng ({finance.project.members.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode("by-line")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              viewMode === "by-line"
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm font-semibold"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            <Layers3 size={14} />
            <span>Theo Dòng IC ({effective?.lines.length ?? 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode("all-expenses")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
              viewMode === "all-expenses"
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm font-semibold"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            <Receipt size={14} />
            <span>Tất cả khoản chi ({stats.count})</span>
          </button>
        </div>

        {/* Global Search in AC */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            placeholder="Lọc nội dung, người nhận..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <Search size={14} className="absolute left-2.5 top-2 text-[var(--text-secondary)]" />
        </div>
      </div>

      {/* 3. SUB-VIEW: THEO NHÂN SỰ & TẠM ỨNG (MEMBER ADVANCE & EXPENSE VIEW) */}
      {viewMode === "by-member" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--foreground)]">
              Đối soát Quỹ Tạm ứng & Báo chi theo từng Thành viên dự án
            </span>
            <span>Hiển thị theo danh sách thành viên được phân công</span>
          </div>

          {/* Quy định đối soát & hiệu lực phiếu */}
          <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 text-xs text-blue-950 dark:text-blue-200 flex items-start gap-2.5">
            <AlertCircle size={16} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-[var(--foreground)]">Quy định Đối soát & Hiệu lực Phiếu thanh toán:</p>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] text-[var(--text-secondary)]">
                <li><strong>Nhân sự tự ứng tiền túi (OUT_OF_POCKET):</strong> Thu hồi qua <strong>Phiếu Đề Nghị Hoàn Tạm Ứng (ĐNHTU)</strong>.</li>
                <li><strong>Chi trả trực tiếp NCC (VENDOR_DIRECT):</strong> Thanh toán qua <strong>Phiếu Đề Nghị Thanh Toán (ĐNTT)</strong>.</li>
                <li><strong>Hiệu lực phiếu:</strong> Có thể lập ĐNHTU / ĐNTT trước trong quá trình thực hiện, nhưng <strong>chỉ có hiệu lực giải ngân thanh toán khi AC tương ứng được phê duyệt</strong>.</li>
                <li><strong>Phân định vai trò:</strong> <em>Account (Quản lý dự án)</em> lập và điều phối hồ sơ; <em>Kế toán (Accountant)</em> rà soát chứng từ, phê duyệt ngoại lệ và thực hiện chi tiền.</li>
              </ul>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {memberSummaries.map(member => {
              const isOverSpent = member.balance > 0;
              const isHoldingExcess = member.balance < 0;

              return (
                <div
                  key={member.key}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4"
                >
                  {/* Member Head */}
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-300 font-bold text-xs flex items-center justify-center">
                          {member.name.split(" ").map(w => w[0]).slice(-2).join("").toUpperCase()}
                        </div>
                        <div>
                          <span className="font-bold text-sm text-[var(--foreground)] block">
                            {member.name}
                          </span>
                          <span className="text-[11px] text-[var(--text-secondary)]">
                            {getMemberRoleLabel(member.userId, member.role)}
                          </span>
                        </div>
                      </div>

                      <Badge tone={member.balance === 0 ? "success" : isOverSpent ? "warning" : "neutral"}>
                        {member.balance === 0 ? "Đã cân bằng" : isOverSpent ? "Cần hoàn ứng (ĐNHTU)" : "Cần nộp trả (ĐNHTU)"}
                      </Badge>
                    </div>

                    {/* Member Advance & Incurred Financials */}
                    <div className="mt-4 p-3 rounded-xl bg-[var(--surface-soft)] space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-[var(--text-secondary)]">Tạm ứng đã nhận:</span>
                        <span className="font-mono font-semibold text-[var(--foreground)]">
                          {displayMoney(String(member.netAdvance))}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-[var(--text-secondary)]">Chi phí AC đã báo:</span>
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {displayMoney(String(member.gross))}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-[var(--border)] flex justify-between font-bold">
                        <span>Số dư đối soát:</span>
                        <span className={`font-mono ${isOverSpent ? "text-rose-600 dark:text-rose-400" : isHoldingExcess ? "text-amber-600 dark:text-amber-400" : "text-emerald-600"}`}>
                          {isOverSpent
                            ? `+${displayMoney(String(member.balance))} (Hoàn ứng ĐNHTU cho NV)`
                            : isHoldingExcess
                            ? `-${displayMoney(String(Math.abs(member.balance)))} (NV nộp trả cty)`
                            : "0 ₫ (Cân bằng)"}
                        </span>
                      </div>
                    </div>

                    {/* Evidence Status for this member */}
                    <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                      <span>{member.expensesCount} khoản chi đã nộp</span>
                      <span className={member.missingCount > 0 ? "text-amber-600 font-medium" : "text-emerald-600"}>
                        {member.missingCount > 0 ? `Thiếu ${member.missingCount} chứng từ` : "Đủ chứng từ"}
                      </span>
                    </div>
                  </div>

                  {/* Actions for this member */}
                  <div className="pt-3 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openUploadModalWithDefaults(undefined, member.key)}
                        className="text-xs"
                      >
                        <Plus size={13} className="mr-1" />
                        Báo chi
                      </Button>

                      {canCreate && (isOverSpent || member.expensesCount > 0) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleCreateReimbursement(member.key)}
                          className="text-xs text-[var(--primary)] font-semibold"
                          title="Lập Phiếu Hoàn tạm ứng (ĐNHTU) cho nhân sự này"
                        >
                          <RotateCcw size={13} className="mr-1" />
                          Lập Phiếu ĐNHTU
                        </Button>
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedMemberFilter(member.key);
                        setViewMode("all-expenses");
                      }}
                      className="text-xs"
                    >
                      Xem các bill
                      <ArrowRight size={13} className="ml-1" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. SUB-VIEW: THEO DÒNG IC NGÂN SÁCH (IC BUDGET VARIANCE VIEW) */}
      {viewMode === "by-line" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--foreground)]">
              So sánh Ngân sách dự toán IC vs Chi phí thực tế AC theo từng Hạng mục
            </span>
            <span>Bấm vào dòng để xem danh sách các khoản chi chi tiết</span>
          </div>

          {effective && effective.lines.length > 0 ? (
            <Panel className="p-0 overflow-hidden">
              <Table caption="So sánh IC dự toán và AC phát sinh">
                <thead>
                  <tr>
                    <th scope="col" className="w-10 text-center"></th>
                    <th scope="col">Hạng mục IC</th>
                    <th scope="col" className="text-right">Ngân sách IC</th>
                    <th scope="col" className="text-right">AC Thực tế</th>
                    <th scope="col" className="text-right">Chênh lệch (Variance)</th>
                    <th scope="col" className="text-center">Số khoản</th>
                    <th scope="col" className="text-right w-28">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {effective.lines.map(line => {
                    const lineExpenses = finance.data.expenses.filter(e => e.lineId === line.id);
                    const lineGross = lineExpenses.reduce(
                      (sum, e) => sum + (parseFloat(e.cost.gross) || 0),
                      0
                    );
                    const budgetGross = parseFloat(line.cost?.gross ?? "0") || 0;
                    const variance = lineGross - budgetGross;
                    const isExpanded = !!expandedLines[line.id];
                    const isOverBudget = variance > 0;
                    const isUnderBudget = variance < 0;

                    return (
                      <>
                        <tr
                          key={line.id}
                          className="hover:bg-[var(--surface-soft)] cursor-pointer"
                          onClick={() => toggleLineExpand(line.id)}
                        >
                          <td className="text-center">
                            {lineExpenses.length > 0 ? (
                              isExpanded ? (
                                <ChevronDown size={16} className="text-[var(--text-secondary)] inline" />
                              ) : (
                                <ChevronRight size={16} className="text-[var(--text-secondary)] inline" />
                              )
                            ) : null}
                          </td>
                          <td>
                            <strong className="text-sm font-semibold text-[var(--foreground)] block">
                              {line.description}
                            </strong>
                            <span className="text-xs text-[var(--text-secondary)]">
                              {line.quantity} {line.unit} × {displayMoney(line.unitPrice)}
                            </span>
                          </td>
                          <td className="text-right tabular-nums font-mono text-sm font-semibold">
                            {displayMoney(line.cost?.gross ?? "0")}
                          </td>
                          <td className="text-right tabular-nums font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                            {displayMoney(String(lineGross))}
                          </td>
                          <td className="text-right tabular-nums font-mono text-sm font-semibold">
                            <span className={isOverBudget ? "text-rose-600 dark:text-rose-400" : isUnderBudget ? "text-emerald-600" : "text-[var(--text-secondary)]"}>
                              {isOverBudget
                                ? `+${displayMoney(String(variance))}`
                                : isUnderBudget
                                ? `-${displayMoney(String(Math.abs(variance)))}`
                                : "Khớp 0 đ"}
                            </span>
                          </td>
                          <td className="text-center">
                            <Badge tone={lineExpenses.length > 0 ? "neutral" : "neutral"}>
                              {lineExpenses.length} khoản
                            </Badge>
                          </td>
                          <td className="text-right" onClick={e => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openUploadModalWithDefaults(line.id)}
                              className="text-xs"
                            >
                              <Plus size={13} className="mr-1" />
                              Thêm chi
                            </Button>
                          </td>
                        </tr>

                        {/* EXPANDED ACCORDION SUB-ROWS */}
                        {isExpanded && lineExpenses.length > 0 && (
                          <tr className="bg-[var(--surface-soft)]/50">
                            <td colSpan={7} className="p-3 pl-12">
                              <div className="space-y-2">
                                <div className="text-xs font-semibold text-[var(--text-secondary)]">
                                  Các khoản chi thực tế thuộc dòng &ldquo;{line.description}&rdquo;:
                                </div>
                                <div className="space-y-1.5">
                                  {lineExpenses.map(exp => (
                                    <div
                                      key={exp.id}
                                      onClick={() => setSelectedExpenseForDrawer(exp)}
                                      className="flex items-center justify-between p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)] cursor-pointer text-xs transition-colors"
                                    >
                                      <div className="flex items-center gap-2">
                                        <Paperclip size={14} className="text-[var(--text-secondary)]" />
                                        <span className="font-medium text-[var(--foreground)]">{exp.description}</span>
                                        <span className="text-[var(--text-secondary)]">· {recipientName(exp.recipientKey)}</span>
                                      </div>

                                      <div className="flex items-center gap-3">
                                        <Badge tone={exp.invoiceId && exp.paymentProofId ? "success" : "warning"}>
                                          {exp.invoiceId && exp.paymentProofId ? "Đủ chứng từ" : "Thiếu chứng từ"}
                                        </Badge>
                                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                          {displayMoney(exp.cost.gross)}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </Table>
            </Panel>
          ) : (
            <EmptyState
              title="Chưa có dòng IC hiệu lực"
              description="Dự án cần có IC hiệu lực để so sánh ngân sách và chi phí phát sinh."
            />
          )}
        </div>
      )}

      {/* 5. SUB-VIEW: TẤT CẢ KHOẢN CHI & CHỨNG TỪ (ALL EXPENSES VIEW) */}
      {viewMode === "all-expenses" && (
        <Panel className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
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
                <button
                  type="button"
                  onClick={() => setEvidenceFilter("EXCEPTION")}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    evidenceFilter === "EXCEPTION"
                      ? "bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-200 shadow-sm font-semibold"
                      : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                  }`}
                >
                  Ngoại lệ ({stats.exceptionPending + stats.exceptionApproved})
                </button>
              </div>

              {/* Filter by Member Dropdown */}
              <select
                className="h-8 px-2.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                value={selectedMemberFilter}
                onChange={e => setSelectedMemberFilter(e.target.value)}
              >
                <option value="ALL">-- Tất cả người chi --</option>
                {finance.project.members.map(m => (
                  <option key={m.userId} value={`USER:${m.userId}`}>
                    {usersMap.get(m.userId) ?? "Nhân viên"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredExpenses.length > 0 ? (
            <Table caption="Toàn bộ danh sách Actual Cost">
              <thead>
                <tr>
                  <th scope="col">Khoản chi</th>
                  <th scope="col">Dòng IC nguồn</th>
                  <th scope="col">Người chi / Nguồn</th>
                  <th scope="col" className="text-right">Số tiền Gross</th>
                  <th scope="col" className="text-center">Chứng từ</th>
                  <th scope="col" className="text-right w-24">Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map(exp => {
                  const sRev = finance.data.revisions.find(r => r.id === exp.revisionId);
                  const sLine = sRev?.lines.find(l => l.id === exp.lineId);
                  const hasFullEvidence = (exp.invoiceId && exp.paymentProofId) || exp.exceptionStatus === "APPROVED";

                  return (
                    <tr
                      key={exp.id}
                      className="hover:bg-[var(--surface-soft)] cursor-pointer"
                      onClick={() => setSelectedExpenseForDrawer(exp)}
                    >
                      <td>
                        <strong className="text-sm font-semibold text-[var(--foreground)] block">
                          {exp.description}
                        </strong>
                        <span className="text-xs text-[var(--text-secondary)]">
                          {exp.input.quantity} × {displayMoney(exp.input.unitPrice)} · VAT {exp.input.vatPercent}%
                        </span>
                      </td>

                      <td>
                        <span className="text-xs font-semibold text-[var(--foreground)]">
                          IC-R{sRev?.number ?? "—"}
                        </span>
                        <p className="text-xs text-[var(--text-secondary)] truncate max-w-[180px]" title={sLine?.description}>
                          {sLine?.description ?? exp.lineId}
                        </p>
                      </td>

                      <td>
                        <span className="text-sm font-medium text-[var(--foreground)] block">
                          {recipientName(exp.recipientKey)}
                        </span>
                        <span className="text-[11px] text-[var(--text-secondary)]">
                          {exp.fundingSource === "ADVANCE" ? "Khấu trừ tạm ứng" : exp.fundingSource === "OUT_OF_POCKET" ? "Tự chi tiền túi" : "Chi NCC"}
                        </span>
                      </td>

                      <td className="text-right font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                        {displayMoney(exp.cost.gross)}
                      </td>

                      <td className="text-center">
                        <Badge tone={hasFullEvidence ? "success" : exp.exceptionReason ? "warning" : "warning"}>
                          {hasFullEvidence
                            ? "Đủ chứng từ"
                            : exp.exceptionStatus === "APPROVED"
                            ? "Ngoại lệ duyệt"
                            : exp.exceptionReason
                            ? "Chờ duyệt ngoại lệ"
                            : "Chờ chứng từ"}
                        </Badge>
                      </td>

                      <td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedExpenseForDrawer(exp);
                          }}
                          className="text-xs"
                        >
                          Chi tiết
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState
              title="Không tìm thấy khoản chi nào"
              description="Chưa có khoản chi nào phù hợp với bộ lọc đang chọn."
              action={
                <Button size="sm" onClick={() => openUploadModalWithDefaults()}>
                  <Plus size={14} className="mr-1" />
                  Báo chi phí mới
                </Button>
              }
            />
          )}
        </Panel>
      )}

      {/* 6. UPLOAD MODAL */}
      <ExpenseUploadModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        finance={finance}
        currentUserId={user.id}
        preselectedLineId={preselectedLineId}
        preselectedRecipientKey={preselectedRecipientKey}
      />

      {/* 7. DETAIL & VERIFICATION DRAWER */}
      <ExpenseDetailDrawer
        expense={selectedExpenseForDrawer}
        onClose={() => setSelectedExpenseForDrawer(null)}
        finance={finance}
        currentUser={user}
        canCreate={canCreate}
        onSelectTab={onSelectTab}
      />
    </div>
  );
}
