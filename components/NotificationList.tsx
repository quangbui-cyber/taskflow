"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCircle2,
  Eye,
  Inbox,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { markNotificationRead } from "@/app/actions/notifications";

export type NotificationItem = {
  id: string;
  type: string;
  message: string;
  projectId: string | null;
  read: boolean;
  createdAt: string;
};

const TYPE_ICON: Record<string, LucideIcon> = {
  TASK_ASSIGNED: Inbox,
  TASK_COMPLETED: CheckCircle2,
  COMMENT: MessageSquare,
  TASK_FOLLOW: Eye,
};

function timeAgo(value: string): string {
  const date = new Date(value);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "vừa xong";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return date.toLocaleDateString("vi-VN");
}

export default function NotificationList({
  initialNotifications,
}: {
  initialNotifications: NotificationItem[];
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [readingId, setReadingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const visibleNotifications = useMemo(
    () =>
      filter === "unread"
        ? notifications.filter((notification) => !notification.read)
        : notifications,
    [filter, notifications]
  );

  function openNotification(notification: NotificationItem) {
    if (readingId) return;

    if (notification.read) {
      if (notification.projectId) router.push(`/projects/${notification.projectId}`);
      return;
    }

    setReadingId(notification.id);
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, read: true } : item
      )
    );

    startTransition(async () => {
      try {
        await markNotificationRead(notification.id);
        if (notification.projectId) {
          router.push(`/projects/${notification.projectId}`);
        } else {
          router.refresh();
        }
      } catch {
        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id ? { ...item, read: false } : item
          )
        );
      } finally {
        setReadingId(null);
      }
    });
  }

  return (
    <div className="tf-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div className="inline-flex rounded-[7px] bg-zinc-100 p-1" aria-label="Lọc thông báo">
          <button
            type="button"
            onClick={() => setFilter("all")}
            aria-pressed={filter === "all"}
            className={`min-h-8 rounded-[6px] px-3 text-sm font-medium transition-colors ${
              filter === "all"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            Tất cả
          </button>
          <button
            type="button"
            onClick={() => setFilter("unread")}
            aria-pressed={filter === "unread"}
            className={`inline-flex min-h-8 items-center gap-2 rounded-[6px] px-3 text-sm font-medium transition-colors ${
              filter === "unread"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            Chưa đọc
            {unreadCount > 0 && (
              <span className="min-w-5 rounded-full bg-blue-600 px-1.5 text-center text-[10px] font-bold leading-5 text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
        </div>
        <p className="text-xs text-zinc-400">
          Nhấn vào thông báo để đánh dấu đã đọc
        </p>
      </div>

      {visibleNotifications.length === 0 ? (
        <div className="tf-empty px-5 py-8">
          {filter === "unread"
            ? "Bạn đã đọc hết thông báo."
            : "Chưa có thông báo nào."}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {visibleNotifications.map((notification) => {
            const Icon = TYPE_ICON[notification.type] ?? Bell;
            const isReading = readingId === notification.id;

            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => openNotification(notification)}
                  disabled={isReading}
                  className={`group flex w-full gap-3 px-4 py-3.5 text-left transition-colors sm:px-5 ${
                    notification.read
                      ? "bg-white hover:bg-zinc-50"
                      : "bg-blue-50/65 hover:bg-blue-50"
                  } disabled:cursor-wait disabled:opacity-70`}
                  aria-label={`${notification.read ? "Đã đọc" : "Chưa đọc"}: ${notification.message}`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ${
                      notification.read
                        ? "bg-zinc-100 text-zinc-500"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-sm leading-5 ${
                        notification.read
                          ? "font-normal text-zinc-600"
                          : "font-semibold text-zinc-900"
                      }`}
                    >
                      {notification.message}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-400">
                      {timeAgo(notification.createdAt)}
                    </span>
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                    {!notification.read && (
                      <span
                        className="h-2.5 w-2.5 rounded-full bg-blue-600 ring-4 ring-blue-100"
                        title="Chưa đọc"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
