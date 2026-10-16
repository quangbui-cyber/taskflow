"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Plus,
  Building2,
  FileText,
  CreditCard,
  Coins,
  AlertCircle,
  ShieldAlert,
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import ActionForm from "@/components/CostFlowActionForm";
import { displayMoney } from "@/lib/costflow/money";
import { isExpenseApproved } from "@/lib/costflow/reconciliation";
import type { RequestPayload } from "@/lib/costflow/types";
import { recipientDisplayName } from "@/lib/costflow/labels";
import PaymentLedgerTable from "@/components/costflow/payments/PaymentLedgerTable";
import AdvanceSettlementAllocator from "@/components/costflow/payments/AdvanceSettlementAllocator";

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
  onSelectTab: (tab: string) => void;
  setSavedNotice: (notice: string) => void;
};

export default function PaymentCashPanel({
  finance,
  user,
  canCreate,
  onSelectTab,
  setSavedNotice
}: Props) {
  const [activeSubTab, setActiveSubTab] = useState<"create" | "cash" | "beneficiary">(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const urlKind = sp.get("kind");
      if (urlKind && ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(urlKind)) return "create";
    }
    return "create";
  });
  const [kind, setKind] = useState(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const urlKind = sp.get("kind");
      if (urlKind && ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(urlKind)) return urlKind;
    }
    return "ADVANCE";
  });
  const [requestSource, setRequestSource] = useState("");
  const [amountInput, setAmountInput] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("amount") || "";
    }
    return "";
  });
  const [titleInput, setTitleInput] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("title") || "";
    }
    return "";
  });
  const [selectedRecipientKey, setSelectedRecipientKey] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("recipientKey") || "";
    }
    return "";
  });
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const raw = new URLSearchParams(window.location.search).get("expenseIds");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
      }
    }
    return [];
  });

  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  const recipientName = (key: string) =>
    recipientDisplayName(key, usersMap, finance.data.beneficiaries);

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

  // Cash statistics
  const cashStats = useMemo(() => {
    let outTotal = 0;
    let inTotal = 0;
    finance.cash.forEach(c => {
      const amt = parseFloat(c.amount) || 0;
      if (c.direction === "IN") inTotal += amt;
      else outTotal += amt;
    });

    // Approved requests awaiting cash confirmation
    const pendingDisbursements = finance.requests.filter(
      r => r.state === "APPROVED" &&
           ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(r.kind) &&
           !finance.cash.some(c => c.requestId === r.id)
    );

    return {
      outTotal,
      inTotal,
      netTotal: outTotal - inTotal,
      pendingCount: pendingDisbursements.length,
      pendingDisbursements
    };
  }, [finance.cash, finance.requests]);

  const originalRequest = finance.requests.find(r => r.id === requestSource);
  const effectiveRevision = finance.data.revisions.find(r => r.effective);

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER & METRICS */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
              Hồ sơ chi & Giao dịch tiền
            </h2>
            <Badge tone="neutral">{finance.cash.length} giao dịch</Badge>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Lập đề nghị tạm ứng, thanh toán NCC và đối soát hoàn ứng. Giao dịch tiền thực tế được theo dõi độc lập với phê duyệt.
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSelectTab("approvals")}
        >
          Mở Trình duyệt hồ sơ
          <ArrowUpRight size={14} className="ml-1" aria-hidden="true" />
        </Button>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Tổng tiền đã chi</span>
            <ArrowUpRight size={16} className="text-[var(--danger)]" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-[var(--danger)] mt-2">
            {displayMoney(Math.round(cashStats.outTotal).toString())}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Thực chi từ quỹ dự án
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Tổng tiền thu hoàn</span>
            <ArrowDownLeft size={16} className="text-[var(--success)]" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-[var(--success)] mt-2">
            {displayMoney(Math.round(cashStats.inTotal).toString())}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Hoàn tạm ứng vào quỹ
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Chờ giải ngân</span>
            <Clock size={16} className="text-[var(--warning)]" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-[var(--warning)] mt-2">
            {cashStats.pendingCount} hồ sơ
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Đã duyệt, chưa xác nhận tiền
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Người thụ hưởng NCC</span>
            <Building2 size={16} className="text-[var(--info)]" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold tabular-nums text-[var(--info)] mt-2">
            {finance.data.beneficiaries.length} đối tác
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Đã đăng ký tài khoản nhận tiền
          </span>
        </div>
      </div>

      {/* 2. SUB-TAB SWITCHER */}
      <div className="flex border-b border-[var(--border)] gap-6 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setActiveSubTab("create")}
          className={`pb-3 transition-colors relative flex items-center gap-1.5 ${
            activeSubTab === "create"
              ? "text-[var(--primary)] border-b-2 border-[var(--primary)] font-bold"
              : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
          }`}
        >
          <Plus size={16} aria-hidden="true" />
          <span>Lập hồ sơ chi / Hoàn Tạm Ứng</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab("cash")}
          className={`pb-3 transition-colors relative flex items-center gap-1.5 ${
            activeSubTab === "cash"
              ? "text-[var(--primary)] border-b-2 border-[var(--primary)] font-bold"
              : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
          }`}
        >
          <Coins size={16} aria-hidden="true" />
          <span>Sổ quỹ & Giao dịch tiền</span>
          {cashStats.pendingCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[var(--warning)] text-white text-[11px]">
              {cashStats.pendingCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab("beneficiary")}
          className={`pb-3 transition-colors relative flex items-center gap-1.5 ${
            activeSubTab === "beneficiary"
              ? "text-[var(--primary)] border-b-2 border-[var(--primary)] font-bold"
              : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
          }`}
        >
          <CreditCard size={16} aria-hidden="true" />
          <span>Danh bạ người thụ hưởng ({finance.data.beneficiaries.length})</span>
        </button>
      </div>

      {/* 3. CONTENT AREA */}
      {/* SUB-TAB 1: LẬP HỒ SƠ CHI */}
      {activeSubTab === "create" && (
        <div className="space-y-5">
          {canCreate && !finance.data.closed ? (
            <Panel className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div>
                  <h3 className="font-bold text-base text-[var(--foreground)]">
                    Lập đề nghị chi / Hoàn Tạm Ứng mới
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Hồ sơ sau khi gửi sẽ được chuyển sang Trình duyệt để thực hiện thẩm định 3 cấp.
                  </p>
                </div>

                <Badge tone="neutral">
                  {effectiveRevision ? `Áp dụng IC-R${effectiveRevision.number}` : "Chưa có IC hiệu lực"}
                </Badge>
              </div>

              {kind !== "ADVANCE" && <AdvanceSettlementAllocator kind={kind as "VENDOR_PAYMENT" | "REIMBURSEMENT"} />}

              <ActionForm
                key={requestSource || "new-request"}
                finance={finance}
                command={kind === "ADVANCE" ? "CREATE_REQUEST" : kind === "VENDOR_PAYMENT" ? "PAYMENT" : "ADVANCE_SETTLEMENT"}
                label="Gửi duyệt hồ sơ"
                showSubmit={kind === "ADVANCE"}
                onSuccess={() => {
                  setSavedNotice("Hồ sơ đề nghị đã được tạo thành công và chuyển sang Trình duyệt.");
                  onSelectTab("approvals");
                }}
              >
                {/* 1. Chọn làm mới hoặc trình lại */}
                <Select
                  label="Chế độ lập hồ sơ"
                  value={requestSource}
                  onChange={e => {
                    const id = e.target.value;
                    setRequestSource(id);
                    const source = finance.requests.find(r => r.id === id);
                    if (source) setKind(source.kind);
                  }}
                >
                  <option value="">Lập hồ sơ đề nghị mới</option>
                  {finance.requests
                    .filter(
                      r =>
                        r.creatorId === user.id &&
                        ["RETURNED", "REJECTED"].includes(r.state) &&
                        ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(r.kind)
                    )
                    .map(r => (
                      <option key={r.id} value={r.id}>
                        Trình lại: {r.title} (#{r.id.slice(-8)})
                      </option>
                    ))}
                </Select>

                {requestSource && <input type="hidden" name="parentRequestId" value={requestSource} />}

                {/* 2. Loại hồ sơ */}
                <div>
                  <label className="tf-label mb-2 block">Loại hồ sơ đề nghị</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      {
                        id: "ADVANCE",
                        label: "Đề nghị tạm ứng (ĐNTU)",
                        desc: "Tạm ứng quỹ công việc cho nhân sự phụ trách"
                      },
                      {
                        id: "VENDOR_PAYMENT",
                        label: "Đề nghị thanh toán (ĐNTT)",
                        desc: "Chi trả hóa đơn nhà cung cấp / đối tác (VENDOR_DIRECT)"
                      },
                      {
                        id: "REIMBURSEMENT",
                        label: "Đề nghị Hoàn tạm ứng (ĐNHTU)",
                        desc: "Quyết toán tạm ứng & thu hồi tiền túi nhân sự tự ứng (OUT_OF_POCKET)"
                      }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!!requestSource}
                        onClick={() => {
                          setKind(opt.id);
                          setSelectedExpenseIds([]);
                        }}
                        className={`p-3 rounded-lg border text-left transition-all ${
                          kind === opt.id
                            ? "border-[var(--primary)] bg-[var(--primary-soft)] ring-1 ring-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--text-secondary)]"
                        }`}
                      >
                        <p className="font-semibold text-xs text-[var(--foreground)]">{opt.label}</p>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                  <input type="hidden" name="kind" value={kind} />
                </div>

                {/* Banner giải thích quy tắc hiệu lực giải ngân */}
                <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-1.5 text-xs text-[var(--text-secondary)]">
                  <div className="flex items-center gap-2 text-[var(--foreground)] font-semibold">
                    <AlertCircle size={15} className="text-amber-500" aria-hidden="true" />
                    <span>Quy tắc hiệu lực giải ngân thanh toán:</span>
                  </div>
                  <p>
                    • Cả <strong>Phiếu Hoàn tạm ứng (ĐNHTU)</strong> và <strong>Phiếu Đề nghị thanh toán (ĐNTT)</strong> đều <em>có thể tạo trước</em> trong quá trình thực hiện dự án.
                  </p>
                  <p>
                    • Phiếu <em>chỉ có hiệu lực giải ngân / chi tiền thực tế</em> khi các khoản chi phí AC tương ứng <strong>được phê duyệt</strong> (đủ hóa đơn + chứng từ thanh toán hoặc được Kế toán / Quản lý duyệt ngoại lệ).
                  </p>
                </div>

                {/* 3. Tiêu đề hồ sơ */}
                <Input
                  name="title"
                  label="Tên hồ sơ đề nghị"
                  value={titleInput || originalRequest?.title || ""}
                  onChange={e => setTitleInput(e.target.value)}
                  placeholder="Ví dụ: Tạm ứng tiền thi công booth tại Hồ Tràm"
                  required
                />

                {/* 4. Chọn revision IC & Người nhận */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    name="revisionId"
                    label="IC căn cứ ngân sách"
                    defaultValue={effectiveRevision?.id ?? ""}
                    required
                  >
                    <option value="">Chọn bản IC căn cứ</option>
                    {finance.data.revisions.map(r => (
                      <option key={r.id} value={r.id}>
                        IC-R{r.number} {r.effective ? "(Baseline hiệu lực)" : "(Chưa hiệu lực)"}
                      </option>
                    ))}
                  </Select>

                  <Select
                    name="recipientKey"
                    label="Người nhận tiền / Thụ hưởng"
                    value={selectedRecipientKey || originalRequest?.payload.recipientKey || ""}
                    onChange={e => setSelectedRecipientKey(e.target.value)}
                    required
                  >
                    <option value="">Chọn người nhận</option>
                    {recipients.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </Select>
                </div>

                {/* Gắn kèm khoản chi AC đối với VENDOR_PAYMENT */}
                {kind === "VENDOR_PAYMENT" && selectedRecipientKey && (
                  <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-2">
                    <span className="text-xs font-semibold text-[var(--foreground)] block">
                      Khoản chi AC liên quan (Tùy chọn gắn kèm):
                    </span>
                    {finance.data.expenses.filter(e => e.recipientKey === selectedRecipientKey && e.fundingSource === "VENDOR_DIRECT").length > 0 ? (
                      <div className="space-y-1.5">
                        {finance.data.expenses
                          .filter(e => e.recipientKey === selectedRecipientKey && e.fundingSource === "VENDOR_DIRECT")
                          .map(exp => {
                            const isChecked = selectedExpenseIds.includes(exp.id);
                            const isApproved = isExpenseApproved(exp);
                            return (
                              <label key={exp.id} className="flex items-center justify-between p-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs cursor-pointer hover:border-[var(--text-secondary)]">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={e => {
                                      const next = e.target.checked
                                        ? [...selectedExpenseIds, exp.id]
                                        : selectedExpenseIds.filter(id => id !== exp.id);
                                      setSelectedExpenseIds(next);
                                      if (next.length > 0) {
                                        const sumGross = finance.data.expenses
                                          .filter(item => next.includes(item.id))
                                          .reduce((acc, item) => acc + (parseFloat(item.cost.gross) || 0), 0);
                                        setAmountInput(String(Math.round(sumGross)));
                                      }
                                    }}
                                  />
                                  <div>
                                    <span className="font-semibold text-[var(--foreground)] block">{exp.description}</span>
                                    <span className="text-[11px] text-[var(--text-secondary)]">
                                      Gross: {displayMoney(exp.cost.gross)} · {isApproved ? "Đã duyệt AC" : "Chưa duyệt AC"}
                                    </span>
                                  </div>
                                </div>
                                <Badge tone={isApproved ? "success" : "warning"}>
                                  {isApproved ? "AC đã duyệt" : "Chờ duyệt AC"}
                                </Badge>
                              </label>
                            );
                          })}
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--text-secondary)]">Chưa có khoản chi VENDOR_DIRECT nào được báo cho đối tác này.</p>
                    )}
                    <input type="hidden" name="expenseIds" value={JSON.stringify(selectedExpenseIds)} />
                  </div>
                )}

                {/* Tóm tắt tình trạng AC đối với REIMBURSEMENT */}
                {kind === "REIMBURSEMENT" && selectedRecipientKey && (
                  <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--foreground)]">
                        Các khoản chi phí AC của nhân sự này:
                      </span>
                      {(() => {
                        const mExpenses = finance.data.expenses.filter(e => e.recipientKey === selectedRecipientKey);
                        const allApproved = mExpenses.length > 0 && mExpenses.every(isExpenseApproved);
                        return (
                          <Badge tone={allApproved ? "success" : "warning"}>
                            {allApproved ? "Đủ điều kiện thanh toán (AC đã duyệt)" : "Tạo trước (Chờ duyệt AC để giải ngân)"}
                          </Badge>
                        );
                      })()}
                    </div>
                    {finance.data.expenses.filter(e => e.recipientKey === selectedRecipientKey).length > 0 ? (
                      <div className="space-y-1 text-xs">
                        {finance.data.expenses.filter(e => e.recipientKey === selectedRecipientKey).map(exp => (
                          <div key={exp.id} className="flex items-center justify-between p-1.5 rounded bg-[var(--surface)] text-[11px]">
                            <span>{exp.description} ({displayMoney(exp.cost.gross)})</span>
                            <span className={isExpenseApproved(exp) ? "text-[var(--success)] font-medium" : "text-amber-600 font-medium"}>
                              {isExpenseApproved(exp) ? "✓ Đã duyệt AC" : "⏳ Chờ duyệt AC"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--text-secondary)]">Chưa ghi nhận khoản chi AC nào của nhân sự này.</p>
                    )}
                  </div>
                )}

                {/* 5. Số tiền đề nghị */}
                {kind !== "REIMBURSEMENT" && (
                  <div className="space-y-1">
                    <Input
                      name="amount"
                      label="Số tiền đề nghị (VND)"
                      defaultValue={originalRequest?.payload.amount}
                      value={amountInput}
                      onChange={e => setAmountInput(e.target.value)}
                      required
                      inputMode="decimal"
                      placeholder="Nhập số tiền không dấu chấm"
                    />
                    {amountInput && !isNaN(Number(amountInput)) && Number(amountInput) > 0 && (
                      <p className="text-xs text-[var(--success)] font-medium">
                        Số tiền: {displayMoney(amountInput)}
                      </p>
                    )}
                  </div>
                )}

                {/* 6. Lý do / Giải trình */}
                <Textarea
                  name="explanation"
                  label="Lý do / Giải trình"
                  defaultValue={originalRequest?.payload.explanation}
                  placeholder="Nêu rõ lý do cần chi, tiến độ dự án hoặc căn cứ hợp đồng..."
                  hint="Tạm ứng bổ sung bắt buộc phải giải thích lý do vì sao cần và không thể tự ứng."
                  required
                />
              </ActionForm>
            </Panel>
          ) : (
            <EmptyState
              title="Không có quyền tạo hồ sơ chi"
              description="Chỉ thành viên có quyền Account hoặc Admin và khi dự án chưa đóng tài chính mới có thể lập hồ sơ chi mới."
            />
          )}
        </div>
      )}

      {/* SUB-TAB 2: SỔ QUỸ & GIAO DỊCH TIỀN THỰC TẾ */}
      {activeSubTab === "cash" && (
        <div className="space-y-6">
          <Panel className="space-y-4">
            <div><h3 className="font-bold text-base text-[var(--foreground)]">Đối soát theo hồ sơ và người nhận</h3><p className="text-xs text-[var(--text-secondary)]">Projection chuẩn hóa, legacy-safe và không chứa số tài khoản ngân hàng.</p></div>
            <PaymentLedgerTable projectId={finance.project.id} rows={finance.paymentLedger ?? []} />
          </Panel>
          {/* A. HỒ SƠ ĐÃ DUYỆT ĐANG CHỜ GIẢI NGÂN */}
          {cashStats.pendingDisbursements.length > 0 && (
            <Panel className="space-y-3 border-[var(--warning)] bg-[var(--warning-soft)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={18} className="text-[var(--warning)]" aria-hidden="true" />
                  <h3 className="font-bold text-sm text-[var(--foreground)]">
                    Hồ sơ đã duyệt đang chờ giải ngân ({cashStats.pendingDisbursements.length})
                  </h3>
                </div>
                <span className="text-xs text-[var(--text-secondary)]">Kế toán / Thủ quỹ xác nhận khi tiền đã chuyển</span>
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
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--foreground)]">{req.title}</p>
                          <Badge tone={isBlockedByPendingAc ? "warning" : "success"}>
                            {isBlockedByPendingAc ? "Chờ duyệt AC (Chưa thể giải ngân)" : "Đã duyệt AC (Đủ điều kiện chi)"}
                          </Badge>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                          Người đề nghị: {usersMap.get(req.creatorId) ?? "Người lập"} ·
                          Số tiền: <strong className="text-[var(--success)]">{req.payload.amount ? displayMoney(req.payload.amount) : "Theo đối soát"}</strong>
                          {isBlockedByPendingAc && (
                            <span className="text-amber-700 dark:text-amber-400 block mt-1 font-medium">
                              ⚠ Cần duyệt AC đầy đủ (hoặc duyệt ngoại lệ) cho các khoản chi trước khi Kế toán / Thủ quỹ chi tiền.
                            </span>
                          )}
                        </p>
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
                          <Link
                            href={`/projects/${finance.project.id}/costflow?tab=approvals#request-${req.id}`}
                            className="tf-button-primary text-xs"
                          >
                            Xác nhận chi tiền
                            <ArrowUpRight size={13} className="ml-1" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* B. BẢNG GIAO DỊCH TIỀN ĐÃ XÁC NHẬN */}
          <Panel className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-[var(--foreground)]">
                  Sổ quỹ giao dịch tiền thực tế
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Ghi nhận đầy đủ chứng từ chuyển khoản, số phiếu thu/chi và người nhận tiền.
                </p>
              </div>
              <Badge tone="neutral">{finance.cash.length} bản ghi</Badge>
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
                          <span className={isRefund ? "text-[var(--success)]" : "text-[var(--danger)]"}>
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
        </div>
      )}

      {/* SUB-TAB 3: DANH BẠ NGƯỜI THỤ HƯỞNG NCC */}
      {activeSubTab === "beneficiary" && (
        <div className="space-y-6">
          {/* A. THÊM / CẬP NHẬT NGƯỜI THỤ HƯỞNG */}
          <Panel className="space-y-4">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="font-bold text-base text-[var(--foreground)]">Danh bạ NCC toàn công ty</h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">Tạo, đổi tài khoản và xác minh đúng phiên bản tại danh bạ dùng chung.</p>
              </div>
              <Badge tone="info">File ngân hàng không bắt buộc</Badge>
            </div>
            <Link href="/suppliers" className="tf-button-primary tf-button-size-md">Mở danh bạ NCC</Link>
          </Panel>

          {/* B. DANH SÁCH CÁC NGƯỜI THỤ HƯỞNG ĐÃ LƯU */}
          <Panel className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-[var(--foreground)]">
                Danh sách người thụ hưởng đã đăng ký
              </h3>
              <Badge tone="neutral">{finance.data.beneficiaries.length} đối tác</Badge>
            </div>

            {finance.data.beneficiaries.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {finance.data.beneficiaries.map(b => {
                  const isVerified = b.verifiedVersion === b.version;
                  return (
                    <div
                      key={b.id}
                      className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-2 hover:border-[var(--text-secondary)] transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-[var(--foreground)]">{b.name}</span>
                        <Badge tone={isVerified ? "success" : "warning"}>
                          {isVerified ? "Đã xác minh" : `Chờ Kế toán xác minh v${b.version}`}
                        </Badge>
                      </div>

                      <div className="text-xs space-y-1 text-[var(--text-secondary)]">
                        <p className="flex items-center gap-1.5">
                          <Building2 size={13} aria-hidden="true" />
                          <span>Ngân hàng: <strong>{b.bank}</strong></span>
                        </p>
                        <p className="flex items-center gap-1.5 font-mono">
                          <CreditCard size={13} aria-hidden="true" />
                          <span>STK: <strong className="text-[var(--foreground)]">{b.account}</strong></span>
                        </p>
                        <p className="text-[11px] pt-1">
                          Phiên bản v{b.version}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="Chưa có người thụ hưởng NCC nào"
                description="Thêm thông tin tài khoản ngân hàng của các nhà cung cấp để chuẩn bị cho các đợt thanh toán."
              />
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
