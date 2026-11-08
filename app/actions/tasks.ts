"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { assertOwnerAccess, assertTaskAccess, isValidAssignee, ownerParticipants } from "@/lib/taskAccess";
import { ownerOf, ownerWhere, ownerData, ownerHref, ownerNotificationFields, ownerRevalidatePaths, parseOwnerInput, type WorkOwner } from "@/lib/workOwner";
import { followerIds, notify } from "@/lib/notify";
import { parseCommentMentions } from "@/lib/commentMentions";
import { hasProjectChat, sendProjectChat } from "@/lib/projectChatMessage";
import { taskCommentChatMessage, taskGoogleChatMessage, type TaskChatInput } from "@/lib/taskGoogleChat";
import type { GoogleChatMessage } from "@/lib/googleChat";
import { PRIORITIES, STATUSES, TASK_CANCELLED } from "@/lib/types";
import { readTaskCreationFiles } from "@/lib/taskCreationFiles";
import { driveFolderKeys, queueOwnerDrivePush, renameDriveFolderSafe, trashTaskFolderSafe } from "@/lib/driveStorage";
import { after } from "next/server";
import { validTaskTimeRange } from "@/lib/taskTimeRange";

async function projectChat(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, googleChatSpaceName: true },
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
  return `${protocol}://${host}${ownerHref({ kind: "PROJECT", id: projectId }, taskId)}`;
}

async function sendTaskChat(
  projectId: string,
  taskId: string,
  input:
    | Omit<TaskChatInput, "taskId" | "projectName" | "url">
    | ((context: { projectName: string; url: string }) => GoogleChatMessage)
) {
  const chat = await projectChat(projectId);
  if (!chat || !hasProjectChat(chat)) return;
  const url = await taskLink(projectId, taskId);
  await sendProjectChat(
    chat,
    typeof input === "function"
      ? input({ projectName: chat.name, url })
      : taskGoogleChatMessage({ ...input, taskId, projectName: chat.name, url })
  );
}

export type ActionState = { error?: string; success?: string };

const STATUS_KEYS: ReadonlySet<string> = new Set(STATUSES.map((s) => s.key));
const PRIORITY_KEYS: ReadonlySet<string> = new Set(
  PRIORITIES.map((p) => p.key)
);

async function taskActor(taskId: string, action: "EDIT" | "DELETE" | "COMMENT" | "FOLLOW") {
  const user = await requireUser();
  const access = await assertTaskAccess(prisma, user, taskId, action);
  if ("error" in access) throw new Error(access.error);
  return user;
}

function revalidateOwner(owner: WorkOwner) {
  for (const path of ownerRevalidatePaths(owner)) revalidatePath(path);
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
  const owner = formData.has("ownerKind") || formData.has("ownerId")
    ? parseOwnerInput(formData.get("ownerKind"), formData.get("ownerId"))
    : parseOwnerInput("PROJECT", projectId);
  if (!owner) return { error: "Nơi sở hữu công việc không hợp lệ." };
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim();
  const status = String(formData.get("status") ?? "TODO");
  const priority = String(formData.get("priority") ?? "MEDIUM");
  const assigneeId = String(formData.get("assigneeId") ?? "") || null;
  const startDateRaw = String(formData.get("startDate") ?? "").trim();
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  const startDate = startDateRaw ? parseDueDate(startDateRaw) : null;
  const dueDate = dueDateRaw ? parseDueDate(dueDateRaw) : null;

  if (!title) return { error: "Tiêu đề task không được để trống." };
  if (!STATUS_KEYS.has(status)) return { error: "Trạng thái không hợp lệ." };
  if (!PRIORITY_KEYS.has(priority)) {
    return { error: "Độ ưu tiên không hợp lệ." };
  }
  if (startDate === undefined || dueDate === undefined) {
    return { error: "Thời gian công việc không hợp lệ." };
  }
  if (!validTaskTimeRange(startDate, dueDate)) {
    return { error: "Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày." };
  }

  const user = await requireUser();
  const access = await assertOwnerAccess(prisma, user, owner, "CREATE_TASK");
  if ("error" in access) return access;
  if (assigneeId && !(await isValidAssignee(prisma, owner, assigneeId))) {
    return { error: "Người được giao không thuộc project này." };
  }

  let attachments: Awaited<ReturnType<typeof readTaskCreationFiles>>;
  try {
    attachments = await readTaskCreationFiles(formData);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Tệp đính kèm không hợp lệ.",
    };
  }

  const last = await prisma.task.findFirst({
    where: { ...ownerWhere(owner), status },
    orderBy: { order: "desc" },
  });

  const task = await prisma.task.create({
    data: {
      title,
      description: description || null,
      result: result || null,
      ...ownerData(owner),
      status,
      priority,
      startDate,
      dueDate,
      assigneeId,
      creatorId: user.id,
      order: (last?.order ?? 0) + 1,
      completedAt: status === "DONE" ? new Date() : null,
      // Nested writes commit the task and every attachment together.
      files: {
        create: attachments.map(({ kind, upload }) => ({
          ...upload,
          kind,
          uploaderId: user.id,
        })),
      },
    },
    include: { assignee: { select: { name: true } } },
  });

  if (assigneeId && assigneeId !== user.id) {
    await notify([assigneeId], {
      type: "TASK_ASSIGNED",
      message: `${user.name} đã giao cho bạn task “${title}”`,
      taskId: task.id,
      ...ownerNotificationFields(owner),
    });
  }

  if (owner.kind === "PROJECT") await sendTaskChat(owner.id, task.id, {
    event: "created", title, status,
    assigneeName: task.assignee?.name ?? null,
    actorName: user.name, dueDate: task.dueDate,
  });

  if (attachments.length > 0) queueOwnerDrivePush(owner);
  revalidateOwner(owner);
  return {};
}

