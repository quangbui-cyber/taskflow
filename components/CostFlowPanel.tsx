"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import ActionForm from "@/components/CostFlowActionForm";
import ActualCostPanel from "@/components/ActualCostPanel";
import ApprovalRequestsPanel from "@/components/ApprovalRequestsPanel";
import InternalCostPanel from "@/components/InternalCostPanel";
import QuotationPanel from "@/components/QuotationPanel";
import SettlementPanel from "@/components/SettlementPanel";
import CustomerLiquidationPanel from "@/components/costflow/customer/CustomerLiquidationPanel";
import CustomerAcceptanceExport from "@/components/costflow/customer/CustomerAcceptanceExport";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Alert, Badge, Panel, Table } from "@/components/ui/Presentation";
import { ModuleTabs } from "@/components/ui/ModuleUI";
import { completeIcLines } from "@/lib/costflow/budgetDraft";
import { workingIcRevision } from "@/lib/costflow/budgetRevisions";
import { displayMoney, totals } from "@/lib/costflow/money";
import { projectQuotation } from "@/lib/costflow/quotationProjection";
import type { CustomerAccountingReadModel } from "@/lib/costflow/customerAccounting";
import type { CashRow, FinanceData, IcRevision, RequestPayload } from "@/lib/costflow/types";
import type { ApprovalStep } from "@/lib/workflow/approval";
import { WORKFLOW_HUB_HREF } from "@/lib/workflow/routes";
import { ArrowRight, FilePlus2, FileText, Plus } from "lucide-react";

export type Request = {
  id: string;
  module: string;
  parentId: string | null;
  version: number;
  creatorId: string;
  cashAssigneeId: string;
  kind: string;
  state: string;
  title: string;
  currentStep: number;
  currentAttemptId: string | null;
  currentStepArrivedAt: string | null;
  steps: ApprovalStep[];
  payload: RequestPayload;
  approvalEvents: { id?: string; action: string; attemptId: string | null; submittedVersion: number | null; stepIndex?: number; role?: string; actorId?: string; reason?: string; createdAt?: string | Date }[];
  decisions: { id: string; actorId: string; action: string; reason: string; createdAt: string }[];
  createdAt?: string | Date;
};

export type Finance = {
  project: { id: string; name: string; ownerId?: string; client?: { id: string; name: string } | null; members: { userId: string }[] };
  clients?: { id: string; name: string }[];
  suppliers: import("@/lib/costflow/supplierReadModel").CompanySupplier[];
  fullAccess: boolean;
  canManageCustomerAccounting: boolean;
  version: number;
  data: FinanceData;
  requests: Request[];
  cash: CashRow[];
  users: { id: string; name: string; role: string; managerId: string | null }[];
  files: { id: string; name: string }[];
  evidence: { id: string; name: string; requestId: string | null; kind: string; mimeType?: string; sha256?: string }[];
  supplements?: import("@/lib/costflow/types").IcEvidenceSupplement[];
  history: { id: string; actorId: string; action: string; version: number; createdAt: string }[];
  paymentDossiers?: {
    requestId: string;
    kind: string;
    title: string;
    state: string;
    milestone: string;
    totalAmount: string;
    lines: { id: string; stableKey: string; position: number; description: string; amount: string; icRevisionId: string; icLineId: string; recipientKey: string; sourceSnapshot: unknown; evidenceManifest: { id?: string; name: string; sha256?: string }[] }[];
    recipients: { recipientKey: string; recipientType: string; displayName: string; bankName?: string | null; accountLast4?: string | null; sourceVersion?: number | null; totalAmount: string; progress: import("@/lib/costflow/paymentCash").PaymentProgress; paidOutAmount: string; remainingAmount: string }[];
    supplierSnapshots: {
      recipientKey: string;
      supplierId: string;
      frozenSupplierVersionId: string;
      frozenSupplierVersion: number;
      bankAccountId: string;
      frozenBankVersionId: string;
      frozenBankVersion: number;
      accountFingerprint: string;
      currentSupplierVersionId: string | null;
      currentSupplierVersion: number | null;
      currentBankVersionId: string | null;
      currentBankVersion: number | null;
      verificationStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED" | "STALE";
      verificationReason: string;
    }[];
    discussions: { id: string; lineId: string; authorId: string; body: string; createdAt: string; author: { name: string } }[];
    diff: import("@/lib/costflow/paymentDiff").PaymentDossierDiff | null;
  }[];
  paymentLedger?: import("@/lib/costflow/paymentReadModel").PaymentLedgerRow[];
  actualCosts?: {
    lines: import("@/lib/costflow/actualCostReadModel").ActualCostReadLine[];
    comparisons: import("@/lib/costflow/actualCostReadModel").ActualCostComparison[];
    summary: ReturnType<typeof import("@/lib/costflow/actualCost").actualCostVariance>;
    canDecide: boolean;
    controlCenter: import("@/lib/costflow/actualCostControlCenter").ActualCostControlCenter;
  } | null;
  customerAccounting: CustomerAccountingReadModel;
  customerAcceptanceSnapshots: {
    id: string;
    version: number;
    quotationId: string;
    projection: import("@/lib/costflow/customerAcceptanceProjection").CustomerAcceptanceProjection;
    createdAt: string;
  }[];
  exportSources?: {
    id: string;
    family: string;
    sourceKind: string;
    sourceId: string;
    sourceVersion: number;
    projectionHash: string;
    signingState: string | null;
  }[];
};

