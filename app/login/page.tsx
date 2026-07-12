"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { login, type AuthState } from "@/app/actions/auth";
import Brand from "@/components/Brand";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    login,
    {}
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f9] p-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex">
            <Brand large />
          </div>
          <p className="text-zinc-500 mt-2">Đăng nhập để tiếp tục</p>
        </div>

        <form
          action={formAction}
          className="tf-panel space-y-5 p-6"
        >
          <div>
            <label className="tf-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="tf-field"
              placeholder="ban@example.com"
            />
          </div>
          <div>
            <label
              className="tf-label"
              htmlFor="password"
            >
              Mật khẩu
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="tf-field"
              placeholder="••••••••"
            />
          </div>

          {state.error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="tf-button-primary w-full"
          >
            <LogIn size={16} aria-hidden="true" />
            {pending ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>

        <p className="text-center text-sm text-zinc-500 mt-4">
          Chưa có tài khoản? Liên hệ quản trị viên của công ty để được cấp.
        </p>
      </div>
    </main>
  );
}
