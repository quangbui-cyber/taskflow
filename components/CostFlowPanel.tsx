"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import ActionForm from "@/components/CostFlowActionForm";
import ActualCostPanel from "@/components/ActualCostPanel";
import ApprovalRequestsPanel from "@/components/ApprovalRequestsPanel";
import InternalCostPanel from "@/components/InternalCostPanel";
import PaymentCashPanel from "@/components/PaymentCashPanel";
import QuotationPanel from "@/components/QuotationPanel";
import SettlementPanel from "@/components/SettlementPanel";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Alert, Badge, Panel, Table } from "@/components/ui/Presentation";
import { MetricCard, ModuleTabs } from "@/components/ui/ModuleUI";
import { completeIcLines } from "@/lib/costflow/budgetDraft";
import { workingIcRevision } from "@/lib/costflow/budgetRevisions";
import { displayMoney, totals } from "@/lib/costflow/money";
import { projectQuotation } from "@/lib/costflow/quotationProjection";
import { margin } from "@/lib/costflow/reconciliation";
import type { CashRow, FinanceData, IcRevision, RequestPayload } from "@/lib/costflow/types";
import type { ApprovalStep } from "@/lib/workflow/approval";
import { ArrowRight, CircleDollarSign, FilePlus2, FileText, Layers3, Paperclip, Plus, TrendingUp, Wallet } from "lucide-react";

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
  project: { id: string; name: string; client?: { id: string; name: string } | null; members: { userId: string }[] };
  clients?: { id: string; name: string }[];
  fullAccess: boolean;
  version: number;
  data: FinanceData;
  requests: Request[];
  cash: CashRow[];
  users: { id: string; name: string; role: string }[];
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
    lines: { id: string; stableKey: string; position: number; description: string; amount: string; icRevisionId: string; icLineId: string; recipientKey: string }[];
    recipients: { recipientKey: string; recipientType: string; displayName: string; totalAmount: string }[];
  }[];
};

const KIND: Record<string, string> = { IC: "IC", AC_REVISION: "Sửa chi phí AC", ADVANCE: "Đề nghị tạm ứng", VENDOR_PAYMENT: "Đề nghị thanh toán NCC", REIMBURSEMENT: "Đề nghị Hoàn Tạm Ứng", CLOSE: "Đóng tài chính", REOPEN: "Mở lại tài chính", CANCEL: "Hủy hồ sơ" };
const STATE: Record<string, string> = { DRAFT: "Nháp", SUBMITTED: "Chờ duyệt", APPROVED: "Đã duyệt", RETURNED: "Đã trả", REJECTED: "Từ chối", WITHDRAWN: "Đã rút", CANCELLED: "Đã hủy" };
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

