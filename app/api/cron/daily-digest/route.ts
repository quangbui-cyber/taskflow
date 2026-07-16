import { prisma } from "@/lib/prisma";
import { sendGoogleChat } from "@/lib/googleChat";
import { daysUntil, formatDue, isOverdue } from "@/lib/dates";
import { ARCHIVED_PROJECT_STATUS_KEYS } from "@/lib/types";

// Đọc/ghi database nên phải chạy trên Node runtime, không dùng edge.
export const runtime = "nodejs";
// Luôn chạy động, không cache — mỗi lần cron gọi phải đọc dữ liệu mới nhất.
export const dynamic = "force-dynamic";

type DigestTask = {
  title: string;
  dueDate: Date | null;
  assignee: { name: string } | null;
};

function taskLine(task: DigestTask) {
  const who = task.assignee?.name ?? "chưa gán";
  const due = task.dueDate ? formatDue(task.dueDate) : "chưa đặt hạn";
  return `• ${task.title} — ${who} (${due})`;
}

/** Soạn tin nhắn cho một dự án; trả null nếu không có gì đáng báo. */
function buildMessage(
  projectName: string,
  overdue: DigestTask[],
  dueToday: DigestTask[]
): string | null {
  if (overdue.length === 0 && dueToday.length === 0) return null;

  const parts = [`*${projectName}* — nhắc việc hàng ngày`];

  if (overdue.length > 0) {
    parts.push(
      "",
      `🔴 Quá hạn (${overdue.length})`,
      ...overdue.map(taskLine)
    );
  }
  if (dueToday.length > 0) {
    parts.push(
      "",
      `🟡 Đến hạn hôm nay (${dueToday.length})`,
      ...dueToday.map(taskLine)
    );
  }

  return parts.join("\n");
}

export async function GET(request: Request) {
  // Vercel tự gửi header này khi cron chạy (lấy từ biến môi trường CRON_SECRET).
  // Nếu chưa cấu hình secret thì từ chối luôn, tránh để endpoint mở cho người lạ.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Chỉ nhắc dự án đang chạy và đã cấu hình webhook Chat.
  const projects = await prisma.project.findMany({
    where: {
      googleChatWebhookUrl: { not: null },
      status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] },
    },
    select: {
      id: true,
      name: true,
      googleChatWebhookUrl: true,
      tasks: {
        where: { status: { not: "DONE" }, dueDate: { not: null } },
        select: {
          title: true,
          dueDate: true,
          assignee: { select: { name: true } },
        },
        orderBy: [{ dueDate: "asc" }],
      },
    },
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const project of projects) {
    const overdue: DigestTask[] = [];
    const dueToday: DigestTask[] = [];

    for (const task of project.tasks) {
      if (!task.dueDate) continue;
      if (isOverdue(task.dueDate)) overdue.push(task);
      else if (daysUntil(task.dueDate) === 0) dueToday.push(task);
    }

    const message = buildMessage(project.name, overdue, dueToday);
    if (!message) {
      skipped += 1;
      continue;
    }

    // sendGoogleChat đã tự bọc try/catch, không ném lỗi ra ngoài —
    // một dự án gửi hỏng không được làm dừng các dự án còn lại.
    const result = await sendGoogleChat(project.googleChatWebhookUrl!, message);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  return Response.json({ ok: true, projects: projects.length, sent, skipped, failed });
}
