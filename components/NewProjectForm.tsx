"use client";

import { useActionState } from "react";
import { createProject, type ActionState } from "@/app/actions/projects";
import RevenueInput from "@/components/RevenueInput";
import { Plus } from "lucide-react";
import ClientSelect, { type ClientOption } from "@/components/ClientSelect";
import UserPicker, { type UserPickerOption } from "@/components/UserPicker";
import { useActionFeedback } from "@/components/InteractionProvider";

export default function NewProjectForm({
  clients,
  accounts,
}: {
  clients: ClientOption[];
  accounts: UserPickerOption[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createProject,
    {}
  );
  useActionFeedback(state);

  return (
    <form
      action={formAction}
      className="tf-panel space-y-4 p-5 sm:p-6"
    >
      <label className="block" htmlFor="project-name">
        <span className="tf-label">Tên dự án</span>
        <input
          id="project-name"
          name="name"
          type="text"
          required
          autoComplete="off"
          placeholder="Ví dụ: Website bán hàng"
          className="tf-field"
        />
      </label>
      <label className="block" htmlFor="project-description">
        <span className="tf-label">Mô tả</span>
        <textarea
          id="project-description"
          name="description"
          rows={2}
          placeholder="Phạm vi hoặc mục tiêu chính (không bắt buộc)"
          className="tf-field resize-none"
        />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <div className="block">
          <span className="text-xs font-medium text-zinc-500">Client</span>
          <ClientSelect clients={clients} className="mt-1" />
        </div>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Account</span>
          <UserPicker
            name="accountId"
            options={accounts}
            placeholder="— Chưa chọn —"
            emptyLabel="— Chưa chọn —"
            ariaLabel="Account"
            className="mt-1"
          />
        </label>
      </div>
      {clients.length === 0 && accounts.length === 0 && (
        <p className="text-xs text-zinc-400">
          Chưa có Client/Account nào. Admin có thể thêm trong Cài đặt.
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
        aria-busy={pending}
      >
        {pending ? (
          <span className="tf-spinner" aria-hidden="true" />
        ) : (
          <Plus size={16} aria-hidden="true" />
        )}
        {pending ? "Đang tạo..." : "Tạo dự án"}
      </button>
    </form>
  );
}
