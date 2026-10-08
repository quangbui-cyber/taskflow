"use client";

import { useState, type FormEvent } from "react";
import UserPicker, { type UserPickerOption } from "@/components/UserPicker";

export type ProjectAccountOption = UserPickerOption & { teamName: string };

export function preventMissingProjectAccount(event: FormEvent<HTMLFormElement>) {
  const accountInput = event.currentTarget.querySelector<HTMLInputElement>("input[name=accountId]");
  if (!accountInput || accountInput.value) return false;
  event.preventDefault();
  event.currentTarget.querySelector<HTMLButtonElement>('button[aria-label="Account phụ trách (bắt buộc)"]')?.focus();
  return true;
}

export default function ProjectAccountSelect({
  accounts,
  defaultValue = "",
  disabled,
}: {
  accounts: ProjectAccountOption[];
  defaultValue?: string;
  disabled?: boolean;
}) {
  const [accountId, setAccountId] = useState(defaultValue);
  const account = accounts.find((item) => item.id === accountId);

  return (
    <div className="space-y-3 sm:col-span-2">
      <div>
        <span className="tf-label">Account phụ trách (bắt buộc)</span>
        <UserPicker
          name="accountId"
          value={account ? accountId : ""}
          onChange={setAccountId}
          options={accounts}
          disabled={disabled}
          placeholder="Chọn Account phụ trách"
          ariaLabel="Account phụ trách (bắt buộc)"
        />
      </div>
      <div>
        <span className="tf-label">Team kinh doanh</span>
        <p className="tf-field flex items-center bg-zinc-50 text-zinc-600" aria-live="polite">
          {account?.teamName ?? "Chọn Account để xác định Team"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Dự án tự xếp vào Team kinh doanh của Account đã chọn.
        </p>
      </div>
      {accounts.length === 0 && (
        <p className="text-xs text-amber-600">
          Chưa có Account đang hoạt động. Admin cần thêm Account và gán Team tại Cài đặt.
        </p>
      )}
    </div>
  );
}
