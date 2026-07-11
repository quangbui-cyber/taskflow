"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getMembership, requireUser } from "@/lib/auth";
import { followerIds, notify } from "@/lib/notify";
import { googleChatEnabled, sendGoogleChat } from "@/lib/googleChat";
import { PRIORITIES, STATUSES } from "@/lib/types";

/** Lấy tên project để hiển thị trong tin nhắn Google Chat */
async function projectName(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  return project?.name ?? "dự án";
}

export type ActionState = { error?: string };

const STATUS_KEYS: ReadonlySet<string> = new Set(STATUSES.map((s) => s.key));
const PRIORITY_KEYS: ReadonlySet<string> = new Set(
  PRIORITIES.map((p) => p.key)
);

async function assertMember(projectId: string) {
  const user = await requireUser();
  const membership = await getMembership(projectId, user.id);
  if (!membership) throw new Error("Bạn không thuộc project này.");
  return user;
}

async function isProjectMember(projectId: string, userId: string) {
  return Boolean(await getMembership(projectId, userId));
}

function parseDueDate(raw: string | null): Date | null | undefined {
  if (raw === null) return null;
  const dueDate = new Date(raw);
  if (Number.isNaN(dueDate.getTime())) return undefined;
  return dueDate;
}

export async function createTask(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim();
  const status = String(formData.get("status") ?? "TODO");
  const priority = String(formData.get("priority") ?? "MEDIUM");
  const assigneeId = String(formData.get("assigneeId") ?? "") || null;
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  const dueDate = dueDateRaw ? parseDueDate(dueDateRaw) : null;

  if (!title) return { error: "Tiêu đề task không được để trống." };
  if (!STATUS_KEYS.has(status)) return { error: "Trạng thái không hợp lệ." };
  if (!PRIORITY_KEYS.has(priority)) {
    return { error: "Độ ưu tiên không hợp lệ." };
  }
  if (dueDate === undefined) return { error: "Hạn chót không hợp lệ." };

  const user = await assertMember(projectId);
  if (assigneeId && !(await isProjectMember(projectId, assigneeId))) {
    return { error: "Người được giao không thuộc project này." };
  }

  const last = await prisma.task.findFirst({
    where: { projectId, status },
    orderBy: { order: "desc" },
  });

  const task = await prisma.task.create({
    data: {
      title,
      description: description || null,
      result: result || null,
      projectId,
      status,
      priority,
      dueDate,
      assigneeId,
      creatorId: user.id,
      order: (last?.order ?? 0) + 1,
      completedAt: status === "DONE" ? new Date() : null,
    },
  });

  if (assigneeId && assigneeId !== user.id) {
    await notify([assigneeId], {
      type: "TASK_ASSIGNED",
      message: `${user.name} đã giao cho bạn task “${title}”`,
      taskId: task.id,
      projectId,
    });
  }

  // 💬 Báo Google Chat: có job mới
  if (googleChatEnabled()) {
    const name = await projectName(projectId);
    await sendGoogleChat(
      `🆕 *${name}* — job mới: *${title}* (tạo bởi ${user.name})`
    );
  }

  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function updateTask(
  taskId: string,
  data: {
    title?: string;
    description?: string | null;
    result?: string | null;
    priority?: string;
    dueDate?: string | null;
    assigneeId?: string | null;
    status?: string;
  }
) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  const actor = await assertMember(task.projectId);
  if (data.status !== undefined && !STATUS_KEYS.has(data.status)) return;
  if (data.priority !== undefined && !PRIORITY_KEYS.has(data.priority)) return;
  if (
    data.assigneeId !== undefined &&
    data.assigneeId !== null &&
    !(await isProjectMember(task.projectId, data.assigneeId))
  ) {
    return;
  }
  const dueDate =
    data.dueDate !== undefined ? parseDueDate(data.dueDate) : undefined;
  if (data.dueDate !== undefined && dueDate === undefined) return;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...(data.result !== undefined ? { result: data.result } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.dueDate !== undefined
        ? { dueDate }
        : {}),
      ...(data.assigneeId !== undefined
        ? { assigneeId: data.assigneeId }
        : {}),
      ...(data.status !== undefined
        ? {
            status: data.status,
            // Ghi nhận thời điểm hoàn thành để tính đúng hạn / trễ hạn
            completedAt:
              data.status === "DONE"
                ? task.status === "DONE"
                  ? task.completedAt
                  : new Date()
                : null,
          }
        : {}),
    },
  });

  const title = data.title ?? task.title;

  // 🔔 Giao việc: assignee mới ≠ assignee cũ và ≠ người thao tác
  if (
    data.assigneeId !== undefined &&
    data.assigneeId &&
    data.assigneeId !== task.assigneeId &&
    data.assigneeId !== actor.id
  ) {
    await notify([data.assigneeId], {
      type: "TASK_ASSIGNED",
      message: `${actor.name} đã giao cho bạn task “${title}”`,
      taskId,
      projectId: task.projectId,
    });
  }

  // 🔔 Hoàn thành: báo người giao (creator) + người theo dõi
  if (data.status === "DONE" && task.status !== "DONE") {
    const followers = await followerIds(taskId);
    await notify(
      [task.creatorId, ...followers].filter((id) => id !== actor.id),
      {
        type: "TASK_COMPLETED",
        message: `${actor.name} đã hoàn thành task “${title}”`,
        taskId,
        projectId: task.projectId,
      }
    );
    // 💬 Báo Google Chat: job hoàn thành
    if (googleChatEnabled()) {
      const name = await projectName(task.projectId);
      await sendGoogleChat(
        `✅ *${name}* — hoàn thành: *${title}* (bởi ${actor.name})`
      );
    }
  }

  revalidatePath(`/projects/${task.projectId}`);
}

