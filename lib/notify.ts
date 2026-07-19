import { prisma } from "@/lib/prisma";

/** Tạo thông báo cho nhiều người nhận (tự loại trùng và loại bỏ id rỗng) */
export async function notify(
  userIds: (string | null | undefined)[],
  data: {
    type:
      | "TASK_ASSIGNED"
      | "TASK_COMPLETED"
      | "TASK_UPDATED"
      | "COMMENT"
      | "TASK_FOLLOW"
      | "DEADLINE_REMINDER";
    message: string;
    taskId?: string;
    projectId?: string;
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
  }

  await prisma.notification.createMany({
    data: unique.map((userId) => ({ userId, ...data })),
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
