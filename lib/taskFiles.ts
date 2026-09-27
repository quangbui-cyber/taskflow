import { prisma } from "@/lib/prisma";

export const TASK_FILE_KINDS = ["BRIEF", "RESULT"] as const;

export function isTaskFileKind(value: unknown): value is (typeof TASK_FILE_KINDS)[number] {
  return TASK_FILE_KINDS.some((kind) => kind === value);
}

/**
 * Trả về task nếu người dùng được phép xem tệp của nó: thành viên dự án
 * hoặc Admin. Trả null khi task không tồn tại hoặc không có quyền — hai
 * trường hợp gộp làm một để không lộ việc task có tồn tại hay không.
 */
export async function findAccessibleTask(
  taskId: string,
  user: { id: string; role: string }
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      projectId: true,
      creatorId: true,
      assigneeId: true,
      project: {
        select: {
          name: true,
          ownerId: true,
          members: {
            where: { userId: user.id },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!task) return null;
  const canAccess = user.role === "ADMIN" || task.project.members.length > 0;
  return canAccess ? task : null;
}
