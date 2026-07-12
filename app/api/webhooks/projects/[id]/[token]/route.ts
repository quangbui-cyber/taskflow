import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { PRIORITIES, STATUSES } from "@/lib/types";

const STATUS_KEYS: ReadonlySet<string> = new Set(STATUSES.map((s) => s.key));
const PRIORITY_KEYS: ReadonlySet<string> = new Set(PRIORITIES.map((p) => p.key));

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDueDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const dueDate = new Date(raw);
  return Number.isNaN(dueDate.getTime()) ? undefined : dueDate;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; token: string }> }
) {
  const { id, token } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Body phải là JSON." },
      { status: 400 }
    );
  }

  const data = payload && typeof payload === "object" ? payload : {};
  const record = data as Record<string, unknown>;
  const title = text(record.title) || text(record.name);
  const description = text(record.description);
  const result = text(record.result);
  const status = text(record.status) || "TODO";
  const priority = text(record.priority) || "MEDIUM";
  const dueDate = parseDueDate(record.dueDate);
  const assigneeEmail = text(record.assigneeEmail).toLowerCase();

  if (!title) {
    return Response.json(
      { ok: false, error: "Thiếu title." },
      { status: 400 }
    );
  }
  if (!STATUS_KEYS.has(status)) {
    return Response.json(
      { ok: false, error: "Trạng thái không hợp lệ." },
      { status: 400 }
    );
  }
  if (!PRIORITY_KEYS.has(priority)) {
    return Response.json(
      { ok: false, error: "Độ ưu tiên không hợp lệ." },
      { status: 400 }
    );
  }
  if (dueDate === undefined) {
    return Response.json(
      { ok: false, error: "Hạn chót không hợp lệ." },
      { status: 400 }
    );
  }

  const project = await prisma.project.findFirst({
    where: { id, webhookToken: token },
    include: {
      members: {
        include: { user: { select: { id: true, email: true } } },
      },
    },
  });

  if (!project) {
    return Response.json(
      { ok: false, error: "Webhook không hợp lệ." },
      { status: 404 }
    );
  }

  const assignee = assigneeEmail
    ? project.members.find(
        (member) => member.user.email.toLowerCase() === assigneeEmail
      )
    : null;

  if (assigneeEmail && !assignee) {
    return Response.json(
      { ok: false, error: "Người được giao không thuộc project này." },
      { status: 400 }
    );
  }

  const last = await prisma.task.findFirst({
    where: { projectId: project.id, status },
    orderBy: { order: "desc" },
  });

  const task = await prisma.task.create({
    data: {
      title,
      description: description || null,
      result: result || null,
      status,
      priority,
      dueDate,
      assigneeId: assignee?.userId ?? null,
      projectId: project.id,
      creatorId: project.ownerId,
      order: (last?.order ?? 0) + 1,
      completedAt: status === "DONE" ? new Date() : null,
    },
  });

  if (assignee?.userId && assignee.userId !== project.ownerId) {
    await notify([assignee.userId], {
      type: "TASK_ASSIGNED",
      message: `Webhook đã tạo task “${title}” cho bạn`,
      taskId: task.id,
      projectId: project.id,
    });
  }

  return Response.json({
    ok: true,
    projectId: project.id,
    taskId: task.id,
  });
}
