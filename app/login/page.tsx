"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { login, type AuthState } from "@/app/actions/auth";
import Brand from "@/components/Brand";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Presentation";

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
            <Input label="Email"
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
            <Input label="Mật khẩu"
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
            <Alert tone="danger" title={state.error} />
          )}

          <Button
            type="submit"
            loading={pending}
            loadingLabel="Đang đăng nhập…"
            className="tf-button-primary w-full"
          >
            <LogIn size={16} aria-hidden="true" />
            {pending ? "Đang đăng nhập..." : "Đăng nhập"}
          </Button>
        </form>

        <p className="text-center text-sm text-zinc-500 mt-4">
          Chưa có tài khoản? Liên hệ quản trị viên của công ty để được cấp.
        </p>
      </div>
    </main>
  );
}
