import { Bell } from "lucide-react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import NotificationList from "@/components/NotificationList";
import { dispatchWorkflowNotifications } from "@/lib/workflow/notifications";
import PushNotificationSettings from "@/components/PushNotificationSettings";
import { pushConfiguration } from "@/lib/webPush";

const PAGE_SIZE = 20;

type NotificationView = "all" | "unread" | "archive";

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const user = await requireUser();
  await dispatchWorkflowNotifications();
  const params = await searchParams;
  const view: NotificationView =
    params.view === "unread" || params.view === "archive" ? params.view : "all";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const archiveCutoff = daysAgo(7);
  const deletionCutoff = daysAgo(30);
  await prisma.notification.deleteMany({
    where: { createdAt: { lt: deletionCutoff } },
  });
  const notificationWhere = {
    userId: user.id,
    createdAt:
      view === "archive"
        ? { gte: deletionCutoff, lt: archiveCutoff }
        : { gte: archiveCutoff },
    ...(view === "unread" ? { read: false } : {}),
  };

  const [totalNotifications, totalUnread, totalUnreadAll, sidebarProjects] = await Promise.all([
    prisma.notification.count({ where: notificationWhere }),
    prisma.notification.count({
      where: { userId: user.id, read: false, createdAt: { gte: archiveCutoff } },
    }),
    prisma.notification.count({
      where: { userId: user.id, read: false },
    }),
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
      select: {
        id: true,
        name: true,
        color: true,
        status: true,
        category: true,
        responsibleTeam: { select: { id: true, name: true } },
        responsibleGroup: { select: { id: true, name: true } },
        account: { select: { team: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalNotifications / PAGE_SIZE));
  if (requestedPage > totalPages) {
    const query = view === "all" ? "" : `?view=${view}`;
    redirect(`/notifications${query}`);
  }

  const notifications = await prisma.notification.findMany({
    where: notificationWhere,
    include: { workflowRequest: { select: { module: true } } },
    orderBy: { createdAt: "desc" },
    skip: (requestedPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return (
    <div className="tf-shell">
      <Sidebar
        user={{ ...user }}
        projects={sidebarProjects}
        activeSection="notifications"
      />

      <main className="tf-main">
        <div className="tf-page-narrow space-y-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
                <Bell size={20} aria-hidden="true" />
              </span>
              <h1 className="tf-page-title">Thông báo</h1>
            </div>
          </div>

          <PushNotificationSettings publicKey={pushConfiguration()?.publicKey ?? null} />

          <NotificationList
            // Danh sách giữ trạng thái "đã đọc" tạm ở client; đổi key khi dữ liệu
            // server thay đổi để thông báo mới hiện ra sau mỗi lần tải lại.
            key={`${view}-${requestedPage}-${totalUnread}-${totalUnreadAll}-${notifications
              .map((notification) => `${notification.id}${notification.read ? "r" : "u"}`)
              .join("")}`}
            activeView={view}
            currentPage={requestedPage}
            initialNotifications={notifications.map((notification) => ({
              id: notification.id,
              type: notification.type,
              message: notification.message,
              projectId: notification.projectId,
              taskId: notification.taskId,
              recognitionId: notification.recognitionId,
              workflowRequestId: notification.workflowRequestId,
              workflowModule: notification.workflowRequest?.module ?? null,
              meetingId: notification.meetingId,
              read: notification.read,
              createdAt: notification.createdAt.toISOString(),
            }))}
            totalPages={totalPages}
            totalUnread={totalUnread}
            totalUnreadAll={totalUnreadAll}
          />
        </div>
      </main>
    </div>
  );
}