export async function updateTask(
  taskId: string,
  data: {
    title?: string;
    description?: string | null;
    result?: string | null;
    priority?: string;
    startDate?: string | null;
    dueDate?: string | null;
    assigneeId?: string | null;
    status?: string;
  }
): Promise<ActionState> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return { error: "Task không tồn tại." };
  const actor = await taskActor(taskId, "EDIT");
  const owner = ownerOf(task);
  if (task.status === TASK_CANCELLED) return { error: "Việc đã đóng tự động, không đổi trạng thái được." };
  if (owner.kind !== "PROJECT" && data.assigneeId !== undefined && data.assigneeId !== task.assigneeId) {
    const assignment = await assertOwnerAccess(prisma, actor, owner, "CREATE_TASK");
    if ("error" in assignment) return assignment;
  }
  if (data.title !== undefined && !data.title.trim()) {
    return { error: "Tiêu đề task không được để trống." };
  }
  if (data.status !== undefined && !STATUS_KEYS.has(data.status)) {
    return { error: "Trạng thái không hợp lệ." };
  }
  if (data.priority !== undefined && !PRIORITY_KEYS.has(data.priority)) {
    return { error: "Độ ưu tiên không hợp lệ." };
  }
  if (
    data.assigneeId !== undefined &&
    data.assigneeId !== null &&
    !(await isValidAssignee(prisma, owner, data.assigneeId))
  ) {
    return { error: "Người được giao không thuộc project này." };
  }
  const startDate =
    data.startDate !== undefined ? parseDueDate(data.startDate) : undefined;
  const dueDate =
    data.dueDate !== undefined ? parseDueDate(data.dueDate) : undefined;
  if (data.startDate !== undefined && startDate === undefined) {
    return { error: "Thời gian bắt đầu không hợp lệ." };
  }
  if (data.dueDate !== undefined && dueDate === undefined) {
    return { error: "Thời gian kết thúc không hợp lệ." };
  }
  const nextStartDate =
    data.startDate !== undefined ? startDate ?? null : task.startDate;
  const nextDueDate = data.dueDate !== undefined ? dueDate ?? null : task.dueDate;
  if (!validTaskTimeRange(nextStartDate, nextDueDate)) {
    return { error: "Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày." };
  }

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...(data.result !== undefined ? { result: data.result } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.startDate !== undefined ? { startDate } : {}),
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
      ...ownerNotificationFields(owner),
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
        ...ownerNotificationFields(owner),
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
        ...ownerNotificationFields(owner),
      }
    );
  }

  if (data.status !== undefined && data.status !== task.status) {
    if (owner.kind === "PROJECT") await sendTaskChat(owner.id, taskId, {
      event: "status_changed", title: updatedTask.title,
      previousStatus: task.status, status: updatedTask.status,
      assigneeName: updatedTask.assignee?.name ?? null,
      actorName: actor.name, dueDate: updatedTask.dueDate,
    });
  } else if (
    data.assigneeId !== undefined &&
    data.assigneeId !== task.assigneeId
  ) {
    if (owner.kind === "PROJECT") await sendTaskChat(owner.id, taskId, {
      event: "assignee_changed", title: updatedTask.title, status: updatedTask.status,
      assigneeName: updatedTask.assignee?.name ?? null,
      actorName: actor.name, dueDate: updatedTask.dueDate,
    });
  }

  if (owner.kind === "PROJECT" && data.title !== undefined && data.title !== task.title) {
    after(() => renameDriveFolderSafe(driveFolderKeys.task(taskId), updatedTask.title));
  }
  revalidateOwner(owner);
  revalidatePath("/");
  return {};
}

