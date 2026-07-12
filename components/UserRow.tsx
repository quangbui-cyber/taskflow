"use client";

import { useActionState, useState, useTransition } from "react";
import {
  deleteUser,
  resetPassword,
  setManager,
  type AdminState,
} from "@/app/actions/admin";
import { avatarClass } from "@/lib/avatar";
import RoleBadge from "@/components/RoleBadge";
import { KeyRound, Save, Trash2 } from "lucide-react";

type UserItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  taskCount: number;
  projectCount: number;
  managerId: string | null;
};

export default function UserRow({
  user,
  isSelf,
  managers,
}: {
  user: UserItem;
  isSelf: boolean;
  managers: { id: string; name: string }[];
}) {
  const [resetting, setResetting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingAction, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState<AdminState, FormData>(
    async (prev, formData) => {
      const result = await resetPassword(prev, formData);
      if (result.success) setResetting(false);
      return result;
    },
    {}
  );

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${avatarClass(user.id)}`}
        >
          {user.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">
            {user.name}
            {isSelf && <span className="text-zinc-400 font-normal"> (bạn)</span>}
            <RoleBadge role={user.role} />
          </p>
          <p className="text-xs text-zinc-400 truncate">{user.email}</p>
        </div>
        <label className="hidden md:flex items-center gap-1.5 text-xs text-zinc-400 shrink-0">
          Quản lý:
          <select
            defaultValue={user.managerId ?? ""}
            onChange={(e) => {
              const value = e.target.value || null;
              startTransition(() => {
                setManager(user.id, value);
              });
            }}
            className="rounded-[7px] border border-zinc-200 px-2 py-1.5 text-xs text-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
          >
            <option value="">— Không —</option>
            {managers
              .filter((m) => m.id !== user.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
        <div className="hidden sm:block text-xs text-zinc-400 text-right shrink-0">
          <p>{user.projectCount} project</p>
          <p>{user.taskCount} task</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setResetting((v) => !v)}
            className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
          >
            <KeyRound size={14} aria-hidden="true" />
            Đổi mật khẩu
          </button>
          {!isSelf && (
            <button
              disabled={pendingAction}
              onClick={() => {
                if (
                  confirm(
                    `Xoá tài khoản ${user.name}? Chỉ nên xoá khi tài khoản không còn sở hữu project hoặc tạo task.`
                  )
                ) {
                  setDeleteError(null);
                  startTransition(async () => {
                    const result = await deleteUser(user.id);
                    if (result.error) setDeleteError(result.error);
                  });
                }
              }}
              className="tf-button-danger !min-h-8 !px-2.5 !py-1 text-xs"
            >
              <Trash2 size={14} aria-hidden="true" />
              Xoá
            </button>
          )}
        </div>
      </div>

      {resetting && (
        <form action={formAction} className="mt-3 flex gap-2 items-start">
          <input type="hidden" name="userId" value={user.id} />
          <input
            name="password"
            type="text"
            required
            minLength={6}
            placeholder="Mật khẩu mới"
            className="tf-field flex-1 !min-h-9 !py-1.5"
          />
          <button
            type="submit"
            disabled={pending}
            className="tf-button-primary !min-h-9 !px-3 !py-1.5"
          >
            <Save size={14} aria-hidden="true" />
            Lưu
          </button>
        </form>
      )}
      {state.error && (
        <p className="mt-2 text-xs text-red-600">{state.error}</p>
      )}
      {deleteError && (
        <p className="mt-2 text-xs text-red-600">{deleteError}</p>
      )}
    </li>
  );
}
