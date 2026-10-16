"use client";

import Link from "next/link";
import { useState, useMemo, useEffect } from "react";
import {
  FileText,
  Clock,
  CheckCircle2,
  RotateCcw,
  ArrowRight,
  FileSpreadsheet,
  Printer,
  ExternalLink,
  UserCheck,
  Send,
  User,
  PenTool,
  ShieldCheck
} from "lucide-react";
import { SignaturePad } from "@/components/SignaturePad";
import type { Finance, Request } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";
import ActionForm from "@/components/CostFlowActionForm";
import ApprovalTimeline from "@/components/ApprovalTimeline";
import IcApprovalReviewDashboard from "@/components/IcApprovalReviewDashboard";
import ExpenseRequestModal from "@/components/ExpenseRequestModal";
import { displayMoney } from "@/lib/costflow/money";
import { ordinaryApprovalSteps } from "@/lib/costflow/approvalChain";
import { FilePlus2, Building2, Search, X } from "lucide-react";
import { PaymentRequestEditor } from "@/components/costflow/payments/PaymentRequestEditor";
import { PaymentRequestPreview } from "@/components/costflow/payments/PaymentRequestPreview";
import { PaymentRequestReview } from "@/components/costflow/payments/PaymentRequestReview";
import AdvanceSettlementAllocator from "@/components/costflow/payments/AdvanceSettlementAllocator";
import CashConfirmationEditor from "@/components/costflow/payments/CashConfirmationEditor";
import { WORKFLOW_HUB_HREF } from "@/lib/workflow/routes";

import { KIND_INFO, STATE_INFO, ROLE_LABELS as ROLE_LABEL, ACTION_LABELS as ACTION_LABEL } from "@/lib/costflow/labels";

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
};

