import "server-only";

import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { isPushEndpoint, notificationDestination } from "@/lib/pushPolicy";

export function pushConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

type PushMessage = {
  type: string;
  message: string;
  projectId?: string;
  taskId?: string;
  recognitionId?: string;
};

/** Failure to deliver push never reverses the user's task or saved bell notification. */
export async function deliverPush(userIds: string[], data: PushMessage, endpoint?: string) {
  const config = pushConfiguration();
  if (!config || userIds.length === 0) return { sent: 0, failed: 0 };
  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      userId: { in: userIds },
      ...(endpoint ? { endpoint } : {}),
      user: {
        isActive: true,
        ...(data.projectId ? { memberships: { some: { projectId: data.projectId } } } : {}),
      },
    },
    include: { user: { select: { sessionVersion: true } } },
  });
  let sent = 0;
  let failed = 0;
  // Bound concurrency and request duration for Vercel Functions.
  for (let offset = 0; offset < subscriptions.length; offset += 10) {
    await Promise.all(subscriptions.slice(offset, offset + 10).map(async (sub) => {
      if (sub.sessionVersion !== sub.user.sessionVersion || !isPushEndpoint(sub.endpoint)) {
        await prisma.pushSubscription.deleteMany({ where: { id: sub.id, updatedAt: sub.updatedAt } });
        return;
      }
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            title: data.type === "TEST" ? "myCreative · Thông báo thử" : "myCreative",
            body: data.message.slice(0, 240),
            url: notificationDestination(data),
            tag: `${data.type}:${data.taskId ?? data.recognitionId ?? "general"}`,
          }),
          { vapidDetails: config, timeout: 8_000, TTL: 3600, urgency: "normal" });
        sent += 1;
      } catch (error) {
        failed += 1;
        const status = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 0;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.deleteMany({ where: { id: sub.id, updatedAt: sub.updatedAt } });
        }
        // Endpoint URLs and encryption keys are secret: do not log the error object.
        console.warn("Web push delivery failed", { status, subscriptionId: sub.id });
      }
    }));
  }
  return { sent, failed };
}
