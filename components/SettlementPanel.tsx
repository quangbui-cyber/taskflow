"use client";

import { useMemo, useState } from "react";
import { FileClock, History, Landmark, ShieldCheck } from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import ActionForm from "@/components/CostFlowActionForm";
import PaymentLedgerTable from "@/components/costflow/payments/PaymentLedgerTable";
import SettlementProgressCards from "@/components/costflow/settlement/SettlementProgressCards";
import ProjectSettlementTable, { type SettlementVersionView } from "@/components/costflow/settlement/ProjectSettlementTable";
import SettlementExportActions from "@/components/costflow/settlement/SettlementExportActions";
import FinancialCloseModal from "@/components/costflow/settlement/FinancialCloseModal";
import SettlementEvidenceUploader from "@/components/costflow/settlement/SettlementEvidenceUploader";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import { recipientDisplayName } from "@/lib/costflow/labels";

type SettlementDossierView = {
  id: string;
  createdById: string;
  createdAt: string | Date;
  versions: SettlementVersionView[];
};

type SettlementFinance = Finance & { settlementDossier?: SettlementDossierView | null };

function sum(values: string[]) {
  return values.reduce((total, value) => total + BigInt(/^\d+$/.test(value) ? value : "0"), BigInt(0)).toString();
}

function percent(collected: string, target: string) {
  const denominator = BigInt(/^\d+$/.test(target) ? target : "0");
  if (denominator === BigInt(0)) return 0;
  const numerator = BigInt(/^-?\d+$/.test(collected) ? collected : "0");
  const ratio = numerator * BigInt(100) / denominator;
  return Number(ratio > BigInt(100) ? BigInt(100) : ratio < BigInt(0) ? BigInt(0) : ratio);
}

