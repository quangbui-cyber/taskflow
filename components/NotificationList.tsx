"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  AlarmClock,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Inbox,
  MessageSquare,
  RefreshCw,
  Star,
  type LucideIcon,
} from "lucide-react";
import { markNotificationRead } from "@/app/actions/notifications";

export type NotificationItem = {
  id: string;
  type: string;
  message: string;
  projectId: string | null;
  taskId: string | null;
  recognitionId: string | null;
  read: boolean;
  createdAt: string;
};

const TYPE_ICON: Record<string, LucideIcon> = {
  TASK_ASSIGNED: Inbox,
  TASK_COMPLETED: CheckCircle2,
  TASK_UPDATED: RefreshCw,
  COMMENT: MessageSquare,
  COMMENT_MENTION: MessageSquare,
  TASK_FOLLOW: Eye,
  DEADLINE_REMINDER: AlarmClock,
  RECOGNITION_RECEIVED: Star,
  LEAVE_REQUEST: CalendarDays,
  LEAVE_DECISION: CalendarDays,
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
  activeView,
  currentPage,
  initialNotifications,
  totalPages,
  totalUnread: initialTotalUnread,
}: {
  activeView: "all" | "unread" | "archive";
  currentPage: number;
  initialNotifications: NotificationItem[];
  totalPages: number;
  totalUnread: number;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [totalUnread, setTotalUnread] = useState(initialTotalUnread);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (activeView !== "all") params.set("view", activeView);
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return query ? `/notifications?${query}` : "/notifications";
  };

  function openNotification(notification: NotificationItem) {
    if (readingId) return;

    const destination = notification.type.startsWith("LEAVE_")
      ? "/leave"
      : notification.recognitionId
      ? `/recognition?focus=${notification.recognitionId}#recognition-${notification.recognitionId}`
      : notification.projectId
        ? `/projects/${notification.projectId}${
            notification.taskId ? `?task=${notification.taskId}` : ""
          }`
        : null;

    if (notification.read) {
      if (destination) router.push(destination);
      return;
    }

    setReadingId(notification.id);
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, read: true } : item
      )
    );
    if (!notification.read && activeView !== "archive") {
      setTotalUnread((current) => Math.max(0, current - 1));
    }

    startTransition(async () => {
      try {
        await markNotificationRead(notification.id);
        if (destination) {
          router.push(destination);
        } else {
          router.refresh();
        }
      } catch {
        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id ? { ...item, read: false } : item
          )
        );
        if (!notification.read && activeView !== "archive") {
          setTotalUnread((current) => current + 1);
        }
      } finally {
        setReadingId(null);
      }
    });
  }

  return (
    <div className="tf-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div className="tf-scroll-tabs inline-flex rounded-[7px] bg-zinc-100 p-1" aria-label="Lọc thông báo">
          <Link
            href="/notifications"
            aria-current={activeView === "all" ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-[6px] px-3 text-sm font-medium transition-colors ${
              activeView === "all"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            Tất cả
          </Link>
          <Link
            href="/notifications?view=unread"
            aria-current={activeView === "unread" ? "page" : undefined}
            className={`inline-flex min-h-10 items-center gap-2 rounded-[6px] px-3 text-sm font-medium transition-colors ${
              activeView === "unread"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            Chưa đọc
            {totalUnread > 0 && (
              <span className="min-w-5 rounded-full bg-brand-400 px-1.5 text-center text-[10px] font-bold leading-5 text-zinc-950">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </Link>
          <Link
            href="/notifications?view=archive"
            aria-current={activeView === "archive" ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-[6px] px-3 text-sm font-medium transition-colors ${
              activeView === "archive"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            Lưu trữ
          </Link>
        </div>
        <p className="hidden text-xs text-zinc-400 sm:block">
          Nhấn vào thông báo để đánh dấu đã đọc
        </p>
      </div>

      {notifications.length === 0 ? (
        <div className="tf-empty px-5 py-8">
          {activeView === "unread"
            ? "Bạn đã đọc hết thông báo."
            : activeView === "archive"
              ? "Chưa có thông báo nào quá 7 ngày."
              : "Chưa có thông báo nào."}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {notifications.map((notification) => {
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
                      : "bg-brand-50/65 hover:bg-brand-50"
                  } disabled:cursor-wait disabled:opacity-70`}
                  aria-label={`${notification.read ? "Đã đọc" : "Chưa đọc"}: ${notification.message}`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ${
                      notification.read
                        ? "bg-zinc-100 text-zinc-500"
                        : "bg-brand-100 text-brand-700"
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
                        className="h-2.5 w-2.5 rounded-full bg-brand-400 ring-4 ring-brand-100"
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

      {totalPages > 1 && (
        <nav
          className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 sm:px-5"
          aria-label="Phân trang thông báo"
        >
          {currentPage > 1 ? (
            <Link
              href={pageHref(currentPage - 1)}
              className="tf-button-secondary min-h-9 px-3"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Trang trước
            </Link>
          ) : (
            <span className="min-h-9" />
          )}
          <span className="text-xs font-medium text-zinc-500">
            Trang {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link
              href={pageHref(currentPage + 1)}
              className="tf-button-secondary min-h-9 px-3"
            >
              Trang sau
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            <span className="min-h-9" />
          )}
        </nav>
      )}
    </div>
  );
}
