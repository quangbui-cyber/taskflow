"use client";

import { useState } from "react";
import { Select } from "@/components/ui/Field";
import type { CompanySupplier } from "@/lib/costflow/supplierReadModel";

export function SupplierPicker({ suppliers, defaultRecipientKey = "", required = false, onChange }: {
  suppliers: CompanySupplier[];
  defaultRecipientKey?: string;
  required?: boolean;
  onChange?: (value: { supplierId: string; bankAccountId: string; recipientKey: string } | null) => void;
}) {
  const initial = (() => {
    for (const supplier of suppliers) {
      const account = supplier.accounts.find(item => item.recipientKey === defaultRecipientKey);
      if (account) return { supplierId: supplier.id, bankAccountId: account.id };
    }
    return { supplierId: "", bankAccountId: "" };
  })();
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const selectedSupplier = suppliers.find(item => item.id === supplierId);
  const defaultAccount = selectedSupplier?.accounts.find(item => item.id === initial.bankAccountId)
    ?? selectedSupplier?.accounts.find(item => item.isPrimary)
    ?? selectedSupplier?.accounts[0];
  const [chosenAccountId, setChosenAccountId] = useState(initial.bankAccountId);
  const selectedAccount = selectedSupplier?.accounts.find(item => item.id === chosenAccountId) ?? defaultAccount;

  function emit(nextSupplierId: string, nextAccountId: string) {
    const supplier = suppliers.find(item => item.id === nextSupplierId);
    const account = supplier?.accounts.find(item => item.id === nextAccountId);
    onChange?.(supplier && account ? { supplierId: supplier.id, bankAccountId: account.id, recipientKey: account.recipientKey } : null);
  }

  return <div className="grid gap-3 sm:grid-cols-2">
    <Select name="supplierId" label="Nhà cung cấp" value={supplierId} required={required} onChange={event => {
      const nextSupplierId = event.target.value;
      const supplier = suppliers.find(item => item.id === nextSupplierId);
      const nextAccount = supplier?.accounts.find(item => item.isPrimary) ?? supplier?.accounts[0];
      setSupplierId(nextSupplierId);
      setChosenAccountId(nextAccount?.id ?? "");
      emit(nextSupplierId, nextAccount?.id ?? "");
    }}>
      <option value="">Chọn NCC trong danh bạ công ty</option>
      {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.version.legalName}</option>)}
    </Select>
    {selectedSupplier && selectedSupplier.accounts.length > 1 ? <Select name="bankAccountId" label="Tài khoản ngân hàng" value={selectedAccount?.id ?? ""} required={required} onChange={event => {
      setChosenAccountId(event.target.value);
      emit(selectedSupplier.id, event.target.value);
    }}>
      {selectedSupplier.accounts.map(account => <option key={account.id} value={account.id}>{account.bankName} · •••• {account.accountLast4}{account.isPrimary ? " · Mặc định" : ""}</option>)}
    </Select> : <div className="tf-ui-field-group"><span className="tf-label">Tài khoản ngân hàng</span><p className="tf-field flex items-center">{selectedAccount ? `${selectedAccount.bankName} · •••• ${selectedAccount.accountLast4} (Mặc định)` : "Chọn NCC trước"}</p></div>}
    {(!selectedSupplier || selectedSupplier.accounts.length <= 1) && <input type="hidden" name="bankAccountId" value={selectedAccount?.id ?? ""} />}
    <input type="hidden" name="recipientKey" value={selectedAccount?.recipientKey ?? ""} />
  </div>;
}

