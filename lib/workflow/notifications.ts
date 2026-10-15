import "server-only";
import { prisma } from "@/lib/prisma";
import { deliverWorkflowNotifications } from "./notificationDelivery";

export async function dispatchWorkflowNotifications(requestId?: string) {
  await deliverWorkflowNotifications({
    pending: async targetRequestId => prisma.workflowNotificationDelivery.findMany({
      where: { status: { in: ["PENDING", "RETRY"] }, attempts: { lt: 3 }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }], ...(targetRequestId ? { event: { requestId: targetRequestId } } : {}) },
      include: { event: { include: { request: { select: { id: true, projectId: true, title: true } } } } },
      take: 50,
      orderBy: { createdAt: "asc" },
    }),
    async upsertNotification(input) {
      await prisma.notification.upsert({
        where: { dedupeKey: input.dedupeKey },
        create: { dedupeKey: input.dedupeKey, userId: input.userId, type: "WORKFLOW_APPROVAL", message: input.message, projectId: input.projectId, workflowRequestId: input.requestId },
        update: {},
      });
    },
    async markDelivered(deliveryId) {
      await prisma.workflowNotificationDelivery.update({ where: { id: deliveryId }, data: { status: "DELIVERED", attempts: { increment: 1 }, lastError: null, nextAttemptAt: null } });
    },
    async markRetry(deliveryId, message, nextAttemptAt) {
      await prisma.workflowNotificationDelivery.update({ where: { id: deliveryId }, data: { status: "RETRY", attempts: { increment: 1 }, lastError: message, nextAttemptAt } });
    },
  }, requestId);
}
