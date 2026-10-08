"use client";

import { useState, useMemo, useId } from "react";
import {
  FileText,
  CreditCard,
  AlertCircle,
  X,
  Building2,
  Receipt,
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge } from "@/components/ui/Presentation";
import ActionForm from "@/components/CostFlowActionForm";
import { displayMoney } from "@/lib/costflow/money";
import { isExpenseApproved } from "@/lib/costflow/reconciliation";

type Props = {
  open: boolean;
  onClose: () => void;
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
  initialKind?: string;
  initialRecipientKey?: string;
  initialAmount?: string;
  initialTitle?: string;
  initialExpenseIds?: string[];
  initialTab?: "create" | "beneficiary";
  onSuccess?: () => void;
};

export default function ExpenseRequestModal({
  open,
  onClose,
  finance,
  user,
  canCreate,
  initialKind = "ADVANCE",
  initialRecipientKey = "",
  initialAmount = "",
  initialTitle = "",
  initialExpenseIds = [],
  initialTab = "create",
  onSuccess,
}: Props) {
  const dialogId = useId();
  const [activeTab, setActiveTab] = useState<"create" | "beneficiary">(initialTab);
  const [kind, setKind] = useState(initialKind);
  const [requestSource, setRequestSource] = useState("");
  const [amountInput, setAmountInput] = useState(initialAmount);
  const [titleInput, setTitleInput] = useState(initialTitle);
  const [selectedRecipientKey, setSelectedRecipientKey] = useState(initialRecipientKey);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>(initialExpenseIds);
  const [feedbackNotice, setFeedbackNotice] = useState("");

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      if (initialKind) setKind(initialKind);
      if (initialRecipientKey) setSelectedRecipientKey(initialRecipientKey);
      if (initialAmount) setAmountInput(initialAmount);
      if (initialTitle) setTitleInput(initialTitle);
      if (initialExpenseIds?.length) setSelectedExpenseIds(initialExpenseIds);
      if (initialTab) setActiveTab(initialTab);
      setFeedbackNotice("");
    }
  }

  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

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

  const originalRequest = finance.requests.find(r => r.id === requestSource);
  const effectiveRevision = finance.data.revisions.find(r => r.effective);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogId}
    >
      <div className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl p-6 sm:p-7 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
              {activeTab === "create" ? <FileText size={22} aria-hidden="true" /> : <Building2 size={22} aria-hidden="true" />}
            </div>
            <div>
              <h2 id={dialogId} className="text-lg font-bold text-[var(--foreground)]">
                {activeTab === "create" ? "Lập hồ sơ đề nghị chi / Hoàn Tạm Ứng" : "Quản lý người thụ hưởng & Nhà cung cấp"}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {activeTab === "create"
                  ? "Tạo đề xuất tạm ứng (ĐNTU), thanh toán NCC (ĐNTT) hoặc hoàn ứng (ĐNHTU) để trình duyệt 3 cấp."
                  : "Đăng ký đối tác NCC và số tài khoản ngân hàng được dùng để thanh toán."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface-soft)]"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[var(--border)] gap-6 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("create")}
            className={`pb-2.5 transition-colors relative flex items-center gap-1.5 ${
              activeTab === "create"
                ? "text-[var(--primary)] border-b-2 border-[var(--primary)] font-bold"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            <Receipt size={14} aria-hidden="true" />
            <span>Lập hồ sơ đề nghị</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("beneficiary")}
            className={`pb-2.5 transition-colors relative flex items-center gap-1.5 ${
              activeTab === "beneficiary"
                ? "text-[var(--primary)] border-b-2 border-[var(--primary)] font-bold"
                : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            <CreditCard size={14} aria-hidden="true" />
            <span>Danh bạ thụ hưởng ({finance.data.beneficiaries.length})</span>
          </button>
        </div>

        {feedbackNotice && <Alert tone="success" title={feedbackNotice} />}

        {/* TAB 1: LẬP HỒ SƠ CHI */}
        {activeTab === "create" && (
          <div className="space-y-4">
            {canCreate && !finance.data.closed ? (
              <ActionForm
                key={requestSource || "new-request"}
                finance={finance}
                command="CREATE_REQUEST"
                label="Gửi duyệt hồ sơ"
                onSuccess={() => {
                  setFeedbackNotice("Hồ sơ đã được gửi thành công và đưa vào luồng Trình duyệt.");
                  setTimeout(() => {
                    onSuccess?.();
                    onClose();
                  }, 800);
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
                        desc: "Quyết toán tạm ứng & hoàn tiền túi nhân sự (OUT_OF_POCKET)"
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
                        className={`p-3 rounded-xl border text-left transition-all ${
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

                {/* Ghi chú quy tắc hiệu lực */}
                <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-1 text-xs text-[var(--text-secondary)]">
                  <div className="flex items-center gap-2 text-[var(--foreground)] font-semibold">
                    <AlertCircle size={14} className="text-amber-500" aria-hidden="true" />
                    <span>Quy tắc hiệu lực giải ngân thanh toán:</span>
                  </div>
                  <p>
                    • Phiếu ĐNHTU và ĐNTT có thể tạo trước trong quá trình thực hiện dự án.
                  </p>
                  <p>
                    • Phiếu <strong>chỉ có hiệu lực giải ngân tiền thực tế</strong> khi các khoản chi phí AC tương ứng <strong>được phê duyệt</strong> đầy đủ (hoặc duyệt ngoại lệ).
                  </p>
                </div>

                {/* 3. Tiêu đề hồ sơ */}
                <Input
                  name="title"
                  label="Tên hồ sơ đề nghị"
                  value={titleInput || originalRequest?.title || ""}
                  onChange={e => setTitleInput(e.target.value)}
                  placeholder="Ví dụ: Tạm ứng tiền thi công booth tại sự kiện..."
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
                                      Gross: {displayMoney(exp.cost.gross)} · {isApproved ? "Đã duyệt AC" : "Chờ duyệt AC"}
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
            ) : (
              <div className="py-6 text-center text-xs text-[var(--text-secondary)]">
                Chỉ Account hoặc Admin và khi dự án chưa đóng tài chính mới có thể tạo hồ sơ chi mới.
              </div>
            )}
          </div>
        )}

        {/* TAB 2: QUẢN LÝ NGƯỜI THỤ HƯỞNG NCC */}
        {activeTab === "beneficiary" && (
          <div className="space-y-5">
            {canCreate && !finance.data.closed && (
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-[var(--foreground)]">
                    Đăng ký / Cập nhật người thụ hưởng NCC
                  </h3>
                  <Badge tone="info">Cần file căn cứ STK</Badge>
                </div>

                <ActionForm
                  finance={finance}
                  command="BENEFICIARY"
                  label="Lưu thông tin thụ hưởng"
                  onSuccess={() => setFeedbackNotice("Đã lưu thông tin người thụ hưởng thành công.")}
                >
                  <Select name="beneficiaryId" label="Thao tác: Thêm mới hoặc Cập nhật">
                    <option value="">Thêm nhà cung cấp mới</option>
                    {finance.data.beneficiaries.map(b => (
                      <option key={b.id} value={b.id}>
                        Cập nhật: {b.name} (Phiên bản v{b.version})
                      </option>
                    ))}
                  </Select>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input name="name" label="Tên người nhận / Tên NCC" placeholder="Công ty TNHH..." required />
                    <Input name="bank" label="Ngân hàng" placeholder="Vietcombank, MB, ACB..." required />
                    <Input name="account" label="Số tài khoản" placeholder="0123456789..." required />
                  </div>

                  <Select
                    name="sourceFileId"
                    label="Tài liệu căn cứ tên người nhận & STK"
                    required
                  >
                    <option value="">Chọn tệp căn cứ từ tài liệu dự án</option>
                    {finance.files.map(file => (
                      <option key={file.id} value={file.id}>{file.name}</option>
                    ))}
                  </Select>
                  <p className="tf-ui-help">
                    Căn cứ có thể là hợp đồng, hóa đơn VAT, báo giá chính thức hoặc email xác nhận từ đối tác.
                  </p>
                </ActionForm>
              </div>
            )}

            {/* Danh sách người thụ hưởng đã có */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Danh sách người thụ hưởng đã đăng ký ({finance.data.beneficiaries.length})
              </h4>
              {finance.data.beneficiaries.length > 0 ? (
                <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--surface)]">
                  {finance.data.beneficiaries.map(b => (
                    <div key={b.id} className="p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <strong className="text-sm text-[var(--foreground)]">{b.name}</strong>
                          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-[var(--surface-soft)] border border-[var(--border)]">
                            v{b.version}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                          Ngân hàng: <strong>{b.bank}</strong> · STK: <span className="font-mono font-medium">{b.account}</span>
                        </p>
                      </div>
                      <Badge tone="success">Đã lưu hồ sơ</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-[var(--text-secondary)] italic">
                  Chưa có nhà cung cấp nào được đăng ký thông tin tài khoản.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-[var(--border)]">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
