"use client";

import { useState } from "react";
import { Check, CheckCircle2, Copy, ShieldCheck } from "lucide-react";

/** Chờ Extension báo đã nhận token; quá thời gian này thì chuyển sang dán tay. */
const EXTENSION_REPLY_TIMEOUT_MS = 3000;

type ConnectResult = { ok: boolean; error?: string; user?: { name?: string } };

/**
 * Gửi token cho Extension (content script lắng nghe trên trang này) và đợi kết quả.
 * Trả về null nếu không có Extension nào trả lời.
 */
function sendTokenToExtension(token: string): Promise<ConnectResult | null> {
  return new Promise((resolve) => {
    const finish = (result: ConnectResult | null) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type !== "MYCREATIVE_RECORDER_CONNECT_RESULT") return;
      finish(event.data as ConnectResult);
    };
    const timer = window.setTimeout(() => finish(null), EXTENSION_REPLY_TIMEOUT_MS);

    window.addEventListener("message", onMessage);
    window.postMessage({ type: "MYCREATIVE_RECORDER_TOKEN", token }, window.location.origin);
  });
}

export default function ExtensionConnectButton({ userName }: { userName: string }) {
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
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

      const result = await sendTokenToExtension(data.token);
      if (result?.ok) {
        setConnected(true);
        return;
      }

      // Chưa cài Extension, Extension bản cũ, hoặc Extension từ chối: cho dán token bằng tay
      if (result?.error) setError(result.error);
      setToken(data.token);
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

  if (connected) {
    return (
      <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
        <div className="flex items-center gap-2 text-emerald-800 text-sm font-semibold">
          <CheckCircle2 size={18} /> Đã kết nối Extension
        </div>
        <p className="text-xs text-emerald-700">
          Bạn có thể đóng tab này, mở một cuộc họp Google Meet rồi bấm icon myCreative Recorder để ghi biên bản.
        </p>
      </div>
    );
  }

  if (token) {
    return (
      <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
        <div className="flex items-center gap-2 text-amber-800 text-xs font-semibold">
          <ShieldCheck size={18} /> Chưa thấy Extension trả lời, hãy kết nối bằng tay
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <p className="text-xs text-amber-800">
          Kiểm tra Extension đã cài bản mới nhất và tải lại trang này. Nếu vẫn không được, bấm Sao chép rồi dán mã
          vào ô Token trong trang cài đặt của Extension:
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
