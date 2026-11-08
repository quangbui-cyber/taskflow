import { prisma } from "@/lib/prisma";
import { after } from "next/server";
import { deliverPush } from "@/lib/webPush";
import { crmEnabled } from "./features";

/** Tạo thông báo cho nhiều người nhận (tự loại trùng và loại bỏ id rỗng) */
export async function notify(
  userIds: (string | null | undefined)[],
  data: {
    type:
      | "CRM_DUE" | "CRM_OVERDUE" | "CRM_PIC_ASSIGNED" | "CRM_TASK_ASSIGNED" | "CRM_DRAFT" | "CRM_STAGE"
      | "TASK_ASSIGNED"
      | "TASK_COMPLETED"
      | "TASK_UPDATED"
      | "COMMENT"
      | "COMMENT_MENTION"
      | "TASK_FOLLOW"
      | "DEADLINE_REMINDER"
      | "RECOGNITION_RECEIVED"
      | "RECOGNITION_COMMENT"
      | "LEAVE_REQUEST"
      | "LEAVE_DECISION"
      | "MEETING_INVITED"
      | "MEETING_UPDATED"
      | "MEETING_CANCELLED"
      | "MEETING_RESPONSE"
      | "MEETING_REMINDER"
      | "MEETING_RECAP_READY"
      | "MEETING_RECAP_FAILED"
      | "MEETING_RECAP_SHARED"
      | "MEETING_RECAP_PROMPT"
      | "FINANCE_APPROVAL_REQUEST"
      | "FINANCE_APPROVAL_DECISION";
    message: string;
    taskId?: string;
    projectId?: string;
    clientId?: string;
    opportunityId?: string;
    recognitionId?: string;
    meetingId?: string;
  }
) {
  // Việc dọn thông báo cũ (quá 30 ngày) do cron nhắc việc hàng ngày đảm nhiệm —
  // không dọn ở đây để khỏi tốn một lượt database cho mỗi lần tạo thông báo.
  let unique = [...new Set(userIds.filter((id): id is string => !!id))];
  if (unique.length === 0) return;
  if (data.projectId) {
    const members = await prisma.projectMember.findMany({
      where: {
        projectId: data.projectId,
        userId: { in: unique },
      },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((m) => m.userId));
    unique = unique.filter((userId) => memberIds.has(userId));
    if (unique.length === 0) return;
  } else if (data.clientId || data.opportunityId) {
    if (!crmEnabled()) return;
    const active = await prisma.user.findMany({ where: { id: { in: unique }, isActive: true }, select: { id: true } });
    unique = active.map(({ id }) => id);
    if (!unique.length) return;
  }

  await prisma.notification.createMany({
    data: unique.map((userId) => ({ userId, ...data })),
  });
  after(async () => {
    try { await deliverPush(unique, data); }
    catch { console.warn("Web push delivery could not be completed."); }
  });
}

/** Danh sách id người theo dõi task */
export async function followerIds(taskId: string): Promise<string[]> {
  const followers = await prisma.taskFollower.findMany({
    where: { taskId },
    select: { userId: true },
  });
  return followers.map((f) => f.userId);
}