export default function SettlementPanel({ finance: baseFinance, user, canCreate }: {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
}) {
  const finance = baseFinance as SettlementFinance;
  const dossier = finance.settlementDossier ?? null;
  const current = dossier?.versions[0] ?? null;
  const [cashObligationId, setCashObligationId] = useState<string | null>(null);
  const users = useMemo(() => new Map(finance.users.map(person => [person.id, person.name])), [finance.users]);
  const recipientName = (key: string) => recipientDisplayName(key, users, finance.data.beneficiaries);
  const settlementRows = (finance.paymentLedger ?? []).filter(row => row.provenance === "settlement" && (!current || row.dossierVersionId === current.id));
  const warningLines = (finance.actualCosts?.lines ?? []).filter(line => line.source === "normalized" && line.reviewState !== "approved").map(line => ({ stableLineId: line.stableLineId, description: line.description }));
  const actualGross = current ? sum(current.obligations.map(item => item.approvedAcGross)) : "0";
  const advanceGross = current ? sum(current.obligations.map(item => item.disbursedAdvance)) : "0";
  const outstandingGross = current ? sum(current.obligations.map(item => {
    const payment = settlementRows.find(row => row.obligationId === item.id);
    return payment?.additionalOutBalance ?? payment?.refundInBalance ?? item.amountDue;
  })) : "0";
  const totalSources = Math.max(current?.obligations.length ?? 0, (current?.locks.length ?? 0) + warningLines.length);
  const internalComplete = !!current && current.request.state === "APPROVED" && current.locks.length > 0 && warningLines.length === 0 && outstandingGross === "0";
  const internalPercent = totalSources === 0 ? 0 : Math.round(((current?.locks.length ?? 0) / totalSources) * 100) * (outstandingGross === "0" ? 1 : 0.9);
  const customer = finance.customerAccounting;
  const liquidation = customer.currentLiquidation;
  const targetGross = customer.receivable.targetGross;
  const collectedGross = customer.receivable.collectedGross;
  const customerComplete = !!liquidation?.evidence?.id && customer.receivable.outstandingGross === "0";
  const closeBlockers = [
    ...(!current || current.request.state !== "APPROVED" ? ["Hồ sơ quyết toán cuối cùng chưa được CEO phê duyệt."] : []),
    ...(!current?.locks.length ? ["Nguồn AC/tạm ứng chưa có khóa SETTLED bất biến."] : []),
    ...(warningLines.length ? ["Còn dòng AC chưa được DD duyệt."] : []),
    ...(outstandingGross !== "0" ? ["Còn công nợ nội bộ hoặc Pending Disbursement chưa về 0."] : []),
    ...(!liquidation?.documentNumber || !liquidation?.signedAt || !liquidation?.evidence?.id ? ["Chưa có Biên bản thanh lý khách hàng đã ký kèm chứng từ."] : []),
    ...(customer.receivable.outstandingGross !== "0" ? ["Customer AR chưa về đúng 0."] : []),
  ];
  const selectedObligation = current?.obligations.find(item => item.id === cashObligationId) ?? null;
  const selectedPayment = selectedObligation ? settlementRows.find(row => row.obligationId === selectedObligation.id) : undefined;
  const selectedRemaining = selectedPayment?.additionalOutBalance ?? selectedPayment?.refundInBalance ?? selectedObligation?.amountDue ?? "0";
  const canManageCash = ["ADMIN", "ACCOUNT"].includes(user.role) && !finance.data.closed;
  const canEditDossier = canCreate && !!current && ["DRAFT", "RETURNED"].includes(current.request.state) && dossier?.createdById === user.id;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold tracking-tight">Quyết toán & đóng tài chính</h2><Badge tone={finance.data.closed ? "neutral" : "success"}>{finance.data.closed ? "Tài chính đã đóng" : "Tài chính đang mở"}</Badge></div><p className="mt-1 text-sm text-[var(--text-secondary)]">Một hồ sơ tổng hợp toàn Project; nguồn, phiên bản, người xử lý và kết quả luôn truy được.</p></div>
      {dossier && <Badge tone="info">Dossier ổn định · {dossier.id}</Badge>}
    </header>

    <SettlementProgressCards internal={{ percent: internalPercent, complete: internalComplete, settledSources: current?.locks.length ?? 0, totalSources, actualGross, advanceGross, outstandingGross }} customer={{ percent: percent(collectedGross, targetGross), complete: customerComplete, liquidationSigned: !!liquidation?.evidence?.id, liquidationGross: targetGross, collectedGross, outstandingGross: customer.receivable.outstandingGross }} />

    <Panel className="space-y-3">
      <div className="flex items-center gap-2"><ShieldCheck size={18} aria-hidden="true" /><h3 className="font-bold">Các trục trạng thái độc lập</h3></div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-6">
        <div><dt className="text-xs text-[var(--text-secondary)]">Trạng thái duyệt</dt><dd className="font-semibold">{current?.request.state ?? "Chưa có hồ sơ"}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Khóa quyết toán</dt><dd className="font-semibold">{current?.locks.length ? `${current.locks.length} khóa SETTLED` : "Chưa khóa"}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Tiến độ tiền</dt><dd className="font-semibold">{outstandingGross === "0" ? "Đã cân đối" : `Còn ${displayMoney(outstandingGross)}`}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Trạng thái ký</dt><dd className="font-semibold">{current?.request.state === "APPROVED" ? "Xem riêng trên bản xuất" : "Chưa đến bước ký"}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Công việc TaskFlow</dt><dd className="font-semibold">Không suy diễn từ Task DONE</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Đóng tài chính</dt><dd className="font-semibold">{finance.data.closed ? "CLOSED" : "OPEN"}</dd></div>
      </dl>
    </Panel>

    {!dossier && <Panel className="space-y-4"><EmptyState title="Chưa có hồ sơ quyết toán tổng hợp" description="Account/Project Owner tạo hồ sơ một lần; máy chủ tự nạp AC đã DD duyệt và tạm ứng đã giải ngân." />{canCreate && <ActionForm finance={finance} command="CREATE_SETTLEMENT_DOSSIER" label="Tạo hồ sơ quyết toán tổng hợp"><input type="hidden" name="settlementVersion" value="0" /><Input name="title" label="Tên hồ sơ" defaultValue="Hồ sơ quyết toán tổng hợp" required /></ActionForm>}</Panel>}

    {current && <>
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">Hồ sơ quyết toán tổng hợp · v{current.version}</h3><p className="text-xs text-[var(--text-secondary)]">Request {current.request.id} · canonical hash {current.canonicalHash.slice(0, 12)}…</p></div><Badge tone={current.request.state === "APPROVED" ? "success" : current.request.state === "RETURNED" ? "danger" : "warning"}>{current.request.state}</Badge></div>
        <ProjectSettlementTable projectId={finance.project.id} version={current} warnings={warningLines} paymentRows={settlementRows} recipientName={recipientName} />
        {canEditDossier && <div className="grid gap-4 lg:grid-cols-2">
          <SettlementEvidenceUploader finance={finance} requestId={current.request.id} settlementVersion={current.request.version} obligations={current.obligations} evidence={current.evidence} canEdit recipientName={recipientName} />
          <ActionForm finance={finance} command={current.request.state === "RETURNED" ? "RESUBMIT_SETTLEMENT_DOSSIER" : "SUBMIT_SETTLEMENT_DOSSIER"} requestId={current.request.id} label={current.request.state === "RETURNED" ? "Gửi lại từ Quản lý" : "Gửi duyệt Manager → Accountant → CEO"}>
            <input type="hidden" name="settlementVersion" value={current.request.version} />
            {current.request.state === "RETURNED" && <Textarea name="reason" label="Phản hồi sửa hồ sơ" required />}
            <Alert tone="info" title="Máy chủ sẽ tính lại toàn bộ">AC chưa duyệt và ba mục chứng từ cố định là các blocker tách biệt; giao diện không có quyền bỏ qua.</Alert>
          </ActionForm>
        </div>}
        {!canEditDossier && <SettlementEvidenceUploader finance={finance} requestId={current.request.id} settlementVersion={current.request.version} obligations={current.obligations} evidence={current.evidence} canEdit={false} recipientName={recipientName} />}
        {canManageCash && current.request.state === "APPROVED" && current.obligations.some(item => item.amountDue !== "0") && <div className="flex flex-wrap gap-2">{current.obligations.filter(item => item.amountDue !== "0").map(item => <Button key={item.id} variant="secondary" className="min-h-11" disabled={settlementRows.find(row => row.obligationId === item.id)?.cashProgress === "DA_CHI_DU"} onClick={() => setCashObligationId(item.id)}>{item.direction === "REFUND" ? "Ghi nhận thu hoàn" : "Xác nhận chi thêm"} · {recipientName(item.recipientKey)}</Button>)}</div>}
      </Panel>
      <SettlementExportActions projectId={finance.project.id} versionId={current.id} version={current.version} state={current.request.state} />
    </>}

    <Panel className="space-y-4"><div className="flex items-center gap-2"><Landmark size={18} aria-hidden="true" /><div><h3 className="font-bold">Pending Disbursement và sổ tiền</h3><p className="text-xs text-[var(--text-secondary)]">Tái sử dụng cùng read model Phase 7; người thụ hưởng, provenance, đã chi lũy kế và số dư không bị tách thành một ledger khác.</p></div></div><PaymentLedgerTable projectId={finance.project.id} rows={finance.paymentLedger ?? []} /></Panel>

    <FinancialCloseModal finance={finance} blockers={closeBlockers} hasDossier={!!dossier} canRequest={finance.fullAccess && (finance.project.ownerId === user.id || finance.project.members.some(member => member.userId === user.id))} />

    {dossier && <Panel className="space-y-4"><div className="flex items-center gap-2"><FileClock size={18} aria-hidden="true" /><div><h3 className="font-bold">Lịch sử version / attempt của cùng dossier</h3><p className="text-xs text-[var(--text-secondary)]">Mở lại hoặc thay thế tạo nguồn mới có liên kết; prior bytes, hash, cash, khóa và chữ ký giữ nguyên.</p></div></div><ol className="space-y-2">{dossier.versions.map(version => <li key={version.id} className="rounded-lg border border-[var(--border)] p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>v{version.version} · {version.request.state}</strong><Badge tone={version.id === current?.id ? "info" : "neutral"}>{version.id === current?.id ? "Hiện hành" : "Bất biến"}</Badge></div><p className="mt-1 text-xs text-[var(--text-secondary)]">{version.supersedesId ? `Kế tiếp ${version.supersedesId}` : "Phiên bản đầu"} · {version.replacementReason || "Không có lý do thay thế"}</p><p className="mt-1 break-all font-mono text-xs">{version.canonicalHash}</p></li>)}</ol></Panel>}

    <Panel className="space-y-3"><div className="flex items-center gap-2"><History size={18} aria-hidden="true" /><h3 className="font-bold">Nhật ký CostFlow ({finance.history.length})</h3></div>{finance.history.length ? <ol className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto">{finance.history.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span><strong>v{item.version}</strong> · {item.action} · {users.get(item.actorId) ?? "Người xử lý"}</span><time>{new Date(item.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time></li>)}</ol> : <p className="text-xs text-[var(--text-secondary)]">Chưa có sự kiện.</p>}</Panel>

    <Dialog open={!!selectedObligation} onClose={() => setCashObligationId(null)} title={selectedObligation?.direction === "REFUND" ? "Ghi nhận thu hoàn tạm ứng" : "Xác nhận chi bổ sung"} description="Giao dịch tiền là sự kiện riêng, bắt buộc chứng từ và idempotency key; duyệt hồ sơ không tự ghi tiền.">
      {selectedObligation && <ActionForm finance={finance} command="SETTLEMENT_CASH" requestId={current?.request.id} label="Ghi nhận giao dịch thực tế" onSuccess={() => setCashObligationId(null)}>
        <input type="hidden" name="settlementObligationId" value={selectedObligation.id} /><input type="hidden" name="recipientKey" value={selectedObligation.recipientKey} /><input type="hidden" name="direction" value={selectedObligation.direction === "REFUND" ? "IN" : "OUT"} />
        <Alert tone="warning" title="Không vượt số dư server">Còn phải thực hiện: {displayMoney(selectedRemaining)} · người thụ hưởng {recipientName(selectedObligation.recipientKey)}.</Alert>
        <Input name="amount" label="Số tiền VND" inputMode="numeric" pattern="[1-9][0-9]*" defaultValue={selectedRemaining} required />
        <Select name="channel" label="Hình thức giao dịch" required><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option><option value="OTHER">Khác</option></Select>
        <Input name="reference" label="Mã giao dịch / chứng từ" required /><Input name="occurredAt" label="Thời điểm giao dịch" type="datetime-local" required /><Input name="idempotencyKey" label="Mã chống ghi trùng" hint="Dùng mã duy nhất từ chứng từ ngân hàng/phiếu quỹ." required /><Input className="min-h-11" name="proof" label="UNC / phiếu thu chi / biên lai" type="file" accept=".pdf,.jpg,.jpeg,.png" required />
      </ActionForm>}
    </Dialog>
  </div>;
}
