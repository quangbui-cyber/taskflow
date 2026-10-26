"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Video } from "lucide-react";
import {
  createGoogleMeetLink,
  getGoogleMeetStatus,
  type GoogleMeetStatus,
} from "@/app/actions/googleMeet";
import { GOOGLE_MEET_CHANNEL } from "@/lib/googleMeetClient";

/**
 * Nút tạo link Google Meet trong form đặt lịch. Lần đầu: mở cửa sổ xin quyền Google,
 * kết nối xong thì tự tạo link luôn. Ẩn hẳn khi app chưa cấu hình Google.
 */
export default function GoogleMeetLinkButton({
  disabled,
  onLink,
}: {
  disabled?: boolean;
  onLink: (url: string) => void;
}) {
  const [status, setStatus] = useState<GoogleMeetStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waitingRef = useRef(false);
  const onLinkRef = useRef(onLink);
  useEffect(() => {
    onLinkRef.current = onLink;
  }, [onLink]);

  const createLink = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await createGoogleMeetLink();
      if ("url" in result) {
        onLinkRef.current(result.url);
      } else {
        setError(result.error);
        if (result.needsConnect) setStatus({ configured: true, connected: false });
      }
    } catch {
      setError("Không tạo được link họp. Kiểm tra mạng rồi thử lại.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getGoogleMeetStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Cửa sổ kết nối báo kết quả qua BroadcastChannel; kết nối xong thì tạo link ngay.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    const handle = (result: unknown) => {
      if (!waitingRef.current) return;
      waitingRef.current = false;
      if (result === "connected") {
        setStatus({ configured: true, connected: true });
        void createLink();
      } else if (result === "denied") {
        setError("Bạn chưa cho phép tạo phòng Google Meet.");
      } else {
        setError("Không kết nối được Google. Thử lại.");
      }
    };
    try {
      channel = new BroadcastChannel(GOOGLE_MEET_CHANNEL);
      channel.onmessage = (event) => handle((event.data as { result?: unknown } | null)?.result);
    } catch {
      channel = null;
    }
    // Dự phòng khi tin nhắn không tới (trình duyệt cũ, cửa sổ tách riêng): quay lại tab thì kiểm tra lại.
    const onFocus = () => {
      if (!waitingRef.current) return;
      void getGoogleMeetStatus().then((next) => {
        setStatus(next);
        if (next.connected) handle("connected");
      });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      channel?.close();
      window.removeEventListener("focus", onFocus);
    };
  }, [createLink]);

  function connect() {
    setError(null);
    waitingRef.current = true;
    const popup = window.open("/api/google/meet/connect", "google-meet-connect", "width=520,height=680");
    if (!popup) {
      waitingRef.current = false;
      setError("Trình duyệt chặn cửa sổ bật lên. Cho phép cửa sổ bật lên cho trang này rồi bấm lại.");
    }
  }

  if (!status?.configured) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => (status.connected ? void createLink() : connect())}
        disabled={disabled || busy}
        aria-busy={busy}
        className="tf-button-secondary !min-h-9 !px-3 text-xs"
      >
        <Video size={14} aria-hidden="true" />
        {busy ? "Đang tạo link…" : status.connected ? "Tạo link Google Meet" : "Kết nối Google để tạo link Meet"}
      </button>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
