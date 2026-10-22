import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { deliverPush } from "@/lib/webPush";
import { prisma } from "@/lib/prisma";
import { sendGoogleChat } from "@/lib/googleChat";
import { daysUntil, formatDue, isOverdue } from "@/lib/dates";
import { meetingsEnabled } from "@/lib/features";
import { cleanupMeetingRecaps } from "@/lib/meetingRecapJob";
import { formatMeetingTime, vnDayRange } from "@/lib/meetings";
import { ARCHIVED_PROJECT_STATUS_KEYS } from "@/lib/types";

// Đọc/ghi database nên phải chạy trên Node runtime, không dùng edge.
export const runtime = "nodejs";
// Luôn chạy động, không cache — mỗi lần cron gọi phải đọc dữ liệu mới nhất.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DigestTask = {
  id: string;
  title: string;
  dueDate: Date | null;
  assigneeId: string | null;
  creatorId: string;
  assignee: { name: string } | null;
};

const DATABASE_RETRY_DELAYS = [0, 1_500, 4_000, 8_000] as const;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTransientDatabaseError(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(error.code)
  );
}

async function withDatabaseRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < DATABASE_RETRY_DELAYS.length; attempt += 1) {
    const delay = DATABASE_RETRY_DELAYS[attempt];
    if (delay > 0) await sleep(delay);

    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (
        !isTransientDatabaseError(error) ||
        attempt === DATABASE_RETRY_DELAYS.length - 1
      ) {
        throw error;
      }
      console.warn(`Daily digest database retry ${attempt + 1}`);
    }
  }

  throw lastError;
}

