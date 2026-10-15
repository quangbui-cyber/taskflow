export type WorkflowNotificationDelivery = {
  id: string;
  userId: string;
  event: {
    id: string;
    action: string;
    reason: string | null;
    request: { id: string; projectId: string | null; title: string };
  };
};

export type WorkflowNotificationDeliveryStore = {
  pending(requestId?: string): Promise<WorkflowNotificationDelivery[]>;
  upsertNotification(input: { dedupeKey: string; userId: string; message: string; projectId: string | null; requestId: string }): Promise<void>;
  markDelivered(deliveryId: string): Promise<void>;
  markRetry(deliveryId: string, message: string, nextAttemptAt: Date): Promise<void>;
};

export async function deliverWorkflowNotifications(store: WorkflowNotificationDeliveryStore, requestId?: string) {
  const deliveries = await store.pending(requestId);
  await Promise.all(deliveries.map(async delivery => {
    const event = delivery.event;
    try {
      await store.upsertNotification({
        dedupeKey: `workflow:${event.id}:${delivery.userId}`,
        userId: delivery.userId,
        message: `${event.request.title}: ${event.action}${event.reason ? ` · ${event.reason}` : ""}`,
        projectId: event.request.projectId,
        requestId: event.request.id,
      });
      await store.markDelivered(delivery.id);
    } catch (error) {
      await store.markRetry(
        delivery.id,
        error instanceof Error ? error.message.slice(0, 500) : "Delivery failed",
        new Date(Date.now() + 60_000),
      ).catch(() => undefined);
    }
  }));
}
