"use client";

import { LogOut } from "lucide-react";
import { logout } from "@/app/actions/auth";

export default function LogoutButton() {
  return (
    <form action={async () => {
      const data = new FormData();
      try {
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          const sub = await registration?.pushManager?.getSubscription();
          if (sub) {
            data.set("pushEndpoint", sub.endpoint);
            await sub.unsubscribe();
          }
        }
      } catch { /* Server still removes the known endpoint and ends the session. */ }
      await logout(data);
    }}>
      <button type="submit" className="tf-icon-button !h-9 !min-h-9 !w-9" title="Đăng xuất" aria-label="Đăng xuất">
        <LogOut size={17} aria-hidden="true" />
      </button>
    </form>
  );
}
