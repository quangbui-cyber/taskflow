"use client";

import { useEffect } from "react";
import { subscribePush } from "@/app/actions/push";
import { pushRegistration } from "@/lib/pushClient";

export default function PushDeviceSync({ userId }: { userId: string }) {
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    async function sync() {
      const registration = await pushRegistration();
      if (!("PushManager" in window) || cancelled) return;
      const subscription = await registration.pushManager.getSubscription();
      // A browser shared by multiple accounts always follows the signed-in user.
      if (subscription && !cancelled) await subscribePush(subscription.toJSON());
    }
    void sync().catch(() => { /* The notification panel shows actionable errors. */ });
    return () => { cancelled = true; };
  }, [userId]);
  return null;
}
