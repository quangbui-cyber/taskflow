import { prisma } from "@/lib/prisma";

function notificationDeletionCutoff() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

/** Tạo thông báo cho nhiều người nhận (tự loại trùng và loại bỏ id rỗng) */
export async function notify(
  userIds: (string | null | undefined)[],
  data: {
    type:
      | "TASK_ASSIGNED"
      | "TASK_COMPLETED"
      | "TASK_UPDATED"
      | "COMMENT"
      | "TASK_FOLLOW";
    message: string;
    taskId?: string;
    projectId?: string;
  }
) {
  await prisma.notification.deleteMany({
    where: { createdAt: { lt: notificationDeletionCutoff() } },
  });

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
