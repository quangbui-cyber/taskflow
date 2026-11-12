import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { crmEnabled } from "@/lib/features";
import { prisma } from "@/lib/prisma";
import { runCrmReminderJob } from "@/lib/crm/reminderJob";
import { listCrmAllowedUserIds } from "@/lib/crm/access";
import { deliverPush } from "@/lib/webPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DATABASE_RETRY_DELAYS = [0, 1_500, 4_000, 8_000] as const;
function isTransientDatabaseError(error: unknown) {
  return error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(error.code));
}
async function withDatabaseRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < DATABASE_RETRY_DELAYS.length; attempt++) {
    const delay = DATABASE_RETRY_DELAYS[attempt];
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === DATABASE_RETRY_DELAYS.length - 1) throw error;
      console.warn(`CRM reminders database retry ${attempt + 1}`);
    }
  }
  throw lastError;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return new Response("Unauthorized", { status: 401 });
  if (!crmEnabled()) return Response.json({ ok: true, skipped: "CRM_DISABLED" });
  try {
    // crm54: CRM stays on the master switch here; work and notices only reach users who may use CRM.
    const allowedUserIds = await withDatabaseRetry(() => listCrmAllowedUserIds(prisma));
    const allowed = new Set(allowedUserIds);
    const summary = await withDatabaseRetry(() => runCrmReminderJob(prisma, { now: new Date(), allowedPicUserIds: allowedUserIds }));
    const notifications = summary.notifications.filter(row => allowed.has(row.userId));
    const created = notifications.length ? await withDatabaseRetry(() => prisma.notification.createManyAndReturn({ data: notifications, skipDuplicates: true })) : [];
    if (created.length) after(async () => {
      const results = await Promise.allSettled(created.map(row => deliverPush([row.userId], {
        type: row.type, message: row.message, taskId: row.taskId ?? undefined, clientId: row.clientId ?? undefined, opportunityId: row.opportunityId ?? undefined,
      })));
      const failed = results.filter(result => result.status === "rejected").length;
      if (failed) console.warn("CRM reminder push failures", { failed, total: created.length });
    });
    return Response.json({
      ok: true, openedSteps: summary.openedSteps, mergedSteps: summary.mergedSteps, cadenceTasks: summary.cadenceTasks,
      planCloseTasks: summary.planCloseTasks, passedEvents: summary.passedEvents, meetingDrafts: summary.meetingDrafts,
      notifications: created.length, skipped: summary.skipped.length, partial: summary.partial,
    });
  } catch (error) {
    console.error("CRM reminders cron failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ ok: false, error: "CRM reminders failed" }, { status: 503 });
  }
}
