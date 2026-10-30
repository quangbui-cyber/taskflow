import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Laptop, ArrowLeft } from "lucide-react";
import Link from "next/link";
import ExtensionConnectButton from "./ExtensionConnectButton";

export default async function ExtensionConnectPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?returnTo=/profile/extension");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Laptop size={24} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Kết nối myCreative Recorder</h1>
            <p className="text-xs text-zinc-500">Chrome Extension ghi biên bản 1 click</p>
          </div>
        </div>

        <div className="rounded-lg bg-zinc-50 p-4 border border-zinc-100 text-xs text-zinc-600 space-y-2">
          <p>
            Đang đăng nhập: <strong className="text-zinc-900">{user.name}</strong> ({user.email})
          </p>
          <p className="text-zinc-500 text-[11px]">
            Cấp quyền để Extension tự nhận diện cuộc họp trên Google Meet và tải bản ghi âm lên tài khoản của bạn để AI chép lời và tạo biên bản.
          </p>
        </div>

        <ExtensionConnectButton userName={user.name} />

        <div className="pt-2 text-center">
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            <ArrowLeft size={14} /> Quay về Hồ sơ của tôi
          </Link>
        </div>
      </div>
    </div>
  );
}
