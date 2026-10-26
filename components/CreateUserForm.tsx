"use client";

import { useActionState, useEffect, useRef } from "react";
import { createUser, type AdminState } from "@/app/actions/admin";
import { ChevronDown, UserPlus } from "lucide-react";
import AvatarUploader from "@/components/AvatarUploader";
import { useActionFeedback } from "@/components/InteractionProvider";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

export default function CreateUserForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<AdminState, FormData>(
    createUser,
    {}
  );
  useActionFeedback(state);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="tf-panel space-y-4 p-5"
    >
      <h2 className="font-semibold">Tạo tài khoản</h2>
      <AvatarUploader
        id="new-user"
        displayName="Tài khoản mới"
        compact
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          name="name"
          type="text"
          required
          placeholder="Họ tên nhân viên"
          className="tf-field"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="Email đăng nhập"
          className="tf-field"
        />
        <input
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          placeholder={`Mật khẩu (ít nhất ${MIN_PASSWORD_LENGTH} ký tự)`}
          className="tf-field"
          autoComplete="new-password"
        />
        <div className="relative min-w-0">
          <select
            name="role"
            defaultValue="USER"
            className="tf-field appearance-none !pr-11"
          >
            <option value="USER">User</option>
            <option value="ACCOUNT">Account</option>
            <option value="ACCOUNTANT">Kế toán</option>
            <option value="ADMIN">Admin</option>
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
        </div>
      </div>

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
          <UserPlus size={16} aria-hidden="true" />
        )}
        {pending ? "Đang tạo..." : "Tạo tài khoản"}
      </button>
    </form>
  );
}
