import { Bell } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import NotificationList from "@/components/NotificationList";

export default async function NotificationsPage() {
  const user = await requireUser();

  const [notifications, sidebarProjects] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
      select: { id: true, name: true, color: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

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
              <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-blue-50 text-blue-600">
                <Bell size={20} aria-hidden="true" />
              </span>
              <h1 className="tf-page-title">Thông báo</h1>
            </div>
            <p className="tf-page-subtitle">
              Theo dõi các cập nhật mới và mở từng thông báo khi bạn sẵn sàng xử lý.
            </p>
          </div>

          <NotificationList
            initialNotifications={notifications.map((notification) => ({
              id: notification.id,
              type: notification.type,
              message: notification.message,
              projectId: notification.projectId,
              read: notification.read,
              createdAt: notification.createdAt.toISOString(),
            }))}
          />
        </div>
      </main>
    </div>
  );
}
