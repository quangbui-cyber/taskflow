"use client";

import { useActionState, useEffect, useRef } from "react";
import { createUser, type AdminState } from "@/app/actions/admin";
import { UserPlus } from "lucide-react";

export default function CreateUserForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<AdminState, FormData>(
    createUser,
    {}
  );

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="tf-panel space-y-4 p-5"
    >
      <h2 className="font-semibold">Tạo tài khoản mới</h2>
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
          type="text"
          required
          minLength={6}
          placeholder="Mật khẩu tạm (ít nhất 6 ký tự)"
          className="tf-field"
        />
        <select
          name="role"
          defaultValue="USER"
          className="tf-field"
        >
          <option value="USER">User</option>
          <option value="ACCOUNT">Account</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>

      {state.error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
          {state.success}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="tf-button-primary"
      >
        <UserPlus size={16} aria-hidden="true" />
        {pending ? "Đang tạo..." : "Tạo tài khoản"}
      </button>
    </form>
  );
}
