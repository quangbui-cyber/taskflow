"use client";

import { useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";

export default function ExtensionConnectButton({ userName }: { userName: string }) {
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setLoading(true);
    setError(null);
    try {
      const userAgent = navigator.userAgent;
      const isMac = userAgent.includes("Mac");
      const isChrome = userAgent.includes("Chrome");
      const defaultLabel = `${isChrome ? "Chrome" : "Trình duyệt"} trên ${isMac ? "MacBook" : "Máy tính"} của ${userName}`;

      const res = await fetch("/api/ext/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: defaultLabel }),
      });
      const data = (await res.json()) as { success?: boolean; token?: string; error?: string };

      if (!res.ok || !data.token) {
        throw new Error(data.error || "Không thể cấp quyền kết nối.");
      }

      setToken(data.token);

      // Thử gửi token vào window hoặc clipboard để extension tự bắt
      navigator.clipboard.writeText(data.token).catch(() => undefined);
      window.postMessage({ type: "MYCREATIVE_RECORDER_TOKEN", token: data.token }, "*");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (token) {
    return (
      <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
        <div className="flex items-center gap-2 text-emerald-800 text-xs font-semibold">
          <ShieldCheck size={18} /> Đã cấp quyền kết nối thành công!
        </div>
        <p className="text-xs text-emerald-700">
          Mã token đã được tự động sao chép vào bộ nhớ tạm (clipboard). Bạn hãy dán mã vào ô cài đặt trong Extension:
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={token}
            className="tf-field font-mono text-xs flex-1 !min-h-9 !py-1 bg-white select-all"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="tf-button-primary text-xs !min-h-9 px-3 shrink-0"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Đã chép" : "Sao chép"}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">
          Sau khi dán token vào Extension, bạn có thể đóng tab này và bắt đầu sử dụng.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600 border border-red-200">
          {error}
        </div>
      )}
      <button
        type="button"
        disabled={loading}
        onClick={handleConnect}
        className="w-full tf-button-primary !py-2.5 text-sm font-medium justify-center shadow-sm"
      >
        {loading ? <span className="tf-spinner" /> : "Cho phép kết nối Extension"}
      </button>
    </div>
  );
}
