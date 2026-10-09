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
  User
} from "lucide-react";
import type { Finance, Request } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";
import ActionForm from "@/components/CostFlowActionForm";
import ApprovalTimeline from "@/components/ApprovalTimeline";
import IcRequestEvidence from "@/components/IcRequestEvidence";
import ExpenseRequestModal from "@/components/ExpenseRequestModal";
import { icStatusProjection } from "@/lib/costflow/icEffectiveness";
import { displayMoney } from "@/lib/costflow/money";
import { FilePlus2, Building2, Search, X } from "lucide-react";
import { PaymentRequestEditor } from "@/components/costflow/payments/PaymentRequestEditor";
import { PaymentRequestPreview } from "@/components/costflow/payments/PaymentRequestPreview";
import { PaymentRequestReview } from "@/components/costflow/payments/PaymentRequestReview";
import AdvanceSettlementAllocator from "@/components/costflow/payments/AdvanceSettlementAllocator";

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

  // Modal states for creating expense requests & managing beneficiaries
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [modalInitialKind, setModalInitialKind] = useState("ADVANCE");
  const [modalInitialRecipientKey, setModalInitialRecipientKey] = useState("");
  const [modalInitialAmount, setModalInitialAmount] = useState("");
  const [modalInitialTitle, setModalInitialTitle] = useState("");
  const [modalInitialExpenseIds, setModalInitialExpenseIds] = useState<string[]>([]);
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

      if (urlKind && ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(urlKind)) {
        setModalInitialKind(urlKind);
        if (urlRecipientKey) setModalInitialRecipientKey(urlRecipientKey);
        if (urlAmount) setModalInitialAmount(urlAmount);
        if (urlTitle) setModalInitialTitle(urlTitle);
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

  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  // Projected approval steps fallback
  const defaultSteps = useMemo(() => [
    { role: "MANAGER", assigneeId: finance.data.config.managerId },
    { role: "ACCOUNTANT", assigneeId: finance.data.config.accountantId },
    { role: "CEO", assigneeId: finance.data.config.ceoId }
  ], [finance.data.config]);

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
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Quản lý hồ sơ đề nghị chi (ĐNTU, ĐNTT, ĐNHTU) và theo dõi tiến trình phê duyệt 3 cấp (Quản lý → Kế toán → CEO).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreate && !finance.data.closed && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setModalInitialTab("beneficiary");
                  setCreateModalOpen(true);
                }}
              >
                <Building2 size={14} className="mr-1 text-[var(--primary)]" aria-hidden="true" />
                Danh bạ NCC ({finance.data.beneficiaries.length})
              </Button>

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

          <Link href="/workflow" className="tf-button-secondary text-xs">
            Hồ sơ cá nhân tại Workflow
            <ArrowRight size={13} className="ml-1" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {canCreate && !finance.data.closed && <details className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <summary className="cursor-pointer font-semibold text-sm">Lập ĐNTU đa khoản</summary>
        <div className="mt-4"><PaymentRequestEditor finance={finance} onCreated={() => undefined} /></div>
      </details>}
      {!!finance.paymentDossiers?.length && <Panel className="space-y-4">
        <div><h3 className="font-semibold">ĐNTU đa khoản đã lưu</h3><p className="tf-ui-help">Nạp lại từ dòng và snapshot chuẩn hóa trên server.</p></div>
        {finance.paymentDossiers.map(dossier => <PaymentRequestPreview key={dossier.requestId} serverProjection title={dossier.title} milestone={dossier.milestone} explanation={finance.requests.find(request => request.id === dossier.requestId)?.payload.explanation} revisionLabel={[...new Set(dossier.lines.map(line => line.icRevisionId))].join(", ")} lines={dossier.lines.map(line => ({
          stableKey: line.stableKey,
          description: line.description,
          amount: line.amount,
          sourceLabel: finance.data.revisions.find(revision => revision.id === line.icRevisionId)?.lines.find(source => source.id === line.icLineId)?.description ?? `${line.icRevisionId} / ${line.icLineId}`,
          recipientKey: line.recipientKey,
          recipientLabel: dossier.recipients.find(recipient => recipient.recipientKey === line.recipientKey)?.displayName ?? line.recipientKey,
        }))} />)}
      </Panel>}

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

        {/* Dropdown Filters */}
        <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-[var(--border)]/60">
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
      </Panel>

      {/* 3. REQUEST LIST OR EMPTY STATE */}
      {filteredRequests.length > 0 ? (
        <div className="space-y-4">
          {filteredRequests.map(req => (
            <EnhancedRequestCard
              key={req.id}
              finance={finance}
              request={req}
              user={user}
              usersMap={usersMap}
              projectedSteps={defaultSteps}
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

      {/* MODAL TẠO HỒ SƠ CHI & QUẢN LÝ NCC */}
      <ExpenseRequestModal
        open={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
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
        initialTab={modalInitialTab}
        onSuccess={() => {
          // Cuộn lên đầu để xem hồ sơ vừa tạo
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </div>
  );
}

// -------------------------------------------------------------
// ENHANCED REQUEST CARD COMPONENT
// -------------------------------------------------------------
function EnhancedRequestCard({
  finance,
  request,
  user,
  usersMap,
  projectedSteps
}: {
  finance: Finance;
  request: Request;
  user: { id: string; role: string };
  usersMap: Map<string, string>;
  projectedSteps: { role: string; assigneeId?: string }[];
}) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [decision, setDecision] = useState("APPROVE");
  const [corrections, setCorrections] = useState([""]);

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

  const status = revision
    ? icStatusProjection(revision, request, finance.data.revisions)
    : undefined;

  const ceoOptional = request.kind === "IC" && current?.role === "CEO";
  const managerId = request.steps.find(step => step.role === "MANAGER")?.assigneeId;

  const kindMeta = KIND_INFO[request.kind] ?? { label: request.kind, tone: "neutral" as const };
  const stateMeta = STATE_INFO[request.state] ?? { label: request.state, tone: "neutral" as const };

  return (
    <Panel
      id={`request-${request.id}`}
      className={`space-y-5 transition-all ${
        isMyTurn
          ? "border-[var(--info)] shadow-md ring-1 ring-[var(--info)]"
          : "hover:border-[var(--text-secondary)]"
      }`}
    >
      {/* A. HEADER: KIND, TITLE, STATE & CREATOR */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div className="space-y-1 max-w-2xl">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={kindMeta.tone}>
              {kindMeta.label}
            </Badge>
            <span className="font-mono text-xs text-[var(--text-secondary)]">
              #{request.id.slice(-8)}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">· Phiên bản v{request.version}</span>
          </div>

          <h3 className="text-base font-bold text-[var(--foreground)]">
            {request.title}
          </h3>

          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] pt-1">
            <span className="flex items-center gap-1">
              <User size={13} aria-hidden="true" />
              Người lập: <strong className="text-[var(--foreground)]">{usersMap.get(request.creatorId) ?? "Người lập"}</strong>
            </span>
            {request.createdAt && (
              <span>· {new Date(request.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isMyTurn && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--warning)] text-white animate-pulse">
              <Clock size={12} aria-hidden="true" />
              Đến lượt bạn xử lý
            </span>
          )}
          <Badge tone={stateMeta.tone}>
            {stateMeta.label}
          </Badge>
        </div>
      </div>

      {/* B. IC TWO-AXIS PROJECTION (NẾU LÀ HỒ SƠ IC) */}
      {revision && status && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <span className="text-xs text-[var(--text-secondary)] block">
                Trục 1: Hiệu lực ngân sách
              </span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm font-bold text-[var(--foreground)]">
                  IC-R{revision.number}
                </span>
                <Badge tone={revision.effective ? "success" : "warning"}>
                  {status.budgetLabel}
                </Badge>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <span className="text-xs text-[var(--text-secondary)] block">
                Trục 2: Kết quả trình duyệt
              </span>
              <div className="flex items-center gap-2 mt-1">
                <Badge tone={request.state === "APPROVED" ? "success" : request.state === "REJECTED" ? "danger" : "neutral"}>
                  {status.approvalLabel}
                </Badge>
              </div>
            </div>
          </div>

          <Alert tone={revision.effective ? "info" : "warning"} title={`Trạng thái IC-R${revision.number}`}>
            {status.message}
            {status.baselineRevisionId && status.baselineRevisionId !== revision.id && (
              <div className="mt-1">
                <a className="tf-link text-xs inline-flex items-center gap-1" href={`#ic-revision-${status.baselineRevisionId}`}>
                  <span>Mở baseline ngân sách hiện hành (IC-R{finance.data.revisions.find(r => r.id === status.baselineRevisionId)?.number})</span>
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>
            )}
          </Alert>
        </div>
      )}

      {/* C. VISUAL APPROVAL TIMELINE */}
      <ApprovalTimeline
        request={request}
        users={usersMap}
        projectedSteps={projectedSteps}
      />

      {/* D. NỘI DUNG VÀ THÔNG SỐ HỒ SƠ */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          Chi tiết nội dung hồ sơ
        </h4>

        {paymentDossier && <PaymentRequestReview finance={finance} request={request} dossier={paymentDossier} />}

        {/* Số tiền đề nghị (nếu có) */}
        {request.payload.amount && (
          <div className="p-3 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Số tiền đề nghị:</span>
            <span className="text-lg font-bold tabular-nums text-[var(--success)]">
              {displayMoney(request.payload.amount)}
            </span>
          </div>
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

        {/* Xuất file / In PDF (Hoàn tạm ứng) */}
        {request.kind === "REIMBURSEMENT" && (
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              className="tf-button-secondary text-xs flex items-center gap-1.5"
              href={`/api/projects/${finance.project.id}/costflow/requests/${request.id}/export`}
            >
              <FileSpreadsheet size={13} aria-hidden="true" />
              Tải phiếu Excel
            </Link>
            <Link
              className="tf-button-secondary text-xs flex items-center gap-1.5"
              href={`/projects/${finance.project.id}/costflow/requests/${request.id}/print`}
              target="_blank"
            >
              <Printer size={13} aria-hidden="true" />
              In / lưu PDF
            </Link>
          </div>
        )}

        {/* IC Request Evidence */}
        {request.kind === "IC" && (
          <div className="pt-2">
            <IcRequestEvidence
              finance={finance}
              request={request}
              canSupplement={
                request.creatorId === user.id &&
                finance.fullAccess &&
                ["ACCOUNT", "ADMIN"].includes(user.role) &&
                !finance.data.closed
              }
            />
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
        <div className="p-4 rounded-xl border-2 border-[var(--info)] bg-[var(--info-soft)] space-y-4">
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
          </ActionForm>
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
          >
            {revision && (
              <Textarea
                name="explanation"
                label="Lý do / Tóm tắt thay đổi"
                hint="Bắt buộc cho mỗi lần gửi IC; giải thích riêng từng dòng là không bắt buộc."
                required
              />
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
    </Panel>
  );
}