export default function ApprovalRequestsPanel({ finance, user, canCreate }: Props) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("ALL");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [scopeTab, setScopeTab] = useState<"ALL" | "MY_ACTION" | "SUBMITTED" | "APPROVED" | "RETURNED_REJECTED">("ALL");

  // Modal inspection state (xem & thẩm định hồ sơ chi tiết)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  // Modal states for creating expense requests & managing beneficiaries
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [modalInitialKind, setModalInitialKind] = useState("ADVANCE");
  const [modalInitialRecipientKey, setModalInitialRecipientKey] = useState("");
  const [modalInitialAmount, setModalInitialAmount] = useState("");
  const [modalInitialTitle, setModalInitialTitle] = useState("");
  const [modalInitialExpenseIds, setModalInitialExpenseIds] = useState<string[]>([]);
  const [modalInitialScheduleMilestoneId, setModalInitialScheduleMilestoneId] = useState("");
  const [modalInitialTab, setModalInitialTab] = useState<"create" | "beneficiary">("create");

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate modal intent from the external URL once */
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const urlKind = sp.get("kind");
      const urlRecipientKey = sp.get("recipientKey");
      const urlAmount = sp.get("amount");
      const urlTitle = sp.get("title");
      const urlExpenseIds = sp.get("expenseIds");
      const urlOpen = sp.get("openCreateRequest");
      const urlBeneficiary = sp.get("beneficiary");
      const urlScheduleMilestoneId = sp.get("scheduleMilestoneId");

      if (urlKind && ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(urlKind)) {
        setModalInitialKind(urlKind);
        if (urlRecipientKey) setModalInitialRecipientKey(urlRecipientKey);
        if (urlAmount) setModalInitialAmount(urlAmount);
        if (urlTitle) setModalInitialTitle(urlTitle);
        if (urlScheduleMilestoneId) setModalInitialScheduleMilestoneId(urlScheduleMilestoneId);
        if (urlExpenseIds) {
          try {
            const parsed = JSON.parse(urlExpenseIds);
            if (Array.isArray(parsed)) setModalInitialExpenseIds(parsed);
          } catch {}
        }
        setModalInitialTab("create");
        setCreateModalOpen(true);
      } else if (urlBeneficiary === "1") {
        setModalInitialTab("beneficiary");
        setCreateModalOpen(true);
      } else if (urlOpen === "1") {
        setModalInitialTab("create");
        setCreateModalOpen(true);
      }
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Sync hash deep-link (#request-{id})
  useEffect(() => {
    if (typeof window !== "undefined") {
      const syncHash = () => {
        const hash = window.location.hash;
        if (hash.startsWith("#request-")) {
          const id = hash.replace("#request-", "");
          if (finance.requests.some(r => r.id === id)) {
            setSelectedRequestId(id);
          }
        }
      };
      syncHash();
      window.addEventListener("hashchange", syncHash);
      return () => window.removeEventListener("hashchange", syncHash);
    }
  }, [finance.requests]);

  const selectedRequest = useMemo(
    () => finance.requests.find(r => r.id === selectedRequestId),
    [finance.requests, selectedRequestId]
  );

  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  // Drafts have no frozen steps yet. Project exactly the chain the server will
  // validate: the creator's direct manager, then the project Accountant and CEO.
  const defaultSteps = useMemo(() => ordinaryApprovalSteps({
    directManagerId: finance.users.find(person => person.id === selectedRequest?.creatorId)?.managerId,
    accountantId: finance.data.config.accountantId,
    ceoId: finance.data.config.ceoId,
  }), [finance.data.config.accountantId, finance.data.config.ceoId, finance.users, selectedRequest?.creatorId]);

  // Statistics counters
  const stats = useMemo(() => {
    const all = finance.requests;
    const myAction = all.filter(r => {
      const curr = r.steps[r.currentStep];
      return r.state === "SUBMITTED" && curr?.assigneeId === user.id;
    }).length;
    const submitted = all.filter(r => r.state === "SUBMITTED").length;
    const approved = all.filter(r => r.state === "APPROVED").length;
    const returnedOrRejected = all.filter(r => ["RETURNED", "REJECTED"].includes(r.state)).length;

    return { total: all.length, myAction, submitted, approved, returnedOrRejected };
  }, [finance.requests, user.id]);

  // Filtered requests list
  const filteredRequests = useMemo(() => {
    return finance.requests.filter(req => {
      // Scope tab filter
      if (scopeTab === "MY_ACTION") {
        const curr = req.steps[req.currentStep];
        if (req.state !== "SUBMITTED" || curr?.assigneeId !== user.id) return false;
      } else if (scopeTab === "SUBMITTED") {
        if (req.state !== "SUBMITTED") return false;
      } else if (scopeTab === "APPROVED") {
        if (req.state !== "APPROVED") return false;
      } else if (scopeTab === "RETURNED_REJECTED") {
        if (!["RETURNED", "REJECTED"].includes(req.state)) return false;
      }

      // Dropdown filters
      if (kindFilter !== "ALL" && req.kind !== kindFilter) return false;
      if (stateFilter !== "ALL" && req.state !== stateFilter) return false;
      if (assigneeFilter !== "ALL" && req.steps[req.currentStep]?.assigneeId !== assigneeFilter && req.cashAssigneeId !== assigneeFilter) return false;

      // Text search
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const titleMatch = req.title.toLowerCase().includes(q);
        const creatorMatch = (usersMap.get(req.creatorId) ?? "").toLowerCase().includes(q);
        const kindMatch = (KIND_INFO[req.kind]?.label ?? req.kind).toLowerCase().includes(q);
        if (!titleMatch && !creatorMatch && !kindMatch) return false;
      }

      return true;
    });
  }, [finance.requests, scopeTab, kindFilter, stateFilter, assigneeFilter, search, user.id, usersMap]);

  return (
    <div className="space-y-6">
      {/* 1. HEADER & KPI CARDS */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
              Hồ sơ & Trình duyệt
            </h2>
            <Badge tone="neutral">{stats.total} hồ sơ</Badge>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Quản lý hồ sơ đề nghị chi và theo dõi tiến trình phê duyệt 3 cấp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreate && !finance.data.closed && (
            <>
              <Link href="/suppliers" className="tf-button-secondary tf-button-size-sm inline-flex items-center">
                <Building2 size={14} className="mr-1" aria-hidden="true" />
                Danh bạ NCC
              </Link>

              <Button
                size="sm"
                onClick={() => {
                  setModalInitialKind("ADVANCE");
                  setModalInitialRecipientKey("");
                  setModalInitialAmount("");
                  setModalInitialTitle("");
                  setModalInitialExpenseIds([]);
                  setModalInitialTab("create");
                  setCreateModalOpen(true);
                }}
              >
                <FilePlus2 size={14} className="mr-1" aria-hidden="true" />
                Lập hồ sơ chi
              </Button>
            </>
          )}

          <Link href={WORKFLOW_HUB_HREF} className="tf-link text-xs flex items-center gap-1 font-medium ml-1">
            <span>Tất cả Hồ sơ & Trình duyệt</span>
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/* KPI METRICS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setScopeTab("MY_ACTION")}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            scopeTab === "MY_ACTION"
              ? "border-[var(--warning)] bg-[var(--warning-soft)] ring-2 ring-[var(--warning)]"
              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--warning)]"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Chờ tôi xử lý</span>
            <UserCheck size={16} className="text-[var(--warning)]" aria-hidden="true" />
          </div>
          <p className="text-2xl font-bold tabular-nums text-[var(--warning)] mt-2">
            {stats.myAction}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {stats.myAction > 0 ? "Cần bạn đưa ra quyết định" : "Không có việc tồn đọng"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setScopeTab("SUBMITTED")}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            scopeTab === "SUBMITTED"
              ? "border-[var(--info)] bg-[var(--info-soft)] ring-2 ring-[var(--info)]"
              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--info)]"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Đang trong vòng duyệt</span>
            <Clock size={16} className="text-[var(--info)]" aria-hidden="true" />
          </div>
          <p className="text-2xl font-bold tabular-nums text-[var(--info)] mt-2">
            {stats.submitted}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Đang chờ các cấp phê duyệt
          </span>
        </button>

        <button
          type="button"
          onClick={() => setScopeTab("APPROVED")}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            scopeTab === "APPROVED"
              ? "border-[var(--success)] bg-[var(--success-soft)] ring-2 ring-[var(--success)]"
              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--success)]"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Đã phê duyệt</span>
            <CheckCircle2 size={16} className="text-[var(--success)]" aria-hidden="true" />
          </div>
          <p className="text-2xl font-bold tabular-nums text-[var(--success)] mt-2">
            {stats.approved}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Đã hoàn thành toàn bộ vòng duyệt
          </span>
        </button>

        <button
          type="button"
          onClick={() => setScopeTab("RETURNED_REJECTED")}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            scopeTab === "RETURNED_REJECTED"
              ? "border-[var(--danger)] bg-[var(--danger-soft)] ring-2 ring-[var(--danger)]"
              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--danger)]"
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Cần sửa / Từ chối</span>
            <RotateCcw size={16} className="text-[var(--danger)]" aria-hidden="true" />
          </div>
          <p className="text-2xl font-bold tabular-nums text-[var(--danger)] mt-2">
            {stats.returnedOrRejected}
          </p>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Cần bổ sung thông tin hoặc giải trình
          </span>
        </button>
      </div>

      {/* 2. FILTER BAR */}
      <Panel className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Quick Scope Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[var(--surface-soft)] rounded-lg border border-[var(--border)] text-xs font-medium">
            <button
              type="button"
              onClick={() => setScopeTab("ALL")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                scopeTab === "ALL"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm font-semibold"
                  : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              Tất cả ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setScopeTab("MY_ACTION")}
              className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${
                scopeTab === "MY_ACTION"
                  ? "bg-[var(--warning-soft)] text-[var(--warning)] shadow-sm font-semibold"
                  : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              <span>Cần tôi duyệt</span>
              {stats.myAction > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[var(--warning)] text-white text-[10px]">
                  {stats.myAction}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setScopeTab("SUBMITTED")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                scopeTab === "SUBMITTED"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm font-semibold"
                  : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              Đang duyệt ({stats.submitted})
            </button>
            <button
              type="button"
              onClick={() => setScopeTab("APPROVED")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                scopeTab === "APPROVED"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm font-semibold"
                  : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              Đã duyệt ({stats.approved})
            </button>
            <button
              type="button"
              onClick={() => setScopeTab("RETURNED_REJECTED")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                scopeTab === "RETURNED_REJECTED"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm font-semibold"
                  : "text-[var(--text-secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              Trả / Từ chối ({stats.returnedOrRejected})
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Nhập tên, người lập..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="tf-field text-xs h-9 w-full"
              style={{ paddingLeft: "36px", paddingRight: "32px" }}
              aria-label="Tìm kiếm hồ sơ"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-secondary)] hover:text-[var(--foreground)]"
                aria-label="Xóa tìm kiếm"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Dropdown Filters (Disclosure) */}
        <details className="pt-2 border-t border-[var(--border)]/60 text-xs" open={kindFilter !== "ALL" || stateFilter !== "ALL" || assigneeFilter !== "ALL"}>
          <summary className="cursor-pointer text-[var(--text-secondary)] hover:text-[var(--foreground)] font-medium select-none py-1">
            Bộ lọc nâng cao {(kindFilter !== "ALL" || stateFilter !== "ALL" || assigneeFilter !== "ALL") && "• (Đang lọc)"}
          </summary>
          <div className="grid gap-3 sm:grid-cols-3 pt-2">
            <Select
              label="Loại hồ sơ"
              value={kindFilter}
              onChange={e => setKindFilter(e.target.value)}
            >
              <option value="ALL">Tất cả các loại hồ sơ</option>
              {Object.entries(KIND_INFO).map(([val, info]) => (
                <option key={val} value={val}>{info.label}</option>
              ))}
            </Select>

            <Select
              label="Trạng thái phê duyệt"
              value={stateFilter}
              onChange={e => setStateFilter(e.target.value)}
            >
              <option value="ALL">Tất cả trạng thái</option>
              {Object.entries(STATE_INFO).map(([val, info]) => (
                <option key={val} value={val}>{info.label}</option>
              ))}
            </Select>
            <Select label="Người xử lý" value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)}>
              <option value="ALL">Tất cả người xử lý</option>
              {finance.users.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
            </Select>
          </div>
        </details>
      </Panel>

      {/* 3. REQUEST LIST OR EMPTY STATE */}
      {filteredRequests.length > 0 ? (
        <div className="space-y-3">
          {filteredRequests.map(req => (
            <CompactRequestCard
              key={req.id}
              finance={finance}
              request={req}
              user={user}
              usersMap={usersMap}
              onOpen={() => setSelectedRequestId(req.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Không tìm thấy hồ sơ phù hợp"
          description={
            finance.requests.length > 0
              ? "Thử thay đổi từ khóa tìm kiếm hoặc bỏ bớt các bộ lọc đang chọn."
              : "Dự án chưa có hồ sơ nào được tạo. Bạn có thể tạo dự toán IC từ tab Internal Cost hoặc bấm 'Lập hồ sơ chi' để tạo đề nghị chi mới."
          }
        />
      )}

      {/* MODAL THẨM ĐỊNH & CHI TIẾT HỒ SƠ */}
      {selectedRequest && (
        <RequestInspectionModal
          open={!!selectedRequest}
          onClose={() => {
            setSelectedRequestId(null);
            if (typeof window !== "undefined" && window.location.hash.startsWith("#request-")) {
              window.history.replaceState(null, "", window.location.pathname + window.location.search);
            }
          }}
          finance={finance}
          request={selectedRequest}
          user={user}
          usersMap={usersMap}
          projectedSteps={defaultSteps}
        />
      )}

      {/* MODAL TẠO HỒ SƠ CHI & QUẢN LÝ NCC */}
      <ExpenseRequestModal
        open={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          setModalInitialScheduleMilestoneId("");
          // Dọn dẹp query params trên URL nếu có
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.delete("kind");
            url.searchParams.delete("recipientKey");
            url.searchParams.delete("amount");
            url.searchParams.delete("title");
            url.searchParams.delete("expenseIds");
            url.searchParams.delete("openCreateRequest");
            url.searchParams.delete("beneficiary");
            url.searchParams.delete("scheduleMilestoneId");
            window.history.replaceState(null, "", url.toString());
          }
        }}
        finance={finance}
        user={user}
        canCreate={canCreate}
        initialKind={modalInitialKind}
        initialRecipientKey={modalInitialRecipientKey}
        initialAmount={modalInitialAmount}
        initialTitle={modalInitialTitle}
        initialExpenseIds={modalInitialExpenseIds}
        initialScheduleMilestoneId={modalInitialScheduleMilestoneId}
        initialTab={modalInitialTab}
        onSuccess={() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </div>
  );
}

// -------------------------------------------------------------
// COMPACT REQUEST CARD (HÀNG CHỜ DUYỆT TINH GỌN)
// -------------------------------------------------------------
function CompactRequestCard({
  finance,
  request,
  user,
  usersMap,
  onOpen,
}: {
  finance: Finance;
  request: Request;
  user: { id: string; role: string };
  usersMap: Map<string, string>;
  onOpen: () => void;
}) {
  const current = request.steps[request.currentStep];
  const isMyTurn = request.state === "SUBMITTED" && current?.assigneeId === user.id;

  const revision = request.kind === "IC"
    ? finance.data.revisions.find(item => item.requestId === request.id)
    : undefined;
  const paymentDossier = finance.paymentDossiers?.find(item => item.requestId === request.id);

  const kindMeta = KIND_INFO[request.kind] ?? { label: request.kind, tone: "neutral" as const };
  const stateMeta = STATE_INFO[request.state] ?? { label: request.state, tone: "neutral" as const };

  const displayAmount = useMemo(() => {
    if (request.payload.amount) {
      try {
        return displayMoney(request.payload.amount);
      } catch {
        return `${request.payload.amount} ₫`;
      }
    }
    if (paymentDossier?.lines.length) {
      const sum = paymentDossier.lines.reduce((acc, l) => acc + (parseFloat(l.amount) || 0), 0);
      try {
        return displayMoney(String(Math.round(sum)));
      } catch {
        return `${sum.toLocaleString("vi-VN")} ₫`;
      }
    }
    return null;
  }, [request.payload.amount, paymentDossier]);

  return (
    <div
      id={`request-${request.id}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`p-3.5 sm:p-4 rounded-xl border transition-all cursor-pointer group text-left ${
        isMyTurn
          ? "border-[var(--warning)] bg-[var(--surface)] ring-1 ring-[var(--warning)]/50 hover:shadow-md hover:border-[var(--warning)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)] hover:shadow-sm"
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Cột 1: Thông tin loại & tiêu đề */}
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge tone={kindMeta.tone}>{kindMeta.label}</Badge>
            <span className="font-mono text-[11px] text-[var(--text-secondary)]">
              #{request.id.slice(-8)}
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              v{request.version}
            </span>
            {revision && (
              <span className="text-[11px] font-semibold text-[var(--foreground)]">
                IC-R{revision.number} {revision.effective && <span className="text-emerald-600 font-bold">(Hiệu lực)</span>}
              </span>
            )}
            {paymentDossier && (
              <span className="text-[11px] text-[var(--text-secondary)]">
                · {paymentDossier.lines.length} khoản chi
              </span>
            )}
          </div>

          <h3 className="text-sm sm:text-base font-bold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors truncate">
            {request.title}
          </h3>

          <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--text-secondary)]">
            <span className="flex items-center gap-1">
              <User size={12} aria-hidden="true" />
              <span>{usersMap.get(request.creatorId) ?? "Người lập"}</span>
            </span>
            {request.createdAt && (
              <span>· {new Date(request.createdAt).toLocaleDateString("vi-VN")}</span>
            )}
            <span className="text-[var(--border)]">|</span>
            <span className="text-[11px]">
              {request.state === "SUBMITTED" ? (
                <span className="text-[var(--info)]">
                  Đang chờ: <strong>{ROLE_LABEL[current?.role] ?? "Người duyệt"}</strong> ({usersMap.get(current?.assigneeId ?? "") ?? "Chưa gán"})
                </span>
              ) : (
                <span>{STATE_INFO[request.state]?.label ?? request.state}</span>
              )}
            </span>
          </div>
        </div>

        {/* Cột 2: Tiền & Trạng thái & Nút thao tác */}
        <div className="flex items-center md:items-end justify-between md:justify-end gap-3 shrink-0 border-t md:border-t-0 pt-2.5 md:pt-0 border-[var(--border)]/40">
          {displayAmount && (
            <div className="text-left md:text-right">
              <span className="text-[10px] uppercase font-semibold text-[var(--text-secondary)] block">
                {paymentDossier ? "Tổng đề nghị" : "Số tiền đề nghị"}
              </span>
              <span className="text-sm sm:text-base font-bold tabular-nums text-emerald-600">
                {displayAmount}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            {["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(request.kind) && (
              <Link
                href={`/projects/${finance.project.id}/costflow/requests/${request.id}/print`}
                onClick={(e) => e.stopPropagation()}
                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 hover:text-indigo-600 transition-colors shadow-2xs"
                title="Mở biểu mẫu A4 để xem và trình ký"
              >
                <Printer size={12} aria-hidden="true" />
                <span>Trình ký A4</span>
              </Link>
            )}

            {isMyTurn && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500 text-white animate-pulse">
                <Clock size={11} aria-hidden="true" />
                <span>Cần bạn duyệt</span>
              </span>
            )}

            <Badge tone={stateMeta.tone}>{stateMeta.label}</Badge>

            <Button
              size="sm"
              variant={isMyTurn ? "primary" : "secondary"}
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
            >
              {isMyTurn ? "Xử lý duyệt" : "Mở hồ sơ"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// REQUEST INSPECTION MODAL (TRÌNH THẨM ĐỊNH & XEM CHI TIẾT HỒ SƠ)
// -------------------------------------------------------------
function RequestInspectionModal({
  open,
  onClose,
  finance,
  request,
  user,
  usersMap,
  projectedSteps
}: {
  open: boolean;
  onClose: () => void;
  finance: Finance;
  request: Request;
  user: { id: string; role: string };
  usersMap: Map<string, string>;
  projectedSteps: { role: string; assigneeId?: string }[];
}) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [decision, setDecision] = useState("APPROVE");
  const [corrections, setCorrections] = useState([""]);
  const [signPadOpen, setSignPadOpen] = useState(false);
  const [eSignedData, setESignedData] = useState<string | null>(null);
  const [eSignedPin, setESignedPin] = useState<string>("");
  const [approverSignedData, setApproverSignedData] = useState<string | null>(null);
  const [approverSignedPin, setApproverSignedPin] = useState<string>("");
  const [approverSignPadOpen, setApproverSignPadOpen] = useState(false);
  const isSignedKind = ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(request.kind);
  const signingEvidenceState = (request as Request & { signingEvidenceState?: string | null }).signingEvidenceState;

  const current = request.steps[request.currentStep];
  const isMyTurn = request.state === "SUBMITTED" && current?.assigneeId === user.id;
  const isCreator = request.creatorId === user.id;

  const samePerson =
    request.steps.filter(step => step.assigneeId === user.id).length > 1 ||
    (request.creatorId === user.id && current?.assigneeId === user.id);

  const revision = request.kind === "IC"
    ? finance.data.revisions.find(item => item.requestId === request.id)
    : undefined;
  const paymentDossier = finance.paymentDossiers?.find(item => item.requestId === request.id);

  const ceoOptional = request.kind === "IC" && current?.role === "CEO";
  const managerId = request.steps.find(step => step.role === "MANAGER")?.assigneeId;
  const draftApprovalSteps = request.steps.length ? request.steps : projectedSteps;
  const missingDraftApprover = draftApprovalSteps.find(step => !step.assigneeId);

  const kindMeta = KIND_INFO[request.kind] ?? { label: request.kind, tone: "neutral" as const };
  const stateMeta = STATE_INFO[request.state] ?? { label: request.state, tone: "neutral" as const };

  // 4-tier approval signers info for approved certificate
  const certSigners = useMemo(() => {
    if (!isSignedKind) return [];
    const creatorName = usersMap.get(request.creatorId) ?? "Người đề nghị";
    const managerStep = request.steps.find(s => s.role === "MANAGER") ?? projectedSteps.find(s => s.role === "MANAGER");
    const accountantStep = request.steps.find(s => s.role === "ACCOUNTANT") ?? projectedSteps.find(s => s.role === "ACCOUNTANT");
    const ceoStep = request.steps.find(s => s.role === "CEO") ?? projectedSteps.find(s => s.role === "CEO");

    const managerDecision = request.decisions.find(d => {
      const step = request.steps.find(s => s.role === "MANAGER");
      return d.actorId === step?.assigneeId && d.action === "APPROVE";
    }) ?? request.decisions[0];

    const accountantDecision = request.decisions.find(d => {
      const step = request.steps.find(s => s.role === "ACCOUNTANT");
      return d.actorId === step?.assigneeId && d.action === "APPROVE";
    }) ?? request.decisions[1];

    const ceoDecision = request.decisions.find(d => {
      const step = request.steps.find(s => s.role === "CEO");
      return d.actorId === step?.assigneeId && d.action === "APPROVE";
    }) ?? request.decisions[2];

    const isApproved = request.state === "APPROVED";

    return [
      {
        role: "CREATOR",
        roleTitle: "1. Người đề nghị",
        userName: creatorName,
        date: request.createdAt ? new Date(request.createdAt).toLocaleDateString("vi-VN") : "Đã ký",
        signed: true,
        customSig: eSignedData || (request.payload as { signatureDataUrl?: string })?.signatureDataUrl || null,
      },
      {
        role: "MANAGER",
        roleTitle: "2. Quản lý trực tiếp",
        userName: (managerStep?.assigneeId && usersMap.get(managerStep.assigneeId)) || "Bùi Duy Quang",
        date: managerDecision?.createdAt ? new Date(managerDecision.createdAt).toLocaleDateString("vi-VN") : "Đã duyệt",
        signed: isApproved || (request.currentStep > 0),
        customSig: null,
      },
      {
        role: "ACCOUNTANT",
        roleTitle: "3. Kế toán kiểm soát",
        userName: (accountantStep?.assigneeId && usersMap.get(accountantStep.assigneeId)) || "Đỗ Vũ Phương Uyên",
        date: accountantDecision?.createdAt ? new Date(accountantDecision.createdAt).toLocaleDateString("vi-VN") : "Đã duyệt",
        signed: isApproved || (request.currentStep > 1),
        customSig: null,
      },
      {
        role: "CEO",
        roleTitle: "4. Giám đốc điều hành",
        userName: (ceoStep?.assigneeId && usersMap.get(ceoStep.assigneeId)) || "Đoàn Thái Sơn",
        date: ceoDecision?.createdAt ? new Date(ceoDecision.createdAt).toLocaleDateString("vi-VN") : "Đã duyệt",
        signed: isApproved,
        customSig: null,
      },
    ];
  }, [isSignedKind, request, usersMap, projectedSteps, eSignedData]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="tf-dialog-wide tf-approval-inspection-modal"
      title={request.title}
      description={`Mã hồ sơ: #${request.id.slice(-8)} · Phiên bản v${request.version}`}
    >
      <div className="space-y-5 pt-2">
        {/* A. HEADER METADATA BANNER */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={kindMeta.tone}>{kindMeta.label}</Badge>
            <span className="text-[var(--text-secondary)]">·</span>
            <span>Người lập: <strong className="text-[var(--foreground)]">{usersMap.get(request.creatorId) ?? "Người lập"}</strong></span>
            {request.createdAt && (
              <span className="text-[var(--text-secondary)]">· {new Date(request.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isMyTurn && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--warning)] text-white animate-pulse">
                <Clock size={12} aria-hidden="true" />
                Đến lượt bạn xử lý
              </span>
            )}
            <Badge tone={stateMeta.tone}>{stateMeta.label}</Badge>
          </div>
        </div>

      {request.kind === "IC" && (
        <IcApprovalReviewDashboard
          finance={finance}
          request={request}
          canSupplement={
            request.creatorId === user.id &&
            finance.fullAccess &&
            ["ACCOUNT", "ADMIN"].includes(user.role) &&
            !finance.data.closed
          }
        />
      )}

      {request.kind === "IC" && isMyTurn && (
        <div className="tf-approval-sticky-actionbar" aria-label="Chọn hướng xử lý hồ sơ IC">
          <div><strong>Đến lượt bạn xử lý</strong><span>Chọn hướng, sau đó ghi ý kiến và xác nhận ở biểu mẫu quyết định.</span></div>
          <div className="flex flex-wrap gap-2">
            {[
              ["APPROVE", current?.role === "MANAGER" && revision ? `Duyệt IC-R${revision.number}` : "Phê duyệt"],
              ["RETURN", "Trả chỉnh sửa"],
              ["REJECT", "Từ chối"],
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={decision === value ? (value === "REJECT" ? "danger" : "primary") : "secondary"}
                onClick={() => {
                  setDecision(value);
                  requestAnimationFrame(() => document.getElementById(`request-decision-${request.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* B. VISUAL APPROVAL TIMELINE */}
      <ApprovalTimeline
        request={request}
        users={usersMap}
        projectedSteps={projectedSteps}
      />

      {/* C. NỘI DUNG VÀ THÔNG SỐ HỒ SƠ */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          Chi tiết nội dung hồ sơ
        </h4>

        {paymentDossier && <PaymentRequestReview finance={finance} request={request} dossier={paymentDossier} user={user} />}

        {/* Số tiền đề nghị (nếu có) */}
        {request.payload.amount && (
          <div className="p-3 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Số tiền đề nghị:</span>
            <span className="text-lg font-bold tabular-nums text-[var(--success)]">
              {displayMoney(request.payload.amount)}
            </span>
          </div>
        )}

        {request.kind === "ADVANCE" && request.payload.expectedSettlementDate && request.state === "APPROVED" && new Date(`${request.payload.expectedSettlementDate}T23:59:59.999Z`) < new Date() && (
          <Alert tone="warning" title="Quá hạn hoàn ứng">
            Hạn dự kiến {new Date(`${request.payload.expectedSettlementDate}T00:00:00.000Z`).toLocaleDateString("vi-VN")}. Cảnh báo không tự chặn ĐNTU mới; người lập vẫn phải giải trình tạm ứng bổ sung.
          </Alert>
        )}

        {/* Người thụ hưởng (nếu có) */}
        {request.payload.beneficiary && (
          <div className="text-sm p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)]">
            <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">Người nhận / Tài khoản:</p>
            <p className="font-semibold text-[var(--foreground)]">
              {request.payload.beneficiary.name}
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {request.payload.beneficiary.bank} · STK: {request.payload.beneficiary.account}
            </p>
          </div>
        )}

        {/* Trạng thái hiệu lực giải ngân thanh toán */}
        {request.kind === "REIMBURSEMENT" && <AdvanceSettlementAllocator kind="REIMBURSEMENT" />}
        {request.kind === "VENDOR_PAYMENT" && <AdvanceSettlementAllocator kind="VENDOR_PAYMENT" />}

        {/* Lý do / Giải trình */}
        {request.payload.explanation && (
          <div className="text-xs p-3 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] space-y-1">
            <p className="font-medium text-[var(--text-secondary)] uppercase text-[10px]">Lý do / Giải trình:</p>
            <p className="whitespace-pre-wrap text-[var(--foreground)]">{request.payload.explanation}</p>
          </div>
        )}

        {/* Sửa chi phí AC */}
        {request.payload.expenseRevision && (
          <div className="text-xs p-3 rounded-lg bg-[var(--warning-soft)] border border-[var(--warning)] space-y-1">
            <p className="font-semibold text-[var(--warning)]">
              Đề nghị sửa chi phí AC: {request.payload.expenseRevision.proposed.description}
            </p>
            <p className="tabular-nums font-mono">
              Tổng gồm VAT đề nghị: {displayMoney(request.payload.expenseRevision.proposed.cost.gross)}
            </p>
            <p className="text-[var(--text-secondary)] text-[11px]">
              Chi phí hiện tại chỉ đổi sau khi toàn bộ vòng duyệt chấp thuận bản sửa.
            </p>
          </div>
        )}

        {/* Nút In ấn & Trình ký A4 toàn trang (Dual-track signing) */}
        {isSignedKind && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-indigo-100 bg-indigo-50/60 mt-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
                <Printer size={16} aria-hidden="true" />
              </div>
              <div className="text-xs">
                <p className="font-semibold text-indigo-950">Biểu mẫu trình ký A4 chuẩn hoá</p>
                <p className="text-[11px] text-indigo-700">Xem và ký số trực tiếp trên biểu mẫu A4 chuẩn Excel doanh nghiệp</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-xs transition-colors"
                href={`/projects/${finance.project.id}/costflow/requests/${request.id}/print`}
              >
                <PenTool size={13} aria-hidden="true" />
                Mở bản in trình ký A4
              </Link>
              {request.kind === "REIMBURSEMENT" && (
                <Link
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors"
                  href={`/api/projects/${finance.project.id}/costflow/requests/${request.id}/export`}
                >
                  <FileSpreadsheet size={13} aria-hidden="true" />
                  Xuất Excel
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Khối Chứng nhận Ký duyệt 4 cấp (4-Tier Digital Signature Certificate) */}
        {isSignedKind && request.state === "APPROVED" && ["DIGITAL_CONFIRMED", "PHYSICAL_CONFIRMED"].includes(signingEvidenceState ?? "") && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-emerald-200/80">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-700" aria-hidden="true" />
                  <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-950">
                    Bằng chứng ký duyệt nội bộ 4 cấp
                  </h4>
                </div>
                <p className="text-[11px] text-emerald-800">
                  Chứng từ đã hoàn tất thẩm định và ký duyệt đầy đủ theo quy định kiểm soát tài chính nội bộ.
                </p>
              </div>
              <Badge tone="success">
                <CheckCircle2 size={12} className="inline mr-1" />
                Đủ 4 bước kiểm soát nội bộ
              </Badge>
            </div>

            {/* 4-Tier Signers Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {certSigners.map((signer) => (
                <div
                  key={signer.role}
                  className="p-2.5 rounded-lg border border-emerald-200/90 bg-white flex flex-col justify-between text-center relative overflow-hidden shadow-xs"
                >
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">
                      {signer.roleTitle}
                    </span>
                    <span className="text-xs font-semibold text-zinc-900 block truncate">
                      {signer.userName}
                    </span>
                  </div>

                  {/* Stamp / Signature Area */}
                  <div className="my-2 h-16 rounded border border-dashed border-emerald-200 bg-emerald-50/40 flex flex-col items-center justify-center p-1 relative">
                    {signer.customSig ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={signer.customSig}
                        alt={`Chữ ký ${signer.userName}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : signer.signed ? (
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full border-2 border-emerald-600 flex items-center justify-center text-emerald-700 font-serif font-black text-xs rotate-[-12deg] mb-0.5">
                          ✓
                        </div>
                        <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-tight">
                          ĐÃ KÝ SỐ
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-zinc-400 italic">Chờ ký</span>
                    )}
                  </div>

                  <div className="text-[10px] text-zinc-500 pt-1 border-t border-zinc-100 flex items-center justify-between">
                    <span>Thời điểm:</span>
                    <span className="font-mono text-zinc-700">{signer.date}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Snapshot fingerprint and opaque QR are emitted only by the approved print route. */}
            <div className="p-2.5 rounded-lg bg-white border border-emerald-200/70 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-[11px] text-zinc-600">Mã băm snapshot và QR capability chỉ hiển thị trên bản in đã duyệt; không dùng mã hồ sơ nội bộ làm URL công khai.</span>
            </div>

            {/* Dual-Track Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <Link
                href={`/projects/${finance.project.id}/costflow/requests/${request.id}/print`}
                target="_blank"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-800 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 shadow-xs transition-colors text-center"
              >
                <Printer size={13} />
                In / Xuất PDF Biểu mẫu A4 (Bản cứng & QR)
              </Link>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSignPadOpen(true)}
                className="text-xs"
              >
                <PenTool size={13} className="mr-1" />
                {eSignedData ? "Ký số bổ sung / Đổi chữ ký" : "Ký số điện tử vào hồ sơ"}
              </Button>
            </div>

            {signPadOpen && (
              <SignaturePad
                open={signPadOpen}
                onClose={() => setSignPadOpen(false)}
                onConfirm={(dataUrl, pin) => {
                  setESignedData(dataUrl);
                  setESignedPin(pin ?? "");
                  setSignPadOpen(false);
                }}
                userName={usersMap.get(user.id) ?? "Người xử lý"}
                userRoleTitle={ROLE_LABEL[current?.role ?? ""] ?? user.role}
                title={`Ký xác nhận chứng từ — ${request.title}`}
              />
            )}
          </div>
        )}

        {isSignedKind && request.state === "APPROVED" && request.cashAssigneeId === user.id && paymentDossier && (
          <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
            <div><h4 className="font-semibold">Cash OUT / IN sau ký</h4><p className="tf-ui-help">Đủ chữ ký chỉ cấp thẩm quyền. Giao dịch tiền chỉ phát sinh khi Kế toán/Thủ quỹ xác nhận dưới đây cùng chứng từ.</p></div>
            {paymentDossier.recipients.map(recipient => <CashConfirmationEditor key={recipient.recipientKey} finance={finance} request={request} dossier={paymentDossier} recipient={recipient} userId={user.id} />)}
          </div>
        )}

        {/* Evidence files */}
        {finance.evidence.filter(e => e.requestId === request.id).length > 0 && (
          <div className="pt-2 border-t border-[var(--border)]">
            <p className="text-xs font-medium text-[var(--text-secondary)] mb-1.5">Tài liệu đính kèm:</p>
            <ul className="space-y-1 text-xs">
              {finance.evidence
                .filter(e => e.requestId === request.id)
                .map(e => (
                  <li key={e.id}>
                    <Link
                      className="tf-link flex items-center gap-1"
                      href={`/api/projects/${finance.project.id}/costflow/evidence/${e.id}`}
                    >
                      <FileText size={12} aria-hidden="true" />
                      <span>{e.name}</span>
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {/* Parent Request link */}
        {request.parentId && finance.requests.some(r => r.id === request.parentId) && (
          <div className="pt-2">
            <Link className="tf-link text-xs inline-flex items-center gap-1" href={`#request-${request.parentId}`}>
              <span>Hồ sơ nguồn của bản gửi lại (#{request.parentId.slice(-8)})</span>
              <ExternalLink size={12} aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>

      {/* E. ACTION AREA: DECISION / SUBMISSION / WITHDRAW */}
      {/* 1. ĐẾN LƯỢT DUYỆT (DECIDE) */}
      {request.state === "SUBMITTED" && current?.assigneeId === user.id && (
        <div id={`request-decision-${request.id}`} className="p-4 rounded-xl border-2 border-[var(--info)] bg-[var(--info-soft)] space-y-4 scroll-mt-4">
          <div className="flex items-center gap-2 text-sm font-bold text-[var(--info)]">
            <UserCheck size={18} aria-hidden="true" />
            <span>Đến lượt bạn đưa ra quyết định với vai trò: {ROLE_LABEL[current.role] ?? current.role}</span>
          </div>

          {samePerson && (
            <Alert tone="warning" title="Bạn xử lý nhiều vai trò">
              Hệ thống ghi nhận từng quyết định độc lập theo từng cấp duyệt. Mỗi bước cần một quyết định riêng.
            </Alert>
          )}

          <ActionForm
            finance={finance}
            command="DECIDE"
            requestId={request.id}
            request={request}
            showSubmit={!(isSignedKind && decision === "APPROVE" && !approverSignedData)}
            label={
              current.role === "MANAGER" && revision
                ? `Duyệt IC-R${revision.number}`
                : "Ghi nhận quyết định"
            }
          >
            <Select
              name="decision"
              label="Quyết định phê duyệt"
              value={decision}
              onChange={event => setDecision(event.target.value)}
            >
              <option value="APPROVE">
                {current.role === "ACCOUNTANT"
                  ? "Kiểm tra đạt, xác minh người nhận và chuyển CEO"
                  : revision
                  ? `Duyệt IC-R${revision.number} (Cấp hiệu lực ngân sách)`
                  : "Chấp thuận / Phê duyệt"}
              </option>
              <option value="RETURN">
                {ceoOptional ? "Trả để sửa (Giữ hiệu lực IC)" : "Trả hồ sơ để sửa"}
              </option>
              <option value="REJECT">
                {ceoOptional ? "Từ chối IC (Giữ hiệu lực IC)" : "Từ chối"}
              </option>
            </Select>

            <Textarea
              name="reason"
              label={ceoOptional ? "Ghi chú của CEO (không bắt buộc)" : "Ý kiến / Lý do"}
              hint={
                ceoOptional
                  ? "Có thể để trống; actor, thời điểm và kết quả vẫn được lưu."
                  : "Bắt buộc khi trả hoặc từ chối"
              }
            />

            {/* Approver Digital Signing Block with 6-digit PIN */}
            {isSignedKind && decision === "APPROVE" && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PenTool size={15} className="text-brand-600" aria-hidden="true" />
                    <span className="text-xs font-bold text-[var(--foreground)] uppercase tracking-wide">
                      Ký duyệt số điện tử (E-Sign & Mã PIN 6 số)
                    </span>
                  </div>
                  <Badge tone={approverSignedData ? "success" : "warning"}>
                    {approverSignedData ? "Đã ký số phê duyệt" : "Bắt buộc ký số"}
                  </Badge>
                </div>

                {approverSignedData ? (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50/50">
                    <div className="flex items-center gap-3">
                      <div className="w-16 h-10 bg-white rounded border border-emerald-300 flex items-center justify-center p-1 shadow-xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={approverSignedData}
                          alt="Chữ ký phê duyệt"
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                      <div className="text-xs">
                        <p className="font-semibold text-emerald-950">
                          {usersMap.get(user.id) ?? "Người xử lý"} ({ROLE_LABEL[current.role] ?? current.role})
                        </p>
                        <p className="text-[11px] text-emerald-700 flex items-center gap-1 font-medium">
                          <ShieldCheck size={12} />
                          Đã xác thực mã PIN 6 số bảo mật
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setApproverSignPadOpen(true)}
                      className="text-xs"
                    >
                      Ký lại
                    </Button>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/60 space-y-2">
                    <p className="text-xs text-amber-900 leading-relaxed">
                      Chứng từ thanh toán/tạm ứng thuộc phạm vi này cần hình ảnh chữ ký nội bộ và PIN 6 số. Máy chủ xác thực PIN và khóa chữ ký vào đúng phiên bản; đây không phải chữ ký số CA.
                    </p>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => setApproverSignPadOpen(true)}
                      className="text-xs"
                    >
                      <PenTool size={13} className="mr-1.5" />
                      Mở bảng ký số & Xác nhận mã PIN 6 số
                    </Button>
                  </div>
                )}

                {/* Hidden inputs to pass signature & PIN with form action */}
                <input type="hidden" name="signatureData" value={approverSignedData || ""} />
                <input type="hidden" name="signaturePin" value={approverSignedPin || ""} />
              </div>
            )}

            {/* Dynamic Return Correction Items */}
            {decision === "RETURN" && !ceoOptional && (
              <fieldset className="space-y-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <legend className="font-semibold text-xs text-[var(--foreground)] uppercase">
                  Danh sách nội dung cần sửa
                </legend>
                {corrections.map((item, index) => (
                  <div className="flex items-end gap-2" key={index}>
                    <div className="flex-1">
                      <Textarea
                        name="correctionItems"
                        label={`Nội dung ${index + 1}`}
                        value={item}
                        onChange={event =>
                          setCorrections(values =>
                            values.map((value, i) => (i === index ? event.target.value : value))
                          )
                        }
                        required
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={corrections.length === 1}
                      onClick={() => setCorrections(values => values.filter((_, i) => i !== index))}
                    >
                      Bỏ
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCorrections(values => [...values, ""])}
                >
                  + Thêm nội dung cần sửa
                </Button>
              </fieldset>
            )}

            {/* Accountant Checklist */}
            {current.role === "ACCOUNTANT" && (
              <label className="flex items-start gap-2 text-xs font-medium text-[var(--foreground)] p-2.5 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)]">
                <input type="checkbox" name="reviewConfirmed" value="yes" required className="mt-0.5" />
                <span>
                  Đã kiểm tra đủ thông tin, chứng từ, phiên bản, người thụ hưởng và liên kết IC trước khi chuyển CEO.
                </span>
              </label>
            )}

            {/* Manager Approval Notice */}
            {current.role === "MANAGER" && revision && (
              <Alert title="Hiệu lực ngay sau quyết định của Quản lý">
                Duyệt sẽ thiết lập baseline ngân sách bằng IC-R{revision.number} và chuyển riêng sang bước Kế toán. Quyết định này không cấp quyền thanh toán tiền mặt.
              </Alert>
            )}

            {/* CEO Return / Reject Policy Alert */}
            {ceoOptional && ["RETURN", "REJECT"].includes(decision) && (
              <Alert
                tone="warning"
                title={decision === "RETURN" ? `Trả IC-R${revision?.number} để sửa?` : `Từ chối IC-R${revision?.number}?`}
              >
                {decision === "RETURN"
                  ? "Bản đã xét được giữ nguyên; hệ thống tạo một revision sửa liên kết và trình lại từ Quản lý. Ngân sách hiện hành không tự bị vô hiệu."
                  : "Kết quả trình duyệt được lưu; ngân sách đã có hiệu lực không tự bị vô hiệu. Quyết định này không cấp quyền thanh toán."}
              </Alert>
            )}

            {/* Disabled submit button when approver signature is pending */}
            {isSignedKind && decision === "APPROVE" && !approverSignedData && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-zinc-100 pt-4">
                <span className="text-xs text-amber-700 font-medium">
                  * Vui lòng ký số điện tử kèm mã PIN ở trên để kích hoạt nút phê duyệt.
                </span>
                <Button
                  type="button"
                  variant="primary"
                  disabled
                  title="Cần ký số trước khi phê duyệt"
                >
                  {current.role === "MANAGER" && revision
                    ? `Duyệt IC-R${revision.number}`
                    : "Chấp thuận / Phê duyệt (Chưa ký số)"}
                </Button>
              </div>
            )}
          </ActionForm>

          {/* Approver SignaturePad Dialog */}
          {approverSignPadOpen && (
            <SignaturePad
              open={approverSignPadOpen}
              onClose={() => setApproverSignPadOpen(false)}
              onConfirm={(dataUrl, pin) => {
                setApproverSignedData(dataUrl);
                setApproverSignedPin(pin ?? "");
                setApproverSignPadOpen(false);
              }}
              userName={usersMap.get(user.id) ?? "Người xử lý"}
              userRoleTitle={ROLE_LABEL[current?.role ?? ""] ?? user.role}
              title={`Ký phê duyệt chứng từ — ${request.title}`}
            />
          )}
        </div>
      )}

      {/* 2. NGƯỜI LẬP GỬI DUYỆT (SUBMIT) */}
      {request.state === "DRAFT" && isCreator && paymentDossier && (
        <PaymentRequestEditor finance={finance} draft={paymentDossier} onCreated={() => undefined} />
      )}

      {request.state === "DRAFT" && isCreator && !paymentDossier && (
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <Send size={16} aria-hidden="true" />
            <span>Hồ sơ đang ở trạng thái Nháp</span>
          </div>
          <ActionForm
            finance={finance}
            command="SUBMIT"
            requestId={request.id}
            label={revision ? `Gửi IC-R${revision.number} tới Quản lý` : "Gửi duyệt hồ sơ"}
            showSubmit={!missingDraftApprover}
          >
            {revision && (
              <Textarea
                name="explanation"
                label="Lý do / Tóm tắt thay đổi"
                hint="Bắt buộc cho mỗi lần gửi IC; giải thích riêng từng dòng là không bắt buộc."
                required
              />
            )}
            {missingDraftApprover && (
              <Alert tone="danger" title="Chưa đủ người duyệt để gửi hồ sơ">
                {missingDraftApprover.role === "MANAGER" ? (
                  <>
                    Tài khoản người lập chưa có Quản lý trực tiếp. Phân công “Quản lý phụ trách project” chỉ dùng cho đóng/mở tài chính.
                    {user.role === "ADMIN" && (
                      <span className="mt-2 block">
                        <Link className="tf-link" href="/admin?tab=users">Mở Quản lý tài khoản để bổ sung Quản lý trực tiếp</Link>
                      </span>
                    )}
                  </>
                ) : missingDraftApprover.role === "ACCOUNTANT"
                  ? "Project chưa được phân công Kế toán trong tab Phân công."
                  : "Project chưa được phân công CEO trong tab Phân công."}
              </Alert>
            )}
          </ActionForm>
        </div>
      )}

      {/* 3. NGƯỜI LẬP RÚT HỒ SƠ (WITHDRAW) */}
      {isCreator && request.state === "SUBMITTED" && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-[var(--text-secondary)]">
            Bạn có thể rút hồ sơ nếu cần chỉnh sửa lại trước khi các cấp duyệt hoàn tất.
          </span>
          <Button variant="danger" size="sm" onClick={() => setWithdrawOpen(true)}>
            Rút hồ sơ
          </Button>

          <Dialog
            open={withdrawOpen}
            onClose={() => setWithdrawOpen(false)}
            title="Rút hồ sơ khỏi vòng duyệt"
            description={
              request.kind === "IC"
                ? "IC này sẽ ngừng hiệu lực ngân sách. Lịch sử và các giao dịch đã ghi vẫn được bảo toàn."
                : "Hồ sơ sẽ rút khỏi quy trình phê duyệt hiện tại và chuyển về trạng thái Đã rút."
            }
          >
            <ActionForm
              finance={finance}
              command="DECIDE"
              requestId={request.id}
              request={request}
              label="Xác nhận rút hồ sơ"
              danger
              onSuccess={() => setWithdrawOpen(false)}
            >
              <input type="hidden" name="decision" value="WITHDRAW" />
              <Textarea name="reason" label="Lý do rút hồ sơ" required />
            </ActionForm>
          </Dialog>
        </div>
      )}

      {/* 4. QUẢN LÝ GHI GIẢI TRÌNH KHI BỊ TRẢ/TỪ CHỐI */}
      {request.kind === "IC" && ["RETURNED", "REJECTED"].includes(request.state) && managerId === user.id && (
        <details className="rounded-xl border border-[var(--border)] p-3 bg-[var(--surface)]">
          <summary className="cursor-pointer font-semibold text-xs text-[var(--foreground)]">
            Ghi giải trình của Quản lý cho bản bị trả / từ chối
          </summary>
          <div className="mt-3">
            <ActionForm
              finance={finance}
              command="IC_MANAGER_EXPLANATION"
              requestId={request.id}
              label="Lưu giải trình"
            >
              <Textarea
                name="explanation"
                label="Giải trình của Quản lý"
                hint="Được lưu vào lịch sử của đúng request/revision; không thay đổi hiệu lực hoặc kết quả CEO."
                required
              />
            </ActionForm>
          </div>
        </details>
      )}

      {/* 5. CHUYỂN GIAO XỬ LÝ (TRANSFER) */}
      {(user.role === "ADMIN" || request.steps[0]?.assigneeId === user.id) &&
        finance.fullAccess &&
        request.currentAttemptId && (
          <details className="rounded-xl border border-[var(--border)] p-3 bg-[var(--surface)]">
            <summary className="cursor-pointer text-xs text-[var(--text-secondary)] hover:text-[var(--foreground)]">
              Chuyển giao quyền xử lý bước duyệt
            </summary>
            <div className="mt-3">
              <ActionForm
                finance={finance}
                command="TRANSFER"
                requestId={request.id}
                request={request}
                label="Chuyển giao"
              >
                <Select label="Người nhận" name="assigneeId" required>
                  <option value="">Chọn người xử lý mới</option>
                  {finance.users.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Select>
                <Select name="transferRole" label="Phần việc chuyển giao">
                  <option value="STEP">Bước duyệt hiện tại</option>
                  <option value="CASH">Xác nhận tiền thực tế</option>
                </Select>
                <Textarea name="reason" label="Lý do chuyển giao" required />
              </ActionForm>
            </div>
          </details>
        )}

      {/* 6. LỊCH SỬ TẤT CẢ QUYẾT ĐỊNH (DECISION HISTORY) */}
      {request.decisions.length > 0 && (
        <details className="pt-2 border-t border-[var(--border)]/60">
          <summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--foreground)]">
            Xem lịch sử các quyết định ({request.decisions.length})
          </summary>
          <ol className="mt-2 space-y-2 text-xs">
            {request.decisions.map(d => (
              <li key={d.id} className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)]">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] mb-1">
                  <span className="font-semibold text-[var(--foreground)]">
                    {usersMap.get(d.actorId) ?? "Người xử lý"}
                  </span>
                  <span>{new Date(d.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
                </div>
                <div className="flex items-center gap-1.5 font-medium text-[var(--foreground)]">
                  <span>Hành động:</span>
                  <Badge tone={d.action === "APPROVE" ? "success" : d.action === "REJECT" ? "danger" : "warning"}>
                    {ACTION_LABEL[d.action] ?? d.action}
                  </Badge>
                </div>
                {d.reason && (
                  <p className="mt-1 text-[var(--text-secondary)] italic">
                    &ldquo;{d.reason}&rdquo;
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      </div>
    </Dialog>
  );
}