function vietnamDateKey(date = new Date()) {
  const vietnamTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const year = vietnamTime.getUTCFullYear();
  const month = String(vietnamTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(vietnamTime.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

  try {
    const projects = await withDatabaseRetry(() =>
      prisma.project.findMany({
        where: {
          status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] },
        },
        select: {
          id: true,
          name: true,
          googleChatWebhookUrl: true,
          tasks: {
            where: { status: { not: "DONE" }, dueDate: { not: null } },
            select: {
              id: true,
              title: true,
              dueDate: true,
              assigneeId: true,
              creatorId: true,
              assignee: { select: { name: true } },
            },
            orderBy: [{ dueDate: "asc" }],
          },
        },
      })
    );

    const dateKey = vietnamDateKey();
    let reminders = 0;
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const project of projects) {
      const candidates: { task: DigestTask; overdueTask: boolean; dedupeKey: string }[] = [];

      for (const task of project.tasks) {
        if (!task.dueDate) continue;
        const overdueTask = isOverdue(task.dueDate);
        const needsReminder = overdueTask || daysUntil(task.dueDate) === 0;
        if (!needsReminder) continue;

        const recipientId = task.assigneeId ?? task.creatorId;
        candidates.push({
          task,
          overdueTask,
          dedupeKey: `deadline:${dateKey}:${task.id}:${recipientId}`,
        });
      }

      if (candidates.length === 0) {
        skipped += 1;
        continue;
      }

      // Chỉ nhắc task hôm nay CHƯA nhắc — nếu endpoint bị gọi lại trong ngày
      // (thử thủ công, retry...), cả thông báo lẫn tin Chat đều không lặp lại
      // những task đã nhắc buổi sáng; chỉ task mới đến hạn mới được gửi thêm.
      const existing = await withDatabaseRetry(() =>
        prisma.notification.findMany({
          where: { dedupeKey: { in: candidates.map((c) => c.dedupeKey) } },
          select: { dedupeKey: true },
        })
      );
      const alreadyNotified = new Set(existing.map((row) => row.dedupeKey));
      const fresh = candidates.filter((c) => !alreadyNotified.has(c.dedupeKey));

      if (fresh.length === 0) {
        skipped += 1;
        continue;
      }

      const overdue = fresh.filter((c) => c.overdueTask).map((c) => c.task);
      const dueToday = fresh.filter((c) => !c.overdueTask).map((c) => c.task);
      const notificationRows: Prisma.NotificationCreateManyInput[] = fresh.map(
        (c) => ({
          dedupeKey: c.dedupeKey,
          userId: c.task.assigneeId ?? c.task.creatorId,
          type: "DEADLINE_REMINDER",
          message: `Nhắc hạn: [${project.name}] task “${c.task.title}” ${formatDue(c.task.dueDate!)}.`,
          taskId: c.task.id,
          projectId: project.id,
        })
      );

      const created = await withDatabaseRetry(() =>
        prisma.notification.createManyAndReturn({
          data: notificationRows,
          skipDuplicates: true,
        })
      );
      reminders += created.length;
      if (created.length > 0) {
        after(async () => {
          const results = await Promise.allSettled(created.map((notification) =>
            deliverPush([notification.userId], {
              type: notification.type,
              message: notification.message,
              projectId: notification.projectId ?? undefined,
              taskId: notification.taskId ?? undefined,
            })
          ));
          if (results.some((result) => result.status === "rejected")) console.warn("Some deadline push notifications could not be sent.");
        });
      }

      const message = buildMessage(project.name, overdue, dueToday);
      if (!message || !project.googleChatWebhookUrl) {
        skipped += 1;
        continue;
      }

      const result = await sendGoogleChat(project.googleChatWebhookUrl, message);
      if (result.ok) sent += 1;
      else failed += 1;
    }

    // Nhắc mọi người về các cuộc họp diễn ra trong hôm nay (một lần mỗi ngày cho mỗi người).
    const today = vnDayRange();
    // Lịch họp đang tạm ẩn thì không nhắc họp.
    const meetingsToday = !meetingsEnabled()
      ? []
      : await withDatabaseRetry(() =>
      prisma.meeting.findMany({
        where: {
          status: "SCHEDULED",
          startAt: { gte: today.start, lt: today.end },
          endAt: { gt: new Date() },
        },
        select: {
          id: true,
          title: true,
          startAt: true,
          endAt: true,
          organizerId: true,
          room: { select: { name: true } },
          attendees: {
            where: { response: { not: "DECLINED" } },
            select: { userId: true },
          },
        },
      })
    );
    const meetingRows: Prisma.NotificationCreateManyInput[] = meetingsToday.flatMap(
      (meeting) =>
        [meeting.organizerId, ...meeting.attendees.map((attendee) => attendee.userId)].map(
          (userId) => ({
            dedupeKey: `meeting:${dateKey}:${meeting.id}:${userId}`,
            userId,
            type: "MEETING_REMINDER",
            message: `Hôm nay bạn có họp “${meeting.title}” lúc ${formatMeetingTime(
              meeting.startAt,
              meeting.endAt
            )}${meeting.room ? ` tại ${meeting.room.name}` : ""}.`,
            meetingId: meeting.id,
          })
        )
    );
    const createdMeetingReminders =
      meetingRows.length > 0
        ? await withDatabaseRetry(() =>
            prisma.notification.createManyAndReturn({
              data: meetingRows,
              skipDuplicates: true,
            })
          )
        : [];
    const meetingReminders = createdMeetingReminders.length;
    if (meetingReminders > 0) {
      after(async () => {
        const results = await Promise.allSettled(createdMeetingReminders.map((notification) =>
          deliverPush([notification.userId], {
            type: notification.type,
            message: notification.message,
            meetingId: notification.meetingId ?? undefined,
          })
        ));
        if (results.some((result) => result.status === "rejected")) console.warn("Some meeting push notifications could not be sent.");
      });
    }

    await withDatabaseRetry(() =>
      prisma.notification.deleteMany({
        where: {
          createdAt: {
            lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      })
    );

    // Biên bản họp: đánh dấu lỗi lần xử lý bị treo, xoá file ghi âm còn sót.
    let meetingRecaps: { stuck: number; cleaned: number } | null = null;
    try {
      meetingRecaps = await cleanupMeetingRecaps();
    } catch (error) {
      console.warn("Meeting recap cleanup failed", error);
    }

    return Response.json({
      ok: true,
      projects: projects.length,
      reminders,
      meetingReminders,
      meetingRecaps,
      chat: { sent, skipped, failed },
    });
  } catch (error) {
    console.error("Daily digest failed after database retries", error);
    return Response.json(
      { ok: false, error: "Không thể kết nối database sau nhiều lần thử." },
      { status: 503 }
    );
  }
}
