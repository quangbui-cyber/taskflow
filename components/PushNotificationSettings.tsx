"use client";

import { useEffect, useState } from "react";
import { BellRing, BellOff, Send } from "lucide-react";
import { sendTestPush, subscribePush, unsubscribePush } from "@/app/actions/push";
import { applicationServerKey, pushRegistration } from "@/lib/pushClient";

type Status = "loading" | "unsupported" | "install" | "blocked" | "disabled" | "enabled";

export default function PushNotificationSettings({ publicKey }: { publicKey: string | null }) {
  const [status, setStatus] = useState<Status>("loading");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    async function load() {
      if (ios && !installed) { setStatus("install"); return; }
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus("unsupported"); return;
      }
      if (Notification.permission === "denied") { setStatus("blocked"); return; }
      const registration = await pushRegistration();
      const sub = await registration.pushManager.getSubscription();
      if (cancelled) return;
      if (sub && publicKey) {
        const result = await subscribePush(sub.toJSON());
        if (result.error) throw new Error(result.error);
      }
      if (!cancelled) {
        setSubscription(sub);
        setStatus(sub ? "enabled" : "disabled");
      }
    }
    void load().catch(() => {
      if (!cancelled) {
        setStatus("disabled");
        setIsError(true);
        setMessage("Không khởi tạo được thông báo. Hãy tải lại trang hoặc thử bằng Safari/Chrome.");
      }
    });
    return () => { cancelled = true; };
  }, [publicKey]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true); setMessage(""); setIsError(false);
    let newSubscription: PushSubscription | null = null;
    try {
      // Request permission directly from the tap, before other asynchronous work.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "disabled");
        setMessage("Bạn chưa cho phép app gửi thông báo.");
        return;
      }
      const registration = await pushRegistration();
      let sub = await registration.pushManager.getSubscription();
      if (!sub) {
        sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
        newSubscription = sub;
      }
      const result = await subscribePush(sub.toJSON());
      if (result.error) throw new Error(result.error);
      setSubscription(sub); setStatus("enabled"); setMessage(result.success ?? "Đã bật thông báo.");
    } catch (error) {
      if (newSubscription) await newSubscription.unsubscribe().catch(() => {});
      setIsError(true);
      setMessage(error instanceof DOMException
        ? "Không kết nối được dịch vụ thông báo. Hãy kiểm tra kết nối mạng và thử lại bằng Safari/Chrome."
        : error instanceof Error ? error.message : "Không bật được thông báo. Hãy thử lại.");
    } finally { setBusy(false); }
  }

  async function disable() {
    if (!subscription) return;
    setBusy(true); setMessage(""); setIsError(false);
    try {
      const result = await unsubscribePush(subscription.endpoint);
      await subscription.unsubscribe();
      setSubscription(null); setStatus("disabled"); setMessage(result.success);
    } catch {
      setIsError(true); setMessage("Không tắt được thông báo. Hãy thử lại.");
    } finally { setBusy(false); }
  }

  async function test() {
    if (!subscription) return;
    setBusy(true); setMessage(""); setIsError(false);
    try {
      const result = await sendTestPush(subscription.endpoint);
      setIsError(Boolean(result.error)); setMessage(result.error ?? result.success ?? "");
    } catch {
      setIsError(true); setMessage("Không gửi được thông báo thử. Hãy thử lại.");
    } finally { setBusy(false); }
  }

  return (
    <section className="tf-panel p-5" aria-labelledby="push-settings-title">
      <h2 id="push-settings-title" className="font-semibold">Thông báo trên thiết bị</h2>
      <div className="mt-4 space-y-3">
        {!publicKey ? <p className="text-sm text-zinc-500">Tính năng đang chờ Admin hoàn tất cấu hình.</p> : (
          <>
            {status === "loading" && <p className="text-sm text-zinc-500">Đang kiểm tra thiết bị…</p>}
            {status === "install" && <p className="text-sm text-zinc-600">Trên iPhone/iPad (iOS 16.4 trở lên): mở app bằng Safari → Chia sẻ → Thêm vào Màn hình chính. Mở lại app từ biểu tượng đó, vào Thông báo và bấm Bật thông báo.</p>}
            {status === "unsupported" && <p className="text-sm text-zinc-600">Trình duyệt này chưa hỗ trợ thông báo đẩy. Hãy mở địa chỉ HTTPS của app bằng Chrome trên Android hoặc Safari trên iPhone.</p>}
            {status === "blocked" && <p className="text-sm text-amber-700">Thông báo đang bị chặn. Hãy cho phép thông báo cho app trong cài đặt trình duyệt/điện thoại, rồi tải lại trang.</p>}
            {status === "disabled" && <button type="button" onClick={enable} disabled={busy} className="tf-button-primary" aria-busy={busy}><BellRing size={16} aria-hidden="true" />{busy ? "Đang bật…" : "Bật thông báo"}</button>}
            {status === "enabled" && (
              <>
                <p className="text-sm text-emerald-700">Đã bật trên thiết bị này.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={test} disabled={busy} className="tf-button-primary" aria-busy={busy}><Send size={16} aria-hidden="true" />Gửi thông báo thử</button>
                  <button type="button" onClick={disable} disabled={busy} className="tf-button-secondary"><BellOff size={16} aria-hidden="true" />Tắt trên thiết bị này</button>
                </div>
              </>
            )}
          </>
        )}
        {message && <p role="status" aria-live="polite" className={`text-sm ${isError ? "text-red-600" : "text-zinc-600"}`}>{message}</p>}
      </div>
    </section>
  );
}