import { KIND_LABELS, STATE_LABELS, STATE_TONES } from "@/lib/costflow/labels";
const requestAnchor = () => (window.location.hash.startsWith("#request-") ? window.location.hash.slice(1) : "");
const subscribeRequestAnchor = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
};
const serverRequestAnchor = () => "";

export type CostFlowTabId = "overview" | "scope" | "ic" | "approvals" | "expense" | "requests" | "close" | "settings";
const COSTFLOW_TABS = new Set<CostFlowTabId>(["overview", "scope", "ic", "approvals", "expense", "requests", "close", "settings"]);

function resolveTab(t: string | null | undefined): CostFlowTabId | null {
  if (!t) return null;
  if (t === "requests") return "approvals";
  return COSTFLOW_TABS.has(t as CostFlowTabId) ? (t as CostFlowTabId) : null;
}

function PersonSelect({ finance, name, label, defaultValue }: { finance: Finance; name: string; label: string; defaultValue?: string }) {
  return <Select name={name} label={label} required defaultValue={defaultValue}><option value="">Chọn người xử lý</option>{finance.users.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</Select>;
}

function SummaryItem({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className={`tf-summary-item${accent ? " tf-summary-item-accent" : ""}`}>
      <span className="tf-summary-label">{label}</span>
      <span className="tf-summary-value">{value}</span>
      <span className="tf-summary-hint">{hint}</span>
    </div>
  );
}

export default function CostFlowPanel({ finance, user, projectHeading, initialTab }: { finance: Finance; user: { id: string; role: string }; projectHeading: ReactNode; initialTab?: string }) {
  const [tab, setTabState] = useState<CostFlowTabId | null>(resolveTab(initialTab));
  const [scopeCreateDialogOpen, setScopeCreateDialogOpen] = useState(false);
  const anchor = useSyncExternalStore(subscribeRequestAnchor, requestAnchor, serverRequestAnchor);
  const canCreate = finance.fullAccess && ["ADMIN", "ACCOUNT"].includes(user.role);
  const latestQuotation = finance.data.quotations?.at(-1);
  const latestQuotationGross = (() => {
    if (!latestQuotation) return undefined;
    try { return projectQuotation(latestQuotation).amount.gross; } catch { return undefined; }
  })();
  const cashTotal = finance.cash.reduce((sum, row) => sum + Number(row.amount || 0) * (row.direction === "IN" ? -1 : 1), 0);
  const missingEvidence = finance.data.expenses.filter(expense => !expense.invoiceId || !expense.paymentProofId).length;
  const pendingRequests = finance.requests.filter(request => request.state === "SUBMITTED").length;
  const effective = finance.data.revisions.find(revision => revision.effective);
  const metrics = finance.customerAccounting.margin;
  const users = new Map(finance.users.map(person => [person.id, person.name]));
  let working: ReturnType<typeof workingIcRevision> = undefined;
  let workingError = "";
  try { working = workingIcRevision(finance.data, finance.requests); } catch (error) { workingError = error instanceof Error ? error.message : "Cần đối soát revision"; }

  const tabs: [CostFlowTabId, string][] = finance.fullAccess
    ? [
        ["overview", "Tổng quan"],
        ["scope", "Scope & Báo giá"],
        ["ic", "Internal Cost"],
        ["expense", "Actual Cost"],
        ["approvals", "Hồ sơ & Trình duyệt"],
        ["close", "Tiền & Quyết toán"],
        ...(user.role === "ADMIN" ? [["settings", "Phân công"]] as [CostFlowTabId, string][] : [])
      ]
    : [["approvals", "Hồ sơ được giao"]];
  const activeTab: CostFlowTabId = anchor ? "approvals" : tab && tabs.some(([id]) => id === tab) ? tab : finance.fullAccess ? "overview" : "approvals";

  const setTab = (next: string) => {
    const resolved = resolveTab(next);
    if (!resolved) return;
    setTabState(resolved);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", resolved);
    const clearedRequestAnchor = resolved !== "approvals" && url.hash.startsWith("#request-");
    if (clearedRequestAnchor) url.hash = "";
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (clearedRequestAnchor) window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  const openApproval = (requestId: string) => {
    setTabState("approvals");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "approvals");
    url.hash = `request-${requestId}`;
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  const openAdvance = (params: { kind: "ADVANCE" | "VENDOR_PAYMENT"; recipientKey: string; amount: string; title: string; scheduleMilestoneId?: string }) => {
    setTabState("approvals");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "approvals");
    url.searchParams.set("kind", params.kind);
    url.searchParams.set("recipientKey", params.recipientKey);
    url.searchParams.set("amount", params.amount);
    if (params.title) url.searchParams.set("title", params.title);
    if (params.scheduleMilestoneId) url.searchParams.set("scheduleMilestoneId", params.scheduleMilestoneId);
    url.hash = "";
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    window.dispatchEvent(new Event("popstate"));
  };

  const worksheetHref = (revision?: IcRevision) => {
    if (revision) {
      const draft = (finance.data.quotationDrafts ?? []).find(value => value.createdBy === user.id && (value.id === revision.pairedDraftId || value.icRevisionId === revision.id));
      if (draft) {
        const sourceId = draft.sourceQuotationId ?? draft.latestQuotationId ?? revision.quotationId;
        if (draft.workspaceMode === "ic" && sourceId) return `/projects/${finance.project.id}/costflow/quotations/${sourceId}/ic?draftId=${encodeURIComponent(draft.id)}`;
        return `/projects/${finance.project.id}/costflow/paired?draftId=${encodeURIComponent(draft.id)}`;
      }
      return `/projects/${finance.project.id}/costflow/paired?revisionId=${encodeURIComponent(revision.id)}`;
    }
    return `/projects/${finance.project.id}/costflow/paired${latestQuotation ? `?quotationId=${encodeURIComponent(latestQuotation.id)}` : ""}`;
  };

  useEffect(() => {
    const syncFromUrl = () => {
      const next = new URL(window.location.href).searchParams.get("tab");
      if (next && COSTFLOW_TABS.has(next as CostFlowTabId)) setTabState(next as CostFlowTabId);
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);
  useEffect(() => {
    if (activeTab === "approvals" && anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [activeTab, anchor]);

  return <div className="space-y-4">
    <section className="tf-costflow-hero">
      <div className="tf-costflow-hero-heading">{projectHeading}<div className="flex flex-wrap items-center gap-2">
        {activeTab === "overview" && <Link className="tf-button-secondary" href={WORKFLOW_HUB_HREF}>Hồ sơ & Trình duyệt</Link>}
        {activeTab === "scope" && canCreate && !finance.data.closed && (
          <Button size="sm" onClick={() => setScopeCreateDialogOpen(true)}>
            <Plus size={15} aria-hidden="true" />Tạo báo giá mới
          </Button>
        )}
        {activeTab === "ic" && canCreate && !finance.data.closed && (
          <Link className="tf-button-primary tf-button-size-sm" href={worksheetHref(working ?? effective)}>
            <Plus size={15} aria-hidden="true" />{working ? "Tiếp tục IC" : "Tạo IC"}
          </Link>
        )}
        {activeTab === "approvals" && canCreate && !finance.data.closed && (
          <Button size="sm" onClick={() => {
            setTab("approvals");
            const url = new URL(window.location.href);
            url.searchParams.set("tab", "approvals");
            url.searchParams.set("openCreateRequest", "1");
            window.history.pushState(null, "", `${url.pathname}${url.search}`);
            window.dispatchEvent(new Event("popstate"));
          }}><FilePlus2 size={15} aria-hidden="true" />Lập hồ sơ chi</Button>
        )}
      </div></div>
      <ModuleTabs label="CostFlow" tabs={tabs.map(([id, label]) => ({ id, label, ...(id === "approvals" ? { count: pendingRequests } : {}) }))} active={activeTab} onChange={setTab} />
    </section>

    {finance.fullAccess && activeTab === "overview" && (
      <div className="space-y-3">
        <div className="tf-summary-strip">
          <SummaryItem
            label="Báo giá hiện hành"
            value={latestQuotationGross ? displayMoney(latestQuotationGross) : "Chưa có"}
            hint={latestQuotation ? `BG-${latestQuotation.number} · gồm VAT` : "Tạo từ Scope & Báo giá"}
          />
          <SummaryItem
            label="IC hiệu lực"
            value={effective ? displayMoney(totals(completeIcLines(effective.lines).map(line => line.cost)).net) : "Chưa có"}
            hint={effective ? `Revision ${effective.number} · net` : "Cần Quản lý duyệt"}
          />
          <SummaryItem
            label="AC phát sinh"
            value={displayMoney(metrics.incurredNet)}
            hint={`${finance.data.expenses.length} khoản chi · net`}
          />
          <SummaryItem
            label="Tiền thực tế"
            value={displayMoney(String(cashTotal))}
            hint={`${finance.cash.length} giao dịch · chi trừ thu hoàn`}
            accent
          />
        </div>
        {(pendingRequests > 0 || missingEvidence > 0) && (
          <Alert tone="warning" title="Cần xử lý">
            <div className="text-xs space-y-1">
              {pendingRequests > 0 && (
                <p>
                  Có <strong>{pendingRequests}</strong> hồ sơ đang chờ duyệt.{" "}
                  <button type="button" className="tf-link font-semibold underline" onClick={() => setTab("approvals")}>
                    Mở tab Hồ sơ & Trình duyệt
                  </button>
                </p>
              )}
              {missingEvidence > 0 && (
                <p>
                  Có <strong>{missingEvidence}</strong> khoản chi AC còn thiếu hóa đơn hoặc bằng chứng chi.{" "}
                  <button type="button" className="tf-link font-semibold underline" onClick={() => setTab("expense")}>
                    Mở tab Actual Cost
                  </button>
                </p>
              )}
            </div>
          </Alert>
        )}
      </div>
    )}

    {activeTab === "overview" && <div className="tf-workspace-grid">
      <Panel><div className="tf-section-heading"><div><h2>{finance.data.revisions.length ? "Hồ sơ gần đây" : "Bắt đầu ngân sách dự án"}</h2><p>Theo dõi dự toán, hồ sơ chi và tiền thực tế trong cùng project.</p></div></div>
        {finance.requests.length ? <Table caption="Các hồ sơ cập nhật gần đây" hideCaption className="tf-overview-request-table"><thead><tr><th scope="col">Hồ sơ</th><th scope="col">Loại</th><th scope="col">Trạng thái</th></tr></thead><tbody>{finance.requests.slice(0, 5).map(request => <tr key={request.id}><td><button type="button" className="tf-inbox-row-title text-left" onClick={() => openApproval(request.id)}>{request.title}</button></td><td>{KIND_LABELS[request.kind] ?? request.kind}</td><td><Badge tone={STATE_TONES[request.state] ?? "neutral"}>{STATE_LABELS[request.state] ?? request.state}</Badge></td></tr>)}</tbody></Table> : <div className="py-8"><p className="mb-2 text-lg font-semibold">Project chưa có IC</p><p className="mb-6 max-w-lg text-sm text-[var(--text-secondary)]">Tạo dự toán đầu tiên, chọn nguồn và nhập chi phí theo từng hạng mục.</p>{canCreate && !finance.data.closed && <Link className="tf-button-primary" href={worksheetHref()}><Plus size={16} aria-hidden="true" />Tạo IC đầu tiên</Link>}</div>}
      </Panel>
      <aside className="tf-summary-card"><h3>Thiết lập project</h3><div className="mt-4 space-y-4">{[["Kế toán", finance.data.config.accountantId], ["CEO", finance.data.config.ceoId], ["Quản lý đóng/mở", finance.data.config.managerId]].map(([label, id]) => <div key={label}><p className="tf-list-meta">{label}</p><p className={`mt-1 text-sm font-medium${!id ? " text-[var(--warning)]" : ""}`}>{users.get(id) ?? "Chưa phân công"}</p></div>)}{user.role === "ADMIN" && <Button variant="secondary" size="sm" onClick={() => setTab("settings")}>Cập nhật phân công<ArrowRight size={14} aria-hidden="true" /></Button>}<div className="border-t border-[var(--border)] pt-4"><Link className="tf-link inline-flex items-center gap-2 text-sm" href={`/projects/${finance.project.id}?tab=files`}><FileText size={15} aria-hidden="true" />Tài liệu project</Link><p className="tf-ui-help">Chứng từ đã lưu được dùng cho hồ sơ chi.</p></div></div></aside>
    </div>}

    {activeTab === "scope" && <div className="space-y-6"><QuotationPanel userId={user.id} finance={finance} canCreate={canCreate && !finance.data.closed} createDialogOpen={scopeCreateDialogOpen} onOpenCreateChange={setScopeCreateDialogOpen} /><CustomerAcceptanceExport finance={finance} canManage={canCreate} /><CustomerLiquidationPanel finance={finance} canManage={finance.canManageCustomerAccounting} /></div>}
    {activeTab === "settings" && <Panel><h2 className="mb-4 font-semibold">Phân công tài chính</h2><ActionForm finance={finance} command="CONFIGURE" label="Lưu phân công"><PersonSelect finance={finance} label="Kế toán" name="accountantId" defaultValue={finance.data.config.accountantId} /><PersonSelect finance={finance} label="CEO" name="ceoId" defaultValue={finance.data.config.ceoId} /><PersonSelect finance={finance} label="Quản lý phụ trách project (đóng/mở tài chính)" name="managerId" defaultValue={finance.data.config.managerId} /><fieldset className="space-y-2 rounded-lg border border-[var(--border)] p-3"><legend className="px-1 text-sm font-semibold">Operations theo dõi thanh toán NCC</legend><p className="tf-ui-help">Chỉ thành viên đang hoạt động của Project. Phân công này không cấp quyền DD, Kế toán, xác nhận tiền hoặc đóng tài chính.</p>{finance.project.members.map(member => { const person = finance.users.find(item => item.id === member.userId); return person ? <label key={person.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="operationUserIds" value={person.id} defaultChecked={(finance.data.config.operationUserIds ?? []).includes(person.id)} /><span>{person.name}</span></label> : null; })}</fieldset><p className="tf-ui-help">Bước Quản lý khi trình IC/hồ sơ chi lấy theo quản lý trực tiếp của người lập.</p></ActionForm></Panel>}
    {activeTab === "ic" && <InternalCostPanel finance={finance} user={user} canCreate={canCreate && !finance.data.closed} working={working} workingError={workingError} onOpenApproval={openApproval} onOpenAdvance={openAdvance} />}
    {activeTab === "expense" && <ActualCostPanel finance={finance} user={user} canCreate={canCreate} onSelectTab={setTab} />}
    {activeTab === "approvals" && <ApprovalRequestsPanel finance={finance} user={user} canCreate={canCreate} />}
    {activeTab === "close" && <SettlementPanel finance={finance} user={user} canCreate={canCreate} />}
  </div>;
}