/** Di chuyển task sang cột khác / vị trí khác (kéo thả) */
export async function moveTask(
  taskId: string,
  status: string,
  order: number
) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  const actor = await taskActor(taskId, "EDIT");
  const owner = ownerOf(task);
  if (task.status === TASK_CANCELLED) return;
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
          ...ownerNotificationFields(owner),
        }
      );
    } else {
      await notify(
        followers.filter((id) => id !== actor.id),
        {
          type: "TASK_UPDATED",
          message: `${actor.name} đã cập nhật task “${task.title}”: trạng thái ${statusLabel(task.status)} → ${statusLabel(updatedTask.status)}`,
          taskId,
          ...ownerNotificationFields(owner),
        }
      );
    }
  }

  if (status !== task.status) {
    if (owner.kind === "PROJECT") await sendTaskChat(owner.id, taskId, {
      event: "status_changed", title: updatedTask.title,
      previousStatus: task.status, status: updatedTask.status,
      assigneeName: updatedTask.assignee?.name ?? null,
      actorName: actor.name, dueDate: updatedTask.dueDate,
    });
  }

  revalidateOwner(owner);
  revalidatePath("/");
}

export async function deleteTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  await taskActor(taskId, "DELETE");
  const owner = ownerOf(task);

  await prisma.task.delete({ where: { id: taskId } });
  if (owner.kind === "PROJECT") after(() => trashTaskFolderSafe(taskId));
  revalidateOwner(owner);
  revalidatePath("/");
}

export async function addComment(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const rawBody = String(formData.get("body") ?? "");
  const body = rawBody.trim();
  if (!body) return { error: "Bình luận không được để trống." };
  if (body.length > 5000) return { error: "Bình luận không được dài quá 5.000 ký tự." };
  let rawMentions: unknown;
  try {
    rawMentions = JSON.parse(String(formData.get("mentions") ?? "[]"));
  } catch {
    return { error: "Danh sách người được nhắc không hợp lệ." };
  }
  const leadingWhitespace = rawBody.length - rawBody.trimStart().length;
  const mentions = parseCommentMentions(rawMentions, rawBody)
    .map((mention) => ({ ...mention, start: mention.start - leadingWhitespace, end: mention.end - leadingWhitespace }));

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { assignee: { select: { name: true } } },
  });
  if (!task) return { error: "Task không tồn tại." };
  const user = await taskActor(taskId, "COMMENT");
  const owner = ownerOf(task);

  const mentionedIds = [...new Set(mentions.map((mention) => mention.userId))];
  if (mentionedIds.length) {
    const allowed = new Set(await ownerParticipants(prisma, owner));
    const members = await prisma.user.findMany({
      where: { id: { in: mentionedIds.filter((id) => allowed.has(id)) }, isActive: true },
      select: { id: true, name: true },
    });
    if (members.length !== mentionedIds.length) {
      return { error: "Người được nhắc phải là thành viên đang hoạt động của dự án. Hãy chọn lại từ danh sách @." };
    }
    const names = new Map(members.map((member) => [member.id, member.name]));
    if (mentions.some((mention) => names.get(mention.userId) !== mention.name)) {
      return { error: "Tên người được nhắc đã thay đổi. Hãy chọn lại từ danh sách @." };
    }
  }

  await prisma.comment.create({
    data: { body, taskId, authorId: user.id, mentions },
  });

  // 🔔 Bình luận: báo người làm, người giao và người theo dõi (trừ người viết)
  const followers = await followerIds(taskId);
  const snippet = body.length > 60 ? body.slice(0, 60) + "…" : body;
  await notify(
    [task.assigneeId, task.creatorId, ...followers].filter(
      (id) => id !== user.id && !mentionedIds.includes(id ?? "")
    ),
    {
      type: "COMMENT",
      message: `${user.name} đã bình luận vào task “${task.title}”: ${snippet}`,
      taskId,
      ...ownerNotificationFields(owner),
    }
  );

  await notify(mentionedIds.filter((id) => id !== user.id), {
    type: "COMMENT_MENTION",
    message: `${user.name} đã nhắc đến bạn trong bình luận task “${task.title}”: ${snippet}`,
    taskId,
    ...ownerNotificationFields(owner),
  });

  if (owner.kind === "PROJECT") await sendTaskChat(owner.id, taskId, ({ projectName, url }) =>
    taskCommentChatMessage({
      taskId, projectName, url,
      title: task.title,
      authorName: user.name,
      comment: body,
      assigneeName: task.assignee?.name ?? null,
    })
  );

  revalidateOwner(owner);
  revalidatePath("/notifications");
  return { success: "Đã gửi bình luận." };
}


/** Thêm một người vào danh sách theo dõi task (phải là thành viên project) */
export async function addFollower(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  const actor = await taskActor(taskId, "FOLLOW");
  const owner = ownerOf(task);
  if (task.status === TASK_CANCELLED) return;

  const membership = await isValidAssignee(prisma, owner, userId);
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
      ...ownerNotificationFields(owner),
    });
  }

  revalidateOwner(owner);
  revalidatePath("/");
}

export async function removeFollower(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;
  await taskActor(taskId, "FOLLOW");
  const owner = ownerOf(task);

  await prisma.taskFollower.deleteMany({
    where: { taskId, userId },
  });
  revalidateOwner(owner);
  revalidatePath("/");
}

