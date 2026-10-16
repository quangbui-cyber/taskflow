"use client";

import Link from "next/link";
import { useActionState } from "react";
import { supplierAction } from "@/app/actions/costflow";
import type { Finance, Request } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import { PaymentLineDiscussion } from "./PaymentLineDiscussion";

type Dossier = NonNullable<Finance["paymentDossiers"]>[number];
type SupplierSnapshot = Dossier["supplierSnapshots"][number];

const CHANGE_KIND_LABELS: Record<string, string> = {
  ADDED: "Thêm mới",
  REMOVED: "Đã xóa",
  CHANGED: "Đã sửa",
};

const FIELD_LABELS: Record<string, string> = {
  title: "Tên hồ sơ",
  milestone: "Mốc hồ sơ",
  explanation: "Giải trình",
  expectedSettlementDate: "Hạn hoàn ứng",
  amount: "Số tiền",
  description: "Nội dung",
  recipientKey: "Người nhận",
  lineId: "Dòng IC",
};

function SupplierVerificationForm({ projectId, snapshot }: { projectId: string; snapshot: SupplierSnapshot }) {
  const [state, action, pending] = useActionState(supplierAction, {});
  return <form action={action} className="space-y-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-3">
    <input type="hidden" name="supplierCommand" value="VERIFY" />
    <input type="hidden" name="projectId" value={projectId} />
    <input type="hidden" name="supplierId" value={snapshot.supplierId} />
    <input type="hidden" name="supplierVersionId" value={snapshot.frozenSupplierVersionId} />
    <input type="hidden" name="bankAccountId" value={snapshot.bankAccountId} />
    <input type="hidden" name="bankAccountVersionId" value={snapshot.frozenBankVersionId} />
    <p className="text-xs font-semibold">Quyết định xác minh tách biệt với quyết định duyệt hồ sơ</p>
    <Select name="decision" label="Kết quả xác minh" defaultValue="VERIFIED">
      <option value="VERIFIED">Thông tin khớp</option>
      <option value="REJECTED">Thông tin không khớp</option>
    </Select>
    <Textarea name="reason" label="Ghi chú / lý do từ chối" />
    <label className="block text-xs font-medium">Minh chứng tài khoản (không bắt buộc)
      <input className="mt-1 block w-full text-xs" type="file" name="proof" accept="image/*,.pdf" />
    </label>
    {state.error && <Alert tone="danger" title="Chưa lưu xác minh">{state.error}</Alert>}
    {state.success && <Alert tone="success" title="Đã lưu">{state.success}</Alert>}
    <Button type="submit" size="sm" disabled={pending}>{pending ? "Đang lưu…" : "Lưu xác minh phiên bản này"}</Button>
  </form>;
}

