"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getMembership, requireUser } from "@/lib/auth";
import { followerIds, notify } from "@/lib/notify";
import { sendGoogleChat } from "@/lib/googleChat";
import { PRIORITIES, STATUSES } from "@/lib/types";

async function projectChat(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, googleChatWebhookUrl: true },
  });
  return project;
}

function statusLabel(status: string) {
  return STATUSES.find((item) => item.key === status)?.label ?? status;
}

function deadlineLabel(value: Date | null) {
  if (!value) return "Đã bỏ hạn chót";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(value);
}

async function taskLink(projectId: string, taskId: string) {
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${protocol}://${host}/projects/${projectId}?task=${taskId}`;
}

async function sendTaskChat(
  projectId: string,
  taskId: string,
  lines: string[]
) {
  const chat = await projectChat(projectId);
  if (!chat?.googleChatWebhookUrl) return;
  const url = await taskLink(projectId, taskId);
  await sendGoogleChat(
    chat.googleChatWebhookUrl,
    [`*${chat.name}*`, ...lines, `<${url}|Mở job>`].join("\n")
  );
}

export type ActionState = { error?: string };

const STATUS_KEYS: ReadonlySet<string> = new Set(STATUSES.map((s) => s.key));
const PRIORITY_KEYS: ReadonlySet<string> = new Set(
  PRIORITIES.map((p) => p.key)
);

async function assertMember(projectId: string) {
  const user = await requireUser();
  const membership = await getMembership(projectId, user.id);
  if (!membership && user.role !== "ADMIN") {
    throw new Error("Bạn không thuộc project này.");
  }
  return user;
}

async function isProjectMember(projectId: string, userId: string) {
  return Boolean(await getMembership(projectId, userId));
}

