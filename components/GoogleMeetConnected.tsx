"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GOOGLE_MEET_CHANNEL } from "@/lib/googleMeetClient";

const MESSAGES: Record<string, string> = {
  connected: "Đã kết nối Google Meet. Mở form đặt lịch và bấm Tạo link Google Meet.",
  denied: "Bạn chưa cho phép tạo phòng Google Meet. Hãy thử lại và tick ô cho phép tạo phòng họp.",
  unavailable: "Chức năng Google chưa được cấu hình. Nhờ quản trị viên xem mục Đăng nhập bằng Google trong DEPLOY.md.",
  failed: "Không kết nối được Google Meet. Đóng cửa sổ này rồi thử lại.",
};

/** Cửa sổ bật lên sau khi xin quyền Google: báo cho tab đặt lịch rồi tự đóng. */
export default function GoogleMeetConnected({ result }: { result: string }) {
  // Trình duyệt không mở cửa sổ riêng (mở đè lên tab đặt lịch): hiện nút quay lại thay vì tự đóng.
  const [inPopup, setInPopup] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setInPopup(Boolean(window.opener)), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    try {
      const channel = new BroadcastChannel(GOOGLE_MEET_CHANNEL);
      channel.postMessage({ result });
      channel.close();
    } catch {
      // Trình duyệt cũ: tab đặt lịch tự kiểm tra lại khi được bấm vào.
    }
    if (result === "connected" && window.opener) {
      const timer = window.setTimeout(() => window.close(), 600);
      return () => window.clearTimeout(timer);
    }
  }, [result]);

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-sm leading-6 text-zinc-700">{MESSAGES[result] ?? MESSAGES.failed}</p>
      {!inPopup && (
        <Link href="/meetings" className="tf-button-primary mt-5 inline-flex">
          Quay lại Lịch họp
        </Link>
      )}
    </main>
  );
}
