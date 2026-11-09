export const CRM_NOTIFICATION_TYPES = [
  "CRM_DUE", "CRM_OVERDUE", "CRM_PIC_ASSIGNED", "CRM_TASK_ASSIGNED", "CRM_DRAFT", "CRM_STAGE", "CRM_NUDGE",
] as const;

export function isCrmNotificationType(type: string): boolean {
  return type.startsWith("CRM_");
}
