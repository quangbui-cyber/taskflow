"use client";

import { useActionState, useEffect, useRef } from "react";
import { supplierAction, type SupplierActionState } from "@/app/actions/costflow";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Alert, Panel } from "@/components/ui/Presentation";
import type { CompanySupplier } from "@/lib/costflow/supplierReadModel";

const initialState: SupplierActionState = {};

function Result({ state }: { state: SupplierActionState }) {
  if (state.error) return <Alert tone="danger" title="Chưa lưu được">{state.error}</Alert>;
  if (state.success) return <Alert tone="success" title="Đã lưu">{state.success}</Alert>;
  return null;
}

function Submit({ pending, children = "Lưu thay đổi" }: { pending: boolean; children?: string }) {
  return <Button type="submit" loading={pending} loadingLabel="Đang lưu…">{children}</Button>;
}

export function SupplierEditor({
  supplier,
  initialLegalName = "",
  embedded = false,
  projectId,
  onCreated,
}: {
  supplier?: CompanySupplier;
  initialLegalName?: string;
  embedded?: boolean;
  projectId?: string;
  onCreated?: (supplier: { id: string; name: string }) => void;
}) {
  const [state, action, pending] = useActionState(supplierAction, initialState);
  const createFormRef = useRef<HTMLFormElement>(null);
  const reportedSupplierId = useRef<string | null>(null);

  useEffect(() => {
    if (!state.supplierId || !onCreated || reportedSupplierId.current === state.supplierId) return;
    const name = String(new FormData(createFormRef.current ?? undefined).get("legalName") ?? "").trim();
    if (!name) return;
    reportedSupplierId.current = state.supplierId;
    onCreated({ id: state.supplierId, name });
  }, [onCreated, state.supplierId]);

  if (!supplier) {
    const createForm = <>
      {!embedded && <div><h2 className="text-lg font-semibold">Thêm nhà cung cấp</h2><p className="tf-ui-help">Tạo một NCC dùng chung toàn công ty. File xác minh không bắt buộc.</p></div>}
      <form ref={createFormRef} action={action} className="space-y-4">
      <input type="hidden" name="supplierCommand" value="CREATE" />
      {projectId && <input type="hidden" name="projectId" value={projectId} />}
      <div className="grid gap-3 md:grid-cols-2"><Input name="legalName" label="Tên pháp lý" defaultValue={initialLegalName} required /><Input name="taxCode" label="Mã số thuế" /></div>
      <Input name="address" label="Địa chỉ" />
      <div className="grid gap-3 md:grid-cols-2"><Input name="contactName" label="Người liên hệ" /><Input name="contactPhone" label="Điện thoại" /><Input name="contactEmail" label="Email" type="email" /></div>
      <div className="grid gap-3 md:grid-cols-2"><Input name="bankName" label="Ngân hàng" required /><Input name="bankCode" label="Mã ngân hàng" /><Input name="accountHolder" label="Tên tài khoản" required /><Input name="accountNumber" label="Số tài khoản" required /></div>
      <Result state={state} /><Submit pending={pending}>Thêm NCC</Submit>
      </form>
    </>;
    return embedded ? <div className="space-y-4">{createForm}</div> : <Panel className="space-y-4">{createForm}</Panel>;
  }

  return <div className="space-y-4">
    <form action={action} className="space-y-4">
      <input type="hidden" name="supplierCommand" value="UPDATE_LEGAL" /><input type="hidden" name="supplierId" value={supplier.id} /><input type="hidden" name="expectedVersion" value={supplier.version.version} />
      <div className="grid gap-3 md:grid-cols-2"><Input name="legalName" label="Tên pháp lý" defaultValue={supplier.version.legalName} required /><Input name="taxCode" label="Mã số thuế" defaultValue={supplier.version.taxCode ?? ""} /></div>
      <Input name="address" label="Địa chỉ" defaultValue={supplier.version.address} />
      <div className="grid gap-3 md:grid-cols-3"><Input name="contactName" label="Người liên hệ" defaultValue={supplier.version.contactName} /><Input name="contactPhone" label="Điện thoại" defaultValue={supplier.version.contactPhone} /><Input name="contactEmail" label="Email" defaultValue={supplier.version.contactEmail} /></div>
      <Textarea name="reason" label="Lý do thay đổi" required />
      <Result state={state} /><Submit pending={pending} />
    </form>
    {supplier.accounts.map(account => <form action={action} className="space-y-3 border-t border-[var(--border)] pt-4" key={account.id}>
      <input type="hidden" name="supplierCommand" value="UPDATE_BANK" /><input type="hidden" name="supplierId" value={supplier.id} /><input type="hidden" name="bankAccountId" value={account.id} /><input type="hidden" name="expectedVersion" value={account.version} />
      <h4 className="font-semibold">{account.bankName} · •••• {account.accountLast4}{account.isPrimary ? " · Tài khoản mặc định" : ""}</h4>
      <div className="grid gap-3 md:grid-cols-2"><Input name="bankName" label="Ngân hàng" defaultValue={account.bankName} required /><Input name="bankCode" label="Mã ngân hàng" defaultValue={account.bankCode} /><Input name="accountHolder" label="Tên tài khoản" defaultValue={account.accountHolder} required /><Input name="accountNumber" label="Số tài khoản mới" required /></div>
      <Textarea name="reason" label="Lý do thay đổi" required />
      <Submit pending={pending}>Tạo phiên bản tài khoản</Submit>
    </form>)}
    <form action={action} className="space-y-3 border-t border-[var(--border)] pt-4">
      <input type="hidden" name="supplierCommand" value="ADD_BANK" /><input type="hidden" name="supplierId" value={supplier.id} />
      <h4 className="font-semibold">Thêm tài khoản ngân hàng</h4>
      <div className="grid gap-3 md:grid-cols-2"><Input name="bankName" label="Ngân hàng" required /><Input name="bankCode" label="Mã ngân hàng" /><Input name="accountHolder" label="Tên tài khoản" required /><Input name="accountNumber" label="Số tài khoản" required /></div>
      <Textarea name="reason" label="Lý do thêm tài khoản" required /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="makePrimary" value="yes" /> Dùng làm tài khoản mặc định</label>
      <Submit pending={pending}>Thêm tài khoản</Submit>
    </form>
  </div>;
}

