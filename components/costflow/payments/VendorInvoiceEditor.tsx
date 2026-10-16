"use client";

import { useActionState, useState } from "react";
import { vendorPaymentAction } from "@/app/actions/costflow";
import type { Finance } from "@/components/CostFlowPanel";
import { SignaturePad } from "@/components/SignaturePad";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert, Panel, Table } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";

export function VendorInvoiceEditor({ finance, onBack, onCreated }: { finance: Finance; onBack: () => void; onCreated: () => void }) {
  const eligible = finance.actualCosts?.lines.filter(line => line.source === "normalized" && line.approvalState === "APPROVED" && line.fundingSource === "VENDOR_PAYMENT" && line.recipientKey.startsWith("SUPPLIER:") && line.versionId && line.approvalId && line.approvalAttemptId) ?? [];
  const recipients = [...new Set(eligible.map(line => line.recipientKey))];
  const [recipientKey, setRecipientKey] = useState(recipients[0] ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [signatureData, setSignatureData] = useState("");
  const [signaturePin, setSignaturePin] = useState("");
  const [signOpen, setSignOpen] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(vendorPaymentAction, {});
  const supplierId = recipientKey.split(":")[1];
  const supplier = finance.suppliers.find(item => item.id === supplierId);
  const rows = eligible.filter(line => line.recipientKey === recipientKey);
  const selections = rows.flatMap(line => {
    const amount = amounts[line.id] ?? "";
    return amount && line.versionId && line.approvalId && line.approvalAttemptId ? [{ stableLineId: line.stableLineId, versionId: line.versionId, approvalId: line.approvalId, approvalAttemptId: line.approvalAttemptId, amount }] : [];
  });

  return <Panel className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">ĐNTT sau AC</h3><p className="tf-ui-help">Chỉ dùng AC đã được DD duyệt với nguồn VENDOR_PAYMENT. Hóa đơn VAT là chứng từ thanh toán; minh chứng IC chỉ hiển thị qua lineage lịch sử.</p></div><Button variant="ghost" onClick={onBack}>ĐNTU trước AC</Button></div>
    {!eligible.length ? <Alert tone="warning" title="Chưa có AC đủ điều kiện">Cần AC normalized đã duyệt, nguồn Thanh toán NCC và NCC đã chọn từ danh bạ công ty.</Alert> : <form action={action} className="space-y-4">
      <input type="hidden" name="projectId" value={finance.project.id} />
      <input type="hidden" name="recipientKey" value={recipientKey} />
      <input type="hidden" name="acSelections" value={JSON.stringify(selections)} />
      <input type="hidden" name="idempotencyKey" value={`DNTT:${finance.project.id}:${idempotencyKey}`} />
      <input type="hidden" name="signatureData" value={signatureData} />
      <input type="hidden" name="signaturePin" value={signaturePin} />
      <Input name="title" label="Tên hồ sơ" required placeholder="ĐNTT hóa đơn NCC" />
      <Select label="Nhà cung cấp / tài khoản" value={recipientKey} onChange={event => { setRecipientKey(event.target.value); setAmounts({}); }}>
        {recipients.map(key => { const [,, bankId] = key.split(":"); const owner = finance.suppliers.find(item => item.id === key.split(":")[1]); const bank = owner?.accounts.find(item => item.id === bankId); return <option key={key} value={key}>{owner?.version.legalName} · {bank?.bankName} •••• {bank?.accountLast4}</option>; })}
      </Select>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input name="invoiceNumber" label="Số hóa đơn" required />
        <Input name="symbol" label="Ký hiệu" required />
        <Input name="issuedAt" type="date" label="Ngày hóa đơn" required />
        <Input name="sellerTaxCode" label="MST người bán" required defaultValue={supplier?.version.taxCode ?? ""} />
        <Input name="netAmount" label="Tiền trước VAT" inputMode="numeric" required />
        <Input name="vatAmount" label="Tiền VAT" inputMode="numeric" required />
        <Input name="grossAmount" label="Tổng thanh toán" inputMode="numeric" required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Hóa đơn XML<input className="mt-1 block w-full text-sm" type="file" name="invoiceXml" accept=".xml,application/xml,text/xml" /></label>
        <label className="text-sm font-medium">Hóa đơn PDF<input className="mt-1 block w-full text-sm" type="file" name="invoicePdf" accept=".pdf,application/pdf" /></label>
      </div>
      <Table caption="AC đã duyệt đủ điều kiện thanh toán"><thead><tr><th>Chọn / số tiền</th><th>Nội dung</th><th>AC đã duyệt</th><th>Đã gắn hóa đơn</th><th>Lineage IC</th></tr></thead><tbody>{rows.map(line => {
        const remaining = BigInt(line.amount) - BigInt(line.vendorInvoiceAppliedAmount);
        return <tr key={line.id}><td><Input aria-label={`Số tiền áp dụng ${line.description}`} inputMode="numeric" value={amounts[line.id] ?? ""} onChange={event => setAmounts(current => ({ ...current, [line.id]: event.target.value.replace(/\D/g, "") }))} placeholder={remaining.toString()} /></td><td>{line.description}</td><td>{displayMoney(line.amount)}</td><td>{displayMoney(line.vendorInvoiceAppliedAmount)}</td><td>IC {line.revisionId ?? "phát sinh"}/{line.icLineId ?? "ngoài IC"}</td></tr>;
      })}</tbody></Table>
      <Alert tone="info" title="Một nghĩa vụ cho một hóa đơn">Có thể tải XML, PDF hoặc cả hai nếu cùng metadata. Hai file không tạo hai nghĩa vụ thanh toán.</Alert>
      {state.error && <Alert tone="danger" title="Chưa trình được ĐNTT">{state.error}</Alert>}
      {state.success && <Alert tone="success" title="Đã tạo hồ sơ"><span>{state.success}</span><Button size="sm" variant="ghost" onClick={onCreated}>Đóng</Button></Alert>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={() => setSignOpen(true)}>{signatureData ? "Ký lại" : "Ký số người lập"}</Button><Button type="submit" disabled={pending || !signatureData || !selections.length}>{pending ? "Đang trình…" : "Trình ĐNTT sau AC"}</Button></div>
    </form>}
    <SignaturePad open={signOpen} onClose={() => setSignOpen(false)} onConfirm={(data, pin) => { setSignatureData(data); setSignaturePin(pin ?? ""); setSignOpen(false); }} title="Ký số người lập — ĐNTT sau AC" />
  </Panel>;
}