function PersonSelect({ finance, name, label, defaultValue }: { finance: Finance; name: string; label: string; defaultValue?: string }) {
  return <Select name={name} label={label} required defaultValue={defaultValue}><option value="">Chọn người xử lý</option>{finance.users.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</Select>;
}

export default function CostFlowPanel({ finance, user, projectHeading, initialTab }: { finance: Finance; user: { id: string; role: string }; projectHeading: ReactNode; initialTab?: string }) {
  const [tab, setTabState] = useState<CostFlowTabId | null>(initialTab && COSTFLOW_TABS.has(initialTab as CostFlowTabId) ? initialTab as CostFlowTabId : null);
  const anchor = useSyncExternalStore(subscribeRequestAnchor, requestAnchor, serverRequestAnchor);
  const [savedNotice, setSavedNotice] = useState("");
  const canCreate = finance.fullAccess && ["ADMIN", "ACCOUNT"].includes(user.role);
  const latestQuotation = finance.data.quotations?.at(-1);
  const latestQuotationGross = (() => {
    if (!latestQuotation) return undefined;
    try { return projectQuotation(latestQuotation).amount.gross; } catch { return undefined; }
  })();
  const cashTotal = finance.cash.reduce((sum, row) => sum + Number(row.amount || 0) * (row.direction === "IN" ? -1 : 1), 0);
  const missingEvidence = finance.data.expenses.filter(expense => !expense.invoiceId || !expense.paymentProofId).length;
  const effective = finance.data.revisions.find(revision => revision.effective);
  const metrics = margin(finance.data);
  const users = new Map(finance.users.map(person => [person.id, person.name]));
  let working: ReturnType<typeof workingIcRevision> = undefined;
  let workingError = "";
  try { working = workingIcRevision(finance.data, finance.requests); } catch (error) { workingError = error instanceof Error ? error.message : "Cần đối soát revision"; }

  const tabs: [CostFlowTabId, string][] = finance.fullAccess
    ? [["overview", "Tổng quan"], ["scope", "Scope & Báo giá"], ["ic", "Internal Cost"], ["approvals", "Trình duyệt"], ["expense", "Actual Cost"], ["requests", "Hồ sơ & tiền"], ["close", "Quyết toán"], ...(user.role === "ADMIN" ? [["settings", "Phân công"]] as [CostFlowTabId, string][] : [])]
    : [["approvals", "Hồ sơ được giao"]];
  const activeTab: CostFlowTabId = anchor ? "approvals" : tab && tabs.some(([id]) => id === tab) ? tab : finance.fullAccess ? "overview" : "approvals";

  const setTab = (next: string) => {
    if (!COSTFLOW_TABS.has(next as CostFlowTabId)) return;
    const resolved = next as CostFlowTabId;
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
        <Link className="tf-button-secondary" href="/workflow">Hồ sơ của tôi</Link>
        {canCreate && !finance.data.closed && <><Link className="tf-button-secondary tf-button-size-sm" href={worksheetHref(working ?? effective)}><Plus size={15} aria-hidden="true" />Tạo IC</Link><Button size="sm" onClick={() => setTab("requests")}><FilePlus2 size={15} aria-hidden="true" />Lập hồ sơ chi</Button></>}
      </div></div>
      <ModuleTabs label="CostFlow" tabs={tabs.map(([id, label]) => ({ id, label, ...(id === "approvals" ? { count: finance.requests.filter(request => request.state === "SUBMITTED").length } : {}) }))} active={activeTab} onChange={setTab} />
    </section>

    {finance.fullAccess && activeTab === "overview" && <div className="tf-metric-grid">
      <MetricCard label="Báo giá hiện hành" value={latestQuotationGross ? displayMoney(latestQuotationGross) : "Chưa có"} hint={latestQuotation ? `BG-${latestQuotation.number} · gồm VAT` : "Tạo từ Scope & Báo giá"} icon={CircleDollarSign} />
      <MetricCard label="IC hiệu lực" value={effective ? displayMoney(totals(completeIcLines(effective.lines).map(line => line.cost)).net) : "Chưa có"} hint={effective ? `Revision ${effective.number} · net` : "Cần Quản lý duyệt"} icon={Layers3} />
      <MetricCard label="AC phát sinh" value={displayMoney(metrics.incurred)} hint={`${finance.data.expenses.length} khoản chi · net`} icon={Wallet} />
      <MetricCard label="Tiền thực tế" value={displayMoney(String(cashTotal))} hint={`${finance.cash.length} giao dịch · chi trừ thu hoàn`} icon={TrendingUp} accent />
      <MetricCard label="Hồ sơ chờ xử lý" value={String(finance.requests.filter(request => request.state === "SUBMITTED").length)} hint="Mở tab Trình duyệt để xử lý" icon={FileText} />
      <MetricCard label="Chứng từ còn thiếu" value={String(missingEvidence)} hint="AC thiếu hóa đơn hoặc bằng chứng chi" icon={Paperclip} />
    </div>}
    {savedNotice && <Alert tone="success" title={savedNotice} />}

    {activeTab === "overview" && <div className="tf-workspace-grid">
      <Panel><div className="tf-section-heading"><div><h2>{finance.data.revisions.length ? "Hồ sơ gần đây" : "Bắt đầu ngân sách dự án"}</h2><p>Theo dõi dự toán, hồ sơ chi và tiền thực tế trong cùng project.</p></div><FileText size={20} className="text-[var(--text-secondary)]" aria-hidden="true" /></div>
        {finance.requests.length ? <Table caption="Các hồ sơ cập nhật gần đây"><thead><tr><th scope="col">Hồ sơ</th><th scope="col">Loại</th><th scope="col">Trạng thái</th></tr></thead><tbody>{finance.requests.slice(0, 5).map(request => <tr key={request.id}><td><button type="button" className="tf-inbox-row-title text-left" onClick={() => openApproval(request.id)}>{request.title}</button></td><td>{KIND[request.kind]}</td><td><Badge tone={request.state === "APPROVED" ? "success" : "neutral"}>{STATE[request.state]}</Badge></td></tr>)}</tbody></Table> : <div className="py-8"><p className="mb-2 text-lg font-semibold">Project chưa có IC</p><p className="mb-6 max-w-lg text-sm text-[var(--text-secondary)]">Tạo dự toán đầu tiên, chọn nguồn và nhập chi phí theo từng hạng mục.</p>{canCreate && !finance.data.closed && <Link className="tf-button-primary" href={worksheetHref()}><Plus size={16} aria-hidden="true" />Tạo IC đầu tiên</Link>}</div>}
      </Panel>
      <aside className="tf-summary-card"><h3>Thiết lập project</h3><div className="mt-4 space-y-4">{[["Kế toán", finance.data.config.accountantId], ["CEO", finance.data.config.ceoId], ["Quản lý đóng/mở", finance.data.config.managerId]].map(([label, id]) => <div key={label}><p className="tf-list-meta">{label}</p><p className={`mt-1 text-sm font-medium${!id ? " text-[var(--warning)]" : ""}`}>{users.get(id) ?? "Chưa phân công"}</p></div>)}{user.role === "ADMIN" && <Button variant="secondary" size="sm" onClick={() => setTab("settings")}>Cập nhật phân công<ArrowRight size={14} aria-hidden="true" /></Button>}<div className="border-t border-[var(--border)] pt-4"><Link className="tf-link inline-flex items-center gap-2 text-sm" href={`/projects/${finance.project.id}?tab=files`}><FileText size={15} aria-hidden="true" />Tài liệu project</Link><p className="tf-ui-help">Chứng từ đã lưu được dùng cho hồ sơ chi.</p></div></div></aside>
    </div>}

    {activeTab === "scope" && <QuotationPanel userId={user.id} finance={finance} canCreate={canCreate && !finance.data.closed} />}
    {activeTab === "settings" && <Panel><h2 className="mb-4 font-semibold">Phân công tài chính</h2><ActionForm finance={finance} command="CONFIGURE" label="Lưu phân công"><PersonSelect finance={finance} label="Kế toán" name="accountantId" defaultValue={finance.data.config.accountantId} /><PersonSelect finance={finance} label="CEO" name="ceoId" defaultValue={finance.data.config.ceoId} /><PersonSelect finance={finance} label="Quản lý phụ trách project (đóng/mở tài chính)" name="managerId" defaultValue={finance.data.config.managerId} /><p className="tf-ui-help">Bước Quản lý khi trình IC/hồ sơ chi lấy theo quản lý trực tiếp của người lập.</p></ActionForm></Panel>}
    {activeTab === "ic" && <InternalCostPanel finance={finance} user={user} canCreate={canCreate && !finance.data.closed} working={working} workingError={workingError} onOpenApproval={openApproval} />}
    {activeTab === "approvals" && <ApprovalRequestsPanel finance={finance} user={user} canCreate={canCreate} />}
    {activeTab === "expense" && <ActualCostPanel finance={finance} user={user} canCreate={canCreate} />}
    {activeTab === "requests" && <PaymentCashPanel finance={finance} user={user} canCreate={canCreate} onSelectTab={setTab} setSavedNotice={setSavedNotice} />}
    {activeTab === "close" && <SettlementPanel finance={finance} user={user} canCreate={canCreate} />}
  </div>;
}
