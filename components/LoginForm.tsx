"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { login, type AuthState } from "@/app/actions/auth";
import Brand from "@/components/Brand";

const GOOGLE_ERRORS: Record<string, string> = {
  failed: "Không đăng nhập được bằng Google. Vui lòng thử lại.",
  "no-account": "Tài khoản Google này chưa được liên kết với tài khoản đang hoạt động trong ứng dụng. Hãy liên hệ quản trị viên.",
  "link-required": "Hãy đăng nhập bằng mật khẩu một lần để liên kết tài khoản Google này. Những lần sau bạn có thể dùng nút Google.",
  unavailable: "Đăng nhập Google chưa được cấu hình.",
};

export default function LoginForm({
  googleEnabled,
  googleResult,
}: {
  googleEnabled: boolean;
  googleResult?: string;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(login, {});

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f9] p-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex"><Brand large /></div>
          <p className="text-zinc-500 mt-2">Đăng nhập để tiếp tục</p>
        </div>

        <div className="tf-panel space-y-5 p-6">
          {googleEnabled && (
            <>
              <a
                href="/api/auth/google"
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-zinc-300 bg-white px-4 py-3 font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
              >
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 5.38 6.51 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.28 5.48-4.8 7.18l7.73 6C44.38 38.03 46.98 31.88 46.98 24.55z" />
                  <path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.94 23.94 0 0 0 0 24c0 3.87.93 7.51 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.92-2.13 15.9-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                Đăng nhập bằng Google
              </a>
              <div className="flex items-center gap-3 text-xs text-zinc-400">
                <span className="h-px flex-1 bg-zinc-200" />
                hoặc dùng mật khẩu
                <span className="h-px flex-1 bg-zinc-200" />
              </div>
            </>
          )}

          {googleResult && GOOGLE_ERRORS[googleResult] && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
              {GOOGLE_ERRORS[googleResult]}
            </p>
          )}

          <form action={formAction} className="space-y-5">
            <div>
              <label className="tf-label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email" className="tf-field" placeholder="ban@example.com" />
            </div>
            <div>
              <label className="tf-label" htmlFor="password">Mật khẩu</label>
              <input id="password" name="password" type="password" required autoComplete="current-password" className="tf-field" placeholder="••••••••" />
            </div>

            {state.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">{state.error}</p>
            )}

            <button type="submit" disabled={pending} className="tf-button-primary w-full">
              <LogIn size={16} aria-hidden="true" />
              {pending ? "Đang đăng nhập..." : "Đăng nhập"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-zinc-500">
          Chưa có tài khoản? Liên hệ quản trị viên của công ty để được cấp.
        </p>
      </div>
    </main>
  );
}
