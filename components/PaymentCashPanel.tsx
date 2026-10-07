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
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import ActionForm from "@/components/CostFlowActionForm";
import { displayMoney } from "@/lib/costflow/money";

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
  const [activeSubTab, setActiveSubTab] = useState<"create" | "cash" | "beneficiary">("create");
  const [kind, setKind] = useState("ADVANCE");
  const [requestSource, setRequestSource] = useState("");
  const [amountInput, setAmountInput] = useState("");

  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  const recipientName = (key: string) =>
    key.startsWith("USER:")
      ? usersMap.get(key.slice(5)) ?? "Nhân viên"
      : finance.data.beneficiaries.find(b => b.id === key.slice(7))?.name ?? "NCC";

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

              <ActionForm
                key={requestSource || "new-request"}
                finance={finance}
                command="CREATE_REQUEST"
                label="Gửi duyệt hồ sơ"
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
                      { id: "ADVANCE", label: "Đề nghị tạm ứng", desc: "Tạm ứng cho nhân sự phụ trách" },
                      { id: "VENDOR_PAYMENT", label: "Thanh toán NCC", desc: "Chi trả hóa đơn nhà cung cấp" },
                      { id: "REIMBURSEMENT", label: "Đề nghị Hoàn Tạm Ứng", desc: "Đối soát và quyết toán ứng" }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!!requestSource}
                        onClick={() => setKind(opt.id)}
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

                {/* 3. Tiêu đề hồ sơ */}
                <Input
                  name="title"
                  label="Tên hồ sơ đề nghị"
                  defaultValue={originalRequest?.title}
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
                    defaultValue={originalRequest?.payload.recipientKey ?? ""}
                    required
                  >
                    <option value="">Chọn người nhận</option>
                    {recipients.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </Select>
                </div>

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
                {cashStats.pendingDisbursements.map(req => (
                  <div key={req.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">{req.title}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                        Người đề nghị: {usersMap.get(req.creatorId) ?? "Người lập"} ·
                        Số tiền: <strong className="text-[var(--success)]">{req.payload.amount ? displayMoney(req.payload.amount) : "Theo đối soát"}</strong>
                      </p>
                    </div>

                    <Link
                      href={`/projects/${finance.project.id}/costflow?tab=approvals#request-${req.id}`}
                      className="tf-button-primary text-xs"
                    >
                      Xác nhận chi tiền
                      <ArrowUpRight size={13} className="ml-1" aria-hidden="true" />
                    </Link>
                  </div>
                ))}
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
          {canCreate && !finance.data.closed && (
            <Panel className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div>
                  <h3 className="font-bold text-base text-[var(--foreground)]">
                    Đăng ký / Cập nhật người thụ hưởng NCC
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Kế toán xác minh thông tin tài khoản khi kiểm tra hồ sơ. Mỗi lần sửa thông tin sẽ tạo phiên bản mới cần xác minh lại.
                  </p>
                </div>
                <Badge tone="info">Cần file căn cứ STK</Badge>
              </div>

              <ActionForm
                finance={finance}
                command="BENEFICIARY"
                label="Lưu thông tin thụ hưởng"
                onSuccess={() => setSavedNotice("Đã lưu thông tin người thụ hưởng thành công.")}
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
            </Panel>
          )}

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
