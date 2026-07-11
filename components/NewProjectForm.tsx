"use client";

import { useActionState } from "react";
import { createProject, type ActionState } from "@/app/actions/projects";
import RevenueInput from "@/components/RevenueInput";
import { Plus } from "lucide-react";

type Option = { id: string; name: string };

export default function NewProjectForm({
  clients,
  accounts,
}: {
  clients: Option[];
  accounts: Option[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createProject,
    {}
  );

  return (
    <form
      action={formAction}
      className="tf-panel space-y-4 p-5 sm:p-6"
    >
      <input
        name="name"
        type="text"
        required
        placeholder="Tên dự án, ví dụ: Website bán hàng"
        className="tf-field"
      />
      <textarea
        name="description"
        rows={2}
        placeholder="Mô tả ngắn (không bắt buộc)"
        className="tf-field resize-none"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Tình trạng ban đầu</span>
          <span className="tf-field mt-1 flex items-center bg-zinc-50 text-zinc-600">
            Bidding
          </span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">
            Doanh thu (VND)
          </span>
          <RevenueInput
            name="revenue"
            placeholder="VD: 500.000.000"
            className="tf-field mt-1"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Client</span>
          <select
            name="clientId"
            defaultValue=""
            className="tf-field mt-1"
          >
            <option value="">— Chưa chọn —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Account</span>
          <select
            name="accountId"
            defaultValue=""
            className="tf-field mt-1"
          >
            <option value="">— Chưa chọn —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {clients.length === 0 && accounts.length === 0 && (
        <p className="text-xs text-zinc-400">
          Chưa có Client/Account nào. Admin có thể thêm trong mục Client & Account.
        </p>
      )}
      {state.error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="tf-button-primary"
      >
        <Plus size={16} aria-hidden="true" />
        {pending ? "Đang tạo..." : "Tạo dự án"}
      </button>
    </form>
  );
}
