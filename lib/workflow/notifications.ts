import "server-only";
import { prisma } from "@/lib/prisma";

export async function dispatchWorkflowNotifications(requestId?: string) {
  const deliveries = await prisma.workflowNotificationDelivery.findMany({
    where: { status: { in: ["PENDING", "RETRY"] }, attempts: { lt: 3 }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }], ...(requestId ? { event: { requestId } } : {}) },
    include: { event: { include: { request: { select: { id: true, module: true, projectId: true, title: true } } } } },
    take: 50,
    orderBy: { createdAt: "asc" },
  });
  await Promise.all(deliveries.map(async delivery => {
    const event = delivery.event;
    try {
      await prisma.notification.upsert({
        where: { dedupeKey: `workflow:${event.id}:${delivery.userId}` },
        create: { dedupeKey: `workflow:${event.id}:${delivery.userId}`, userId: delivery.userId, type: "WORKFLOW_APPROVAL", message: `${event.request.title}: ${event.action}${event.reason ? ` · ${event.reason}` : ""}`, projectId: event.request.projectId, workflowRequestId: event.request.id },
        update: {},
      });
      await prisma.workflowNotificationDelivery.update({ where: { id: delivery.id }, data: { status: "DELIVERED", attempts: { increment: 1 }, lastError: null, nextAttemptAt: null } });
    } catch (error) {
      await prisma.workflowNotificationDelivery.update({ where: { id: delivery.id }, data: { status: "RETRY", attempts: { increment: 1 }, lastError: error instanceof Error ? error.message.slice(0,500) : "Delivery failed", nextAttemptAt: new Date(Date.now() + 60_000) } }).catch(() => undefined);
    }
  }));
}