/** Di chuyển task sang cột khác / vị trí khác (kéo thả) */
export async function moveTask(
  taskId: string,
  status: string,
  order: number
) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  const actor = await assertMember(task.projectId);
  if (!STATUS_KEYS.has(status) || !Number.isFinite(order)) return;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status,
      order,
      // Ghi nhận thời điểm hoàn thành để tính đúng hạn / trễ hạn
      completedAt:
        status === "DONE"
          ? task.status === "DONE"
            ? task.completedAt
            : new Date()
          : null,
    },
  });

  // 🔔 Hoàn thành (kéo thả vào cột Hoàn thành): báo người giao + người theo dõi
  if (status === "DONE" && task.status !== "DONE") {
    const followers = await followerIds(taskId);
    await notify(
      [task.creatorId, ...followers].filter((id) => id !== actor.id),
      {
        type: "TASK_COMPLETED",
        message: `${actor.name} đã hoàn thành task “${task.title}”`,
        taskId,
        projectId: task.projectId,
      }
    );
    // 💬 Báo Google Chat: job hoàn thành
    if (googleChatEnabled()) {
      const name = await projectName(task.projectId);
      await sendGoogleChat(
        `✅ *${name}* — hoàn thành: *${task.title}* (bởi ${actor.name})`
      );
    }
  }

  revalidatePath(`/projects/${task.projectId}`);
}

export async function deleteTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  await assertMember(task.projectId);

  await prisma.task.delete({ where: { id: taskId } });
  revalidatePath(`/projects/${task.projectId}`);
}

export async function addComment(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Bình luận không được để trống." };

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { error: "Task không tồn tại." };
  const user = await assertMember(task.projectId);

  await prisma.comment.create({
    data: { body, taskId, authorId: user.id },
  });

  // 🔔 Bình luận: báo người làm, người giao và người theo dõi (trừ người viết)
  const followers = await followerIds(taskId);
  const snippet = body.length > 60 ? body.slice(0, 60) + "…" : body;
  await notify(
    [task.assigneeId, task.creatorId, ...followers].filter(
      (id) => id !== user.id
    ),
    {
      type: "COMMENT",
      message: `${user.name} đã bình luận vào task “${task.title}”: ${snippet}`,
      taskId,
      projectId: task.projectId,
    }
  );

  revalidatePath(`/projects/${task.projectId}`);
  return {};
}

/** Thêm một người vào danh sách theo dõi task (phải là thành viên project) */
export async function addFollower(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  const actor = await assertMember(task.projectId);

  const membership = await getMembership(task.projectId, userId);
  if (!membership) return; // chỉ thêm được thành viên của project

  await prisma.taskFollower.upsert({
    where: { taskId_userId: { taskId, userId } },
    update: {},
    create: { taskId, userId },
  });

  // 🔔 Báo cho người được thêm (nếu không phải tự thêm mình)
  if (userId !== actor.id) {
    await notify([userId], {
      type: "TASK_FOLLOW",
      message: `${actor.name} đã thêm bạn theo dõi task “${task.title}”`,
      taskId,
      projectId: task.projectId,
    });
  }

  revalidatePath(`/projects/${task.projectId}`);
}

export async function removeFollower(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  await assertMember(task.projectId);

  await prisma.taskFollower.deleteMany({
    where: { taskId, userId },
  });
  revalidatePath(`/projects/${task.projectId}`);
}