export function PaymentRequestReview({ finance, request, dossier, user }: { finance: Finance; request: Request; dossier: Dossier; user: { id: string; role: string } }) {
  const grouped = dossier.recipients.map(recipient => ({ recipient, lines: dossier.lines.filter(line => line.recipientKey === recipient.recipientKey) }));
  const warnings = request.payload && "warnings" in request.payload && Array.isArray(request.payload.warnings) ? request.payload.warnings : [];
  const revisionIds = [...new Set(dossier.lines.map(line => line.icRevisionId))];
  return <section className="tf-payment-review space-y-4" aria-label="Chi tiết ĐNTU đa khoản">
    <div><h3 className="font-bold text-[var(--foreground)]">{dossier.title}</h3><p className="tf-ui-help">Snapshot server bất biến · IC {revisionIds.join(", ")}</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3"><p className="text-xs text-[var(--text-secondary)]">Mốc hồ sơ chung</p><p className="mt-1 font-semibold">{dossier.milestone}</p></div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3"><p className="text-xs text-[var(--text-secondary)]">Tổng server</p><p className="mt-1 text-lg font-bold tabular-nums text-[var(--success)]">{displayMoney(dossier.totalAmount)}</p></div>
    </div>
    {warnings.length > 0 && <div className="rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-3 text-xs"><strong>Cảnh báo tham chiếu IC</strong><ul className="mt-1 list-disc pl-4">{warnings.map((warning, index) => <li key={index}>{typeof warning === "object" && warning && "message" in warning ? String(warning.message) : String(warning)}</li>)}</ul></div>}
    <div className="space-y-3">
      {grouped.map(({ recipient, lines }) => {
        const supplierSnapshot = dossier.supplierSnapshots.find(snapshot => snapshot.recipientKey === recipient.recipientKey);
        const beneficiary = recipient.recipientKey.startsWith("VENDOR:") ? finance.data.beneficiaries.find(item => item.id === recipient.recipientKey.slice("VENDOR:".length)) : undefined;
        const verification = supplierSnapshot
          ? supplierSnapshot.verificationStatus === "VERIFIED" ? "NCC đã xác minh đúng phiên bản" : supplierSnapshot.verificationStatus === "REJECTED" ? "NCC bị từ chối xác minh" : supplierSnapshot.verificationStatus === "STALE" ? "NCC đã có phiên bản mới — cần trả hồ sơ để lập lại" : "NCC cần xác minh phiên bản"
          : beneficiary ? (beneficiary.verifiedVersion === beneficiary.version ? "NCC đã xác minh đúng phiên bản" : "NCC cần xác minh phiên bản") : "Người nhận nội bộ";
        const currentStep = request.steps[request.currentStep];
        const canVerify = supplierSnapshot && supplierSnapshot.verificationStatus !== "STALE" && request.state === "SUBMITTED" && currentStep?.role === "ACCOUNTANT" && currentStep.assigneeId === user.id;
        return <section key={recipient.recipientKey} className="rounded-xl border border-[var(--border)] p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{recipient.displayName}</p><p className="text-xs text-[var(--text-secondary)]">{verification}</p></div><Badge tone="info">{displayMoney(recipient.totalAmount)}</Badge></div>
        {supplierSnapshot && <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg bg-[var(--surface-soft)] p-2"><strong>Phiên bản trong hồ sơ</strong><p>NCC v{supplierSnapshot.frozenSupplierVersion} · Tài khoản v{supplierSnapshot.frozenBankVersion}</p></div>
          <div className="rounded-lg bg-[var(--surface-soft)] p-2"><strong>Phiên bản hiện hành</strong><p>NCC {supplierSnapshot.currentSupplierVersion ? `v${supplierSnapshot.currentSupplierVersion}` : "không còn hoạt động"} · Tài khoản {supplierSnapshot.currentBankVersion ? `v${supplierSnapshot.currentBankVersion}` : "không còn hoạt động"}</p></div>
        </div>}
        {canVerify && supplierSnapshot.verificationStatus !== "VERIFIED" && <SupplierVerificationForm projectId={finance.project.id} snapshot={supplierSnapshot} />}
        {lines.map(line => <article key={line.id} className="rounded-lg bg-[var(--surface-soft)] p-3 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs text-[var(--text-secondary)]">Khoản {line.position + 1} · IC {line.icRevisionId}/{line.icLineId}</p><p className="font-medium">{line.description}</p></div><strong className="tabular-nums">{displayMoney(line.amount)}</strong></div>
          {line.evidenceManifest.length > 0 && <div className="tf-payment-review-document-links text-xs"><p className="font-semibold text-[var(--text-secondary)]">Tài liệu trong snapshot:</p><ul className="mt-1 space-y-1">{line.evidenceManifest.map((document, index) => <li key={document.id ?? `${line.id}:${index}`}>
            {document.id ? <span className="flex flex-wrap gap-2"><Link className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${document.id}`}>Tải {document.name}</Link><Link className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${document.id}/preview`} target="_blank" rel="noreferrer">Xem trước</Link></span> : <span>{document.name} · không có link được phép</span>}
          </li>)}</ul></div>}
          <PaymentLineDiscussion finance={finance} requestId={request.id} lineId={line.id} discussions={dossier.discussions.filter(discussion => discussion.lineId === line.id)} />
        </article>)}
      </section>;})}
    </div>
    {dossier.diff && dossier.diff.changed && <details className="rounded-xl border border-[var(--info)] bg-[var(--info-soft)] p-3" open>
      <summary className="cursor-pointer text-sm font-semibold">Thay đổi so với bản nguồn</summary>
      <div className="mt-3 space-y-2 text-xs">
        <p>Tổng phiếu: <strong>{displayMoney(dossier.diff.totals.before)}</strong> → <strong>{displayMoney(dossier.diff.totals.after)}</strong></p>
        {dossier.diff.headerChanges.map(change => <p key={change.field}><strong>{FIELD_LABELS[change.field] ?? change.field}</strong>: <del>{String(change.before)}</del> → <ins>{String(change.after)}</ins></p>)}
        {dossier.diff.lineChanges.map((change, index) => {
          const matchedLine = dossier.lines.find(l => l.stableKey === change.stableKey);
          const lineDesc = matchedLine?.description ? `"${matchedLine.description}"` : `Khoản ${index + 1}`;
          return <p key={change.stableKey}><Badge tone={change.kind === "ADDED" ? "success" : change.kind === "REMOVED" ? "danger" : "warning"}>{CHANGE_KIND_LABELS[change.kind] ?? change.kind}</Badge> <span className="font-medium">{lineDesc}</span>{change.changes.length ? ` · ${change.changes.map(item => FIELD_LABELS[item.field] ?? item.field).join(", ")}` : ""}</p>;
        })}
        {(dossier.diff.documents.added.length > 0 || dossier.diff.documents.removed.length > 0) && <p>Tài liệu: +{dossier.diff.documents.added.map(document => document.name).join(", ") || "—"}; -{dossier.diff.documents.removed.map(document => document.name).join(", ") || "—"}</p>}
      </div>
    </details>}
    {request.payload.explanation && <Alert tone="info" title="Giải trình của hồ sơ"><p className="whitespace-pre-wrap">{request.payload.explanation}</p></Alert>}
    <p className="tf-ui-help">Trao đổi theo khoản chỉ bổ sung ngữ cảnh. Quyết định duyệt, trả hoặc từ chối áp dụng một lần cho toàn bộ hồ sơ ở khu vực hành động bên dưới.</p>
  </section>;
}