function parseDueDate(raw: string | null): Date | null | undefined {
  if (raw === null) return null;
  const dueDate = new Date(raw);
  if (Number.isNaN(dueDate.getTime())) return undefined;
  dueDate.setSeconds(0, 0);

  const minutes = dueDate.getMinutes();
  if (minutes < 15) dueDate.setMinutes(0);
  else if (minutes < 45) dueDate.setMinutes(30);
  else {
    dueDate.setHours(dueDate.getHours() + 1);
    dueDate.setMinutes(0);
  }

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
    include: { assignee: { select: { name: true } } },
  });

  if (assigneeId && assigneeId !== user.id) {
    await notify([assigneeId], {
      type: "TASK_ASSIGNED",
      message: `${user.name} đã giao cho bạn task “${title}”`,
      taskId: task.id,
      projectId,
    });
  }

  await sendTaskChat(projectId, task.id, [
    `Công việc mới: *${title}*`,
    `Trạng thái: ${statusLabel(status)}`,
    `Người được giao: ${task.assignee?.name ?? "Chưa giao"}`,
    `Người tạo: ${user.name}`,
  ]);

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

  const updatedTask = await prisma.task.update({
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
    include: { assignee: { select: { name: true } } },
  });

  const title = data.title ?? task.title;
  const statusChanged =
    data.status !== undefined && data.status !== task.status;
  const assigneeChanged =
    data.assigneeId !== undefined && data.assigneeId !== task.assigneeId;
  const dueDateChanged =
    data.dueDate !== undefined &&
    (dueDate?.getTime() ?? null) !== (task.dueDate?.getTime() ?? null);
  const hasFollowerUpdate = statusChanged || assigneeChanged || dueDateChanged;
  const followers = hasFollowerUpdate ? await followerIds(taskId) : [];

  // 🔔 Giao việc: assignee mới ≠ assignee cũ và ≠ người thao tác
  if (
    data.assigneeId !== undefined &&
    data.assigneeId &&
    assigneeChanged &&
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
  if (data.status === "DONE" && statusChanged) {
    await notify(
      [task.creatorId, ...followers].filter(
        (id) =>
          id !== actor.id &&
          (!assigneeChanged || id !== data.assigneeId)
      ),
      {
        type: "TASK_COMPLETED",
        message: `${actor.name} đã hoàn thành task “${title}”`,
        taskId,
        projectId: task.projectId,
      }
    );
  } else if (hasFollowerUpdate) {
    const changes = [
      statusChanged
        ? `trạng thái ${statusLabel(task.status)} → ${statusLabel(updatedTask.status)}`
        : null,
      assigneeChanged
        ? `người phụ trách: ${updatedTask.assignee?.name ?? "Chưa giao"}`
        : null,
      dueDateChanged
        ? `hạn chót: ${deadlineLabel(updatedTask.dueDate)}`
        : null,
    ].filter((change): change is string => Boolean(change));

    await notify(
      followers.filter(
        (id) =>
          id !== actor.id &&
          (!assigneeChanged || id !== data.assigneeId)
      ),
      {
        type: "TASK_UPDATED",
        message: `${actor.name} đã cập nhật task “${title}”: ${changes.join(" · ")}`,
        taskId,
        projectId: task.projectId,
      }
    );
  }

  if (data.status !== undefined && data.status !== task.status) {
    await sendTaskChat(task.projectId, taskId, [
      `Cập nhật trạng thái: *${updatedTask.title}*`,
      `Trạng thái: ${statusLabel(task.status)} → ${statusLabel(updatedTask.status)}`,
      `Người được giao: ${updatedTask.assignee?.name ?? "Chưa giao"}`,
      `Cập nhật bởi: ${actor.name}`,
    ]);
  } else if (
    data.assigneeId !== undefined &&
    data.assigneeId !== task.assigneeId
  ) {
    await sendTaskChat(task.projectId, taskId, [
      `Cập nhật người được giao: *${updatedTask.title}*`,
      `Trạng thái: ${statusLabel(updatedTask.status)}`,
      `Người được giao: ${updatedTask.assignee?.name ?? "Chưa giao"}`,
      `Cập nhật bởi: ${actor.name}`,
    ]);
  }

  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath("/");
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

  const updatedTask = await prisma.task.update({
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
    include: { assignee: { select: { name: true } } },
  });

  // 🔔 Thay đổi trạng thái: người theo dõi nhận cập nhật; hoàn thành báo thêm người giao
  if (status !== task.status) {
    const followers = await followerIds(taskId);
    if (status === "DONE") {
      await notify(
        [task.creatorId, ...followers].filter((id) => id !== actor.id),
        {
          type: "TASK_COMPLETED",
          message: `${actor.name} đã hoàn thành task “${task.title}”`,
          taskId,
          projectId: task.projectId,
        }
      );
    } else {
      await notify(
        followers.filter((id) => id !== actor.id),
        {
          type: "TASK_UPDATED",
          message: `${actor.name} đã cập nhật task “${task.title}”: trạng thái ${statusLabel(task.status)} → ${statusLabel(updatedTask.status)}`,
          taskId,
          projectId: task.projectId,
        }
      );
    }
  }

  if (status !== task.status) {
    await sendTaskChat(task.projectId, taskId, [
      `Cập nhật trạng thái: *${updatedTask.title}*`,
      `Trạng thái: ${statusLabel(task.status)} → ${statusLabel(updatedTask.status)}`,
      `Người được giao: ${updatedTask.assignee?.name ?? "Chưa giao"}`,
      `Cập nhật bởi: ${actor.name}`,
    ]);
  }

  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath("/");
}

export async function deleteTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  await assertMember(task.projectId);

  await prisma.task.delete({ where: { id: taskId } });
  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath("/");
}

export async function addComment(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Bình luận không được để trống." };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { assignee: { select: { name: true } } },
  });
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

  const chatSnippet =
    body.length > 300 ? `${body.slice(0, 300).trimEnd()}…` : body;
  await sendTaskChat(task.projectId, taskId, [
    `Bình luận mới: *${task.title}*`,
    `Người bình luận: ${user.name}`,
    `Nội dung: ${chatSnippet}`,
    `Người được giao: ${task.assignee?.name ?? "Chưa giao"}`,
  ]);

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
  revalidatePath("/");
}

export async function removeFollower(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  await assertMember(task.projectId);

  await prisma.taskFollower.deleteMany({
    where: { taskId, userId },
  });
  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath("/");
}
