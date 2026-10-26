"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Minus, Unplug } from "lucide-react";
import { disconnectGoogleWorkspace } from "@/app/actions/googleWorkspace";
import { useInteraction } from "@/components/InteractionProvider";

export const GOOGLE_RESULT: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Đã kết nối Google." },
  denied: { tone: "error", text: "Bạn chưa cho phép đủ quyền. Bấm Kết nối lại và tick các ô app xin." },
  mismatch: {
    tone: "error",
    text: "Bạn đã chọn một tài khoản Google khác email đăng nhập app. Hãy chọn đúng tài khoản công ty.",
  },
  unavailable: { tone: "error", text: "Chức năng Google chưa được cấu hình. Nhờ quản trị viên kiểm tra." },
  failed: { tone: "error", text: "Không kết nối được Google. Thử lại sau ít phút." },
};

export default function GoogleConnectionCard({
  configured,
  loginEmail,
  connectedEmail,
  canSendGmail,
  canManageChat,
  result,
}: {
  configured: boolean;
  loginEmail: string;
  connectedEmail: string | null;
  canSendGmail: boolean;
  canManageChat: boolean;
  result: string | null;
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const banner = result ? GOOGLE_RESULT[result] : null;
  const missing = connectedEmail && (!canSendGmail || !canManageChat);

  const permissions = [
    { label: "Gửi email duyệt từ hộp thư của bạn", ok: canSendGmail },
    { label: "Tạo nhóm Google Chat cho dự án và thêm thành viên", ok: canManageChat },
  ];

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">Kết nối Google</h2>
      </div>
      <div className="space-y-3 px-5 py-4 text-sm">
        {banner && (
          <p
            role="status"
            className={`rounded-[8px] px-3 py-2 ${banner.tone === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}
          >
            {banner.text}
          </p>
        )}
        {connectedEmail ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2">
                <span className="tf-badge bg-emerald-50 text-emerald-700">Đã kết nối</span>
                <span className="font-medium">{connectedEmail}</span>
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm("Ngắt kết nối Google? Email duyệt sẽ gửi bằng hộp thư chung của app.")) return;
                  startTransition(async () => {
                    const state = await disconnectGoogleWorkspace();
                    if (state.error) notify({ message: state.error, tone: "error" });
                    else notify({ message: state.success ?? "Đã ngắt kết nối.", tone: "success" });
                    router.replace("/profile");
                    router.refresh();
                  });
                }}
                className="tf-button-secondary"
              >
                <Unplug size={16} aria-hidden="true" />
                Ngắt kết nối
              </button>
            </div>
            <ul className="space-y-1">
              {permissions.map((item) => (
                <li key={item.label} className={`flex items-center gap-2 ${item.ok ? "text-zinc-700" : "text-zinc-400"}`}>
                  {item.ok ? (
                    <Check size={15} className="text-emerald-600" aria-hidden="true" />
                  ) : (
                    <Minus size={15} aria-hidden="true" />
                  )}
                  {item.label}
                  <span className="sr-only">{item.ok ? "(đã cho phép)" : "(chưa cho phép)"}</span>
                </li>
              ))}
            </ul>
            {missing && configured && (
              <a href="/api/google/gmail/connect?returnTo=/profile" className="tf-button-secondary inline-flex">
                <Link2 size={16} aria-hidden="true" />
                Kết nối lại để cấp đủ quyền
              </a>
            )}
          </>
        ) : (
          <>
            <p className="text-zinc-600">
              Chưa kết nối: email đang gửi bằng hộp thư chung của app. Khi kết nối, chọn đúng tài khoản{" "}
              <b>{loginEmail}</b>.
            </p>
            {configured ? (
              // Chuyển hẳn trang sang Google (không mở bằng router của Next).
              <a href="/api/google/gmail/connect?returnTo=/profile" className="tf-button-primary inline-flex">
                <Link2 size={16} aria-hidden="true" />
                Kết nối Google
              </a>
            ) : (
              <p className="text-xs text-zinc-500">Chức năng Google chưa được cấu hình trên máy chủ này.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
