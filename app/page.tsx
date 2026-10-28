import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bell,
  BriefcaseBusiness,
  Cake,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  FolderOpen,
  Heart,
  Plane,
  Plus,
  Star,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { canCreateProjects, requireUser } from "@/lib/auth";
import { daysUntil, isOverdue } from "@/lib/dates";
import { meetingsEnabled } from "@/lib/features";
import { getDailyInspiration } from "@/lib/daily-inspiration";
import { formatLeaveDays, summarizeLeave, todayInVietnam } from "@/lib/leave";
import { loadLeaveManagers } from "@/lib/leaveData";
import {
  BIRTHDAY_RECOGNITION_CATEGORY,
  recognitionCategoryLabel,
  recognitionMonthRange,
} from "@/lib/recognitions";
import {
  birthdayCountdownLabel,
  defaultBirthdayWish,
  formatBirthdayShort,
  formatBirthdayWithWeekday,
  upcomingBirthdays,
} from "@/lib/birthdays";
import { minuteToTime, vnMinuteOfDay } from "@/lib/meetingCalendar";
import {
  ARCHIVED_PROJECT_STATUS_KEYS,
  projectStatusColor,
} from "@/lib/types";
import Sidebar from "@/components/Sidebar";
import Avatar from "@/components/Avatar";
import TaskListItem from "@/components/TaskListItem";
import BirthdayWishButton from "@/components/BirthdayWishButton";
import Confetti from "@/components/Confetti";
import { handwriting } from "@/app/fonts";

const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const PROJECT_STATUS_ORDER: Record<string, number> = { ON_PROCESS: 0, BIDDING: 1 };

const UPCOMING_BIRTHDAY_LIMIT = 6;

/** Độ trễ cho hiệu ứng .tf-rise để các khung hiện lần lượt. */
function riseDelay(ms: number) {
  return { "--tf-delay": `${ms}ms` } as CSSProperties;
}

function greetingFor(now: Date) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(now)
  );
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 13) return "Chào buổi trưa";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

function givenName(fullName: string) {
  return fullName.trim().split(/\s+/).at(-1) ?? fullName;
}

function StatLink({
  href,
  value,
  label,
  tone = "text-brand-700",
  pulse = false,
}: {
  href: string;
  value: string | number;
  label: string;
  tone?: string;
  pulse?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="group min-w-[104px] rounded-[14px] border border-zinc-200 bg-white px-4 py-3 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-sm"
    >
      <span
        className={`block text-2xl font-bold leading-7 tabular-nums transition-transform duration-200 group-hover:scale-105 ${tone} ${
          pulse ? "animate-pulse" : ""
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-zinc-600 transition-colors group-hover:text-zinc-900">{label}</span>
    </Link>
  );
}

function QuickAction({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="tf-quick-action flex items-center gap-3 rounded-[12px] border border-transparent bg-brand-50 px-3 py-2.5 text-sm font-semibold text-zinc-800 hover:border-brand-300 hover:bg-white"
    >
      <span className="tf-quick-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-400 text-zinc-950">
        <Icon size={17} strokeWidth={2} aria-hidden="true" />
      </span>
      {label}
    </Link>
  );
}

function Card({
  title,
  icon: Icon,
  action,
  children,
  labelledBy,
  delay = 0,
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  labelledBy: string;
  /** Độ trễ (ms) để khung hiện sau các khung phía trên. */
  delay?: number;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="tf-rise rounded-[16px] border border-zinc-200 bg-white p-5"
      style={riseDelay(delay)}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id={labelledBy}
          className="flex items-center gap-2 text-[15px] font-semibold text-zinc-950"
        >
          {Icon && <Icon size={18} className="shrink-0 text-brand-600" aria-hidden="true" />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} prefetch={false} className="text-[13px] font-medium text-brand-700 hover:text-brand-800">
      {children}
    </Link>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; view?: string }>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);

  // Trang Công việc cũ nằm ở "/": giữ link cũ (?view=, ?sort=) chạy được.
  if (params.view || params.sort) {
    const next = new URLSearchParams();
    if (params.view) next.set("view", params.view);
    if (params.sort) next.set("sort", params.sort);
    redirect(`/tasks?${next.toString()}`);
  }

  const now = new Date();
  const today = todayInVietnam(now);
  const dayStart = new Date(today.getTime() - VN_OFFSET_MS);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const year = today.getUTCFullYear();
  const showMeetings = meetingsEnabled();
  const month = recognitionMonthRange();
  const openTaskProject = {
    status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] },
    members: { some: { userId: user.id } },
  };
  const taskInclude = {
    project: { select: { id: true, name: true, status: true } },
    assignee: { select: { name: true } },
    creator: { select: { name: true } },
  } as const;

  const [
    me,
    projects,
    assignedToMe,
    delegatedByMe,
    meetingsToday,
    myLeaveRequests,
    monthRecognitions,
    latestRecognitions,
    leaveManagers,
    birthdayPeople,
    unreadNotifications,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        annualLeaveDays: true,
        birthday: true,
        leaveAdjustments: { where: { year }, select: { adjustmentDays: true } },
      },
    }),
    prisma.project.findMany({
      where: {
        members: { some: { userId: user.id } },
        status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] },
      },
      select: {
        id: true,
        name: true,
        status: true,
        _count: { select: { tasks: true } },
        tasks: { where: { status: "DONE" }, select: { id: true } },
      },
    }),
    prisma.task.findMany({
      where: { assigneeId: user.id, status: { not: "DONE" }, project: openTaskProject },
      include: taskInclude,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
    }),
    prisma.task.findMany({
      where: {
        creatorId: user.id,
        status: { not: "DONE" },
        assigneeId: { not: null },
        NOT: { assigneeId: user.id },
        dueDate: { not: null, lt: new Date(dayStart.getTime() + 4 * DAY_MS) },
        project: openTaskProject,
      },
      include: taskInclude,
      orderBy: [{ dueDate: "asc" }],
      take: 4,
    }),
    showMeetings
      ? prisma.meeting.findMany({
          where: {
            status: "SCHEDULED",
            startAt: { gte: dayStart, lt: dayEnd },
            OR: [{ organizerId: user.id }, { attendees: { some: { userId: user.id } } }],
          },
          select: {
            id: true,
            title: true,
            startAt: true,
            endAt: true,
            room: { select: { name: true } },
          },
          orderBy: { startAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.leaveRequest.findMany({
      where: {
        userId: user.id,
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      select: { type: true, status: true, days: true },
    }),
    prisma.recognition.findMany({
      where: {
        createdAt: { gte: month.start, lt: month.end },
        category: { not: BIRTHDAY_RECOGNITION_CATEGORY },
      },
      select: { senderId: true, recipientId: true },
    }),
    prisma.recognition.findMany({
      where: {
        OR: [
          { visibility: "COMPANY" },
          { senderId: user.id },
          { recipientId: user.id },
        ],
      },
      include: {
        sender: { select: { name: true } },
        recipient: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    loadLeaveManagers(),
    prisma.user.findMany({
      where: { isActive: true, deletedAt: null, birthday: { not: null } },
      select: { id: true, name: true, avatarUrl: true, birthday: true },
    }),
    prisma.notification.count({ where: { userId: user.id, read: false } }),
  ]);

  // Sinh nhật: ai có sinh nhật hôm nay và trong 30 ngày tới (chỉ ngày/tháng).
  const birthdays = upcomingBirthdays(birthdayPeople, now);
  const birthdaysToday = birthdays.filter((person) => person.daysUntil === 0);
  const todayWishes =
    birthdaysToday.length > 0
      ? await prisma.recognition.findMany({
          where: {
            category: BIRTHDAY_RECOGNITION_CATEGORY,
            recipientId: { in: birthdaysToday.map((person) => person.id) },
            createdAt: { gte: dayStart },
          },
          select: {
            recipientId: true,
            sender: { select: { id: true, name: true, avatarUrl: true } },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];
  const wishesFor = (recipientId: string) =>
    todayWishes.filter((wish) => wish.recipientId === recipientId);
  const hasWished = (recipientId: string) =>
    todayWishes.some(
      (wish) => wish.recipientId === recipientId && wish.sender.id === user.id
    );

  // Lịch nghỉ của người khác: chỉ quản lý nghỉ phép/Admin thấy cả công ty,
  // quản lý trực tiếp thấy nhân viên của mình — giống trang Nghỉ phép.
  const seesEveryone =
    user.role === "ADMIN" || leaveManagers.some((manager) => manager.id === user.id);
  const absentToday = await prisma.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      startDate: { lte: today },
      endDate: { gte: today },
      userId: { not: user.id },
      ...(seesEveryone ? {} : { user: { managerId: user.id } }),
    },
    select: {
      id: true,
      halfDay: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
    orderBy: { startDate: "asc" },
    take: 8,
  });

  // Ngôi sao tháng: người được nhiều đồng nghiệp khác nhau cảm ơn nhất trong tháng.
  const thankers = new Map<string, Set<string>>();
  for (const recognition of monthRecognitions) {
    const senders = thankers.get(recognition.recipientId) ?? new Set<string>();
    senders.add(recognition.senderId);
    thankers.set(recognition.recipientId, senders);
  }
  const [starId, starSenders] =
    [...thankers.entries()].sort((a, b) => b[1].size - a[1].size)[0] ?? [];
  const star = starId
    ? await prisma.user.findUnique({
        where: { id: starId },
        select: { id: true, name: true, avatarUrl: true },
      })
    : null;

  const urgentTasks = assignedToMe.filter(
    (task) => task.dueDate && (isOverdue(task.dueDate) || daysUntil(task.dueDate) <= 3)
  );
  const leave = summarizeLeave(
    myLeaveRequests,
    me.annualLeaveDays,
    me.leaveAdjustments[0]?.adjustmentDays ?? 0
  );
  const runningProjects = [...projects].sort(
    (a, b) =>
      (PROJECT_STATUS_ORDER[a.status] ?? 9) - (PROJECT_STATUS_ORDER[b.status] ?? 9) ||
      a.name.localeCompare(b.name, "vi", { sensitivity: "base" })
  );
  const quote = getDailyInspiration(user.id, now).quote;
  const dateLabel = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(now);
  const monthLabel = Number(month.key.split("-")[1]);
  const usedPercent =
    leave.quota > 0 ? Math.min(100, Math.round((leave.used / leave.quota) * 100)) : 0;

  return (
    <div className="tf-shell">
      <Sidebar user={user} activeSection="home" />

      <main className="tf-main bg-zinc-50">
        <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-6 sm:px-8 lg:px-10">
          {/* Khung ngoài vẽ viền có ánh sáng chạy vòng (.tf-glow-border). */}
          <div className="tf-rise tf-glow-border rounded-[20px]">
            <section
              aria-labelledby="greeting-heading"
              className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-4 overflow-hidden rounded-[18px] bg-white px-6 py-6 sm:px-7"
            >
              <span className="pointer-events-none absolute -right-12 -top-24 h-56 w-56 tf-float-a rounded-full bg-brand-50" aria-hidden="true" />
              <span className="pointer-events-none absolute -bottom-20 right-56 h-32 w-32 tf-float-b rounded-full bg-brand-100" aria-hidden="true" />
              {/* Chuông thông báo ở góc phải khung chào. Màn hình nhỏ đã có chuông
                  ở thanh trên cùng nên ẩn đi để không lặp. */}
              <Link
                href="/notifications"
                prefetch={false}
                aria-label={
                  unreadNotifications > 0
                    ? `Thông báo (${unreadNotifications} chưa đọc)`
                    : "Thông báo"
                }
                title="Thông báo"
                className={`group absolute right-5 top-5 z-10 hidden h-10 w-10 items-center justify-center rounded-full border border-brand-200 bg-white text-brand-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 md:flex ${
                  unreadNotifications > 0 ? "tf-bell-shake" : ""
                }`}
              >
                <Bell size={19} strokeWidth={1.9} className="transition-transform duration-200 group-hover:rotate-12" aria-hidden="true" />
                {unreadNotifications > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full border-2 border-white bg-red-500 px-1 text-center text-[10px] font-bold leading-[14px] text-white animate-pulse">
                    {unreadNotifications > 99 ? "99+" : unreadNotifications}
                  </span>
                )}
              </Link>
              <div className="relative min-w-0 flex-[1_1_360px]">
                <Image
                  src="/creative-station-logo.png"
                  width={1914}
                  height={370}
                  alt="Creative Station"
                  // Màn hình nhỏ đã có logo ở thanh trên cùng.
                  className="hidden h-[30px] w-auto md:block"
                  priority
                />
                <p className="text-[13px] md:mt-3 text-zinc-600 first-letter:uppercase">{dateLabel}</p>
                <h1
                  id="greeting-heading"
                  className={`${handwriting.className} tf-handwrite text-[38px] leading-[48px] text-brand-800 sm:text-[46px] sm:leading-[56px]`}
                >
                  {greetingFor(now)}, {givenName(user.name)}!
                </h1>
                <p className="mt-1.5 text-sm italic leading-6 text-zinc-700">&ldquo;{quote}&rdquo;</p>
              </div>
              <div className="relative flex flex-wrap gap-2.5 md:mr-14">
                <StatLink
                  href="/tasks"
                  value={urgentTasks.length}
                  label="Việc gấp"
                  tone={urgentTasks.length === 0 ? "text-brand-700" : "text-red-600"}
                  pulse={urgentTasks.length > 0}
                />
                {showMeetings && (
                  <StatLink href="/meetings?view=mine" value={meetingsToday.length} label="Họp hôm nay" />
                )}
                <StatLink href="/leave" value={formatLeaveDays(leave.remaining)} label="Ngày phép còn" />
              </div>
            </section>
          </div>

          {birthdaysToday.slice(0, 3).map((person) => {
            const wishes = wishesFor(person.id);
            const isMe = person.id === user.id;
            return (
              <section
                key={person.id}
                aria-label={`Sinh nhật ${person.name}`}
                className="tf-rise relative flex flex-wrap items-center gap-x-5 gap-y-3.5 overflow-hidden rounded-[18px] border-[1.5px] border-brand-300 bg-brand-50 px-5 py-4"
                style={riseDelay(80)}
              >
                <Confetti />
                <span className="tf-wiggle relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[14px] bg-brand-400 text-zinc-950">
                  <Cake size={26} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="relative min-w-0 flex-[1_1_300px]">
                  <h2 className="text-[17px] font-bold text-zinc-950">
                    {isMe ? (
                      <>Chúc mừng sinh nhật bạn, <span className="text-brand-800">{givenName(person.name)}</span>!</>
                    ) : (
                      <>Hôm nay là sinh nhật của <span className="text-brand-800">{person.name}</span>!</>
                    )}
                  </h2>
                  <p className="mt-0.5 text-[13px] text-zinc-700">
                    {isMe
                      ? wishes.length > 0
                        ? `${wishes.length} người đã gửi lời chúc đến bạn. Chúc bạn một ngày thật vui!`
                        : "Cả nhà Creative Station chúc bạn một ngày thật vui!"
                      : wishes.length > 0
                        ? `Cả nhà cùng gửi một lời chúc nhé · ${wishes.length} người đã chúc mừng`
                        : "Cả nhà cùng gửi một lời chúc nhé"}
                  </p>
                </div>
                <div className="relative flex items-center gap-3">
                  {wishes.length > 0 && (
                    <span className="flex" aria-hidden="true">
                      {wishes.slice(0, 3).map((wish, index) => (
                        <Avatar
                          key={wish.sender.id}
                          id={wish.sender.id}
                          name={wish.sender.name}
                          avatarUrl={wish.sender.avatarUrl}
                          className={`h-[30px] w-[30px] border-2 border-brand-50 text-[10px] ${index > 0 ? "-ml-2" : ""}`}
                        />
                      ))}
                      {wishes.length > 3 && (
                        <span className="-ml-2 flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-brand-50 bg-brand-500 text-[10px] font-bold text-zinc-950">
                          +{wishes.length - 3}
                        </span>
                      )}
                    </span>
                  )}
                  {!isMe && (
                    <BirthdayWishButton
                      recipientId={person.id}
                      recipientName={person.name}
                      defaultMessage={defaultBirthdayWish(givenName(person.name))}
                      alreadyWished={hasWished(person.id)}
                    />
                  )}
                </div>
              </section>
            );
          })}

          <nav
            aria-label="Truy cập nhanh"
            className="tf-rise rounded-[16px] border border-zinc-200 bg-white p-4"
            style={riseDelay(140)}
          >
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-600">Truy cập nhanh</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <QuickAction href="/tasks" label="Việc của tôi" icon={CheckCircle2} />
              {canCreateProjects(user.role) && (
                <QuickAction href="/projects/new" label="Tạo dự án" icon={Plus} />
              )}
              {showMeetings && (
                <QuickAction href="/meetings" label="Đặt phòng họp" icon={CalendarClock} />
              )}
              <QuickAction href="/leave" label="Xin nghỉ phép" icon={Plane} />
              <QuickAction href="/recognition" label="Gửi cảm ơn" icon={Heart} />
              <QuickAction href="/documents" label="Tài liệu" icon={FolderOpen} />
            </div>
          </nav>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5">
              <Card
                title="Việc cần chú ý"
                icon={CheckCircle2}
                labelledBy="attention-heading"
                delay={200}
                action={<CardLink href="/tasks">Mở Công việc →</CardLink>}
              >
                {urgentTasks.length > 0 ? (
                  <div>
                    {urgentTasks.slice(0, 5).map((task) => (
                      <TaskListItem
                        key={task.id}
                        task={{ ...task, personLabel: `${task.creator.name} giao` }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="flex items-center gap-2.5 rounded-[10px] bg-brand-50 px-3.5 py-3 text-sm text-brand-800">
                    <span className="tf-pop-in flex shrink-0 items-center justify-center">
                      <CheckCheck size={17} aria-hidden="true" />
                    </span>
                    Bạn không có việc gấp hôm nay, cứ thong thả nhé.
                  </p>
                )}
                {delegatedByMe.length > 0 && (
                  <>
                    <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                      Việc bạn đã giao · sắp đến hạn
                    </h3>
                    {delegatedByMe.map((task) => (
                      <TaskListItem
                        key={task.id}
                        task={{
                          ...task,
                          personLabel: task.assignee ? `${task.assignee.name} làm` : undefined,
                        }}
                      />
                    ))}
                  </>
                )}
              </Card>

              <Card
                title="Kudos Wall"
                icon={Heart}
                labelledBy="thanks-heading"
                delay={280}
                action={<CardLink href="/recognition">Xem tất cả →</CardLink>}
              >
                <div className="flex flex-wrap gap-4">
                  <div className="flex flex-[1_1_200px] flex-col items-center gap-1.5 rounded-[14px] border border-brand-200 bg-brand-50 p-4 text-center">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-800">
                      <Star size={12} fill="currentColor" className="tf-star-twinkle text-brand-600" aria-hidden="true" />
                      Ngôi sao tháng {monthLabel}
                    </span>
                    {star ? (
                      <>
                        <Avatar
                          id={star.id}
                          name={star.name}
                          avatarUrl={star.avatarUrl}
                          className="mt-1 h-14 w-14 text-base ring-[3px] ring-brand-400 ring-offset-2 transition-transform duration-200 hover:scale-105"
                        />
                        <b className="text-[15px] text-zinc-950">{star.name}</b>
                        <span className="text-xs text-brand-800">
                          Được {starSenders?.size ?? 0} đồng nghiệp cảm ơn
                        </span>
                      </>
                    ) : (
                      <span className="mt-2 text-sm text-brand-800">
                        Chưa có ai trong tháng này. Hãy là người gửi lời cảm ơn đầu tiên!
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-[2_1_300px]">
                    {latestRecognitions.length > 0 ? (
                      latestRecognitions.map((recognition) => (
                        <Link
                          key={recognition.id}
                          href={`/recognition?focus=${recognition.id}`}
                          prefetch={false}
                          className="group flex gap-3 -mx-2 rounded-[10px] px-2 py-2 border-b border-zinc-100 last:border-b-0 transition-colors hover:bg-zinc-50"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 transition-transform duration-200 group-hover:scale-110">
                            {recognition.category === BIRTHDAY_RECOGNITION_CATEGORY ? (
                              <Cake size={14} aria-hidden="true" />
                            ) : (
                              <Heart size={14} aria-hidden="true" />
                            )}
                          </span>
                          <span className="min-w-0 text-[13px]">
                            <span className="text-zinc-800">
                              <b>{recognition.sender.name}</b>{" "}
                              {recognition.category === BIRTHDAY_RECOGNITION_CATEGORY ? "chúc mừng" : "cảm ơn"}{" "}
                              <b>{recognition.recipient.name}</b>
                            </span>{" "}
                            <span className="whitespace-nowrap rounded-[5px] bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-800">
                              {recognitionCategoryLabel(recognition.category)}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-zinc-700">
                              &ldquo;{recognition.message}&rdquo;
                            </span>
                          </span>
                        </Link>
                      ))
                    ) : (
                      <p className="py-3 text-sm text-zinc-600">Chưa có lời cảm ơn nào.</p>
                    )}
                    <Link
                      href="/recognition"
                      prefetch={false}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-400 px-3.5 py-1.5 text-[13px] font-semibold text-zinc-950 hover:bg-brand-300"
                    >
                      <Heart size={14} aria-hidden="true" />
                      Gửi lời cảm ơn
                    </Link>
                  </div>
                </div>
              </Card>
            </div>

            <aside aria-label="Thông tin của tôi" className="min-w-0 space-y-4">
              <Card title="Sinh nhật sắp tới" icon={Cake} labelledBy="birthdays-heading" delay={220}>
                {birthdays.length > 0 ? (
                  <ul>
                    {birthdays.slice(0, UPCOMING_BIRTHDAY_LIMIT).map((person) => {
                      const isToday = person.daysUntil === 0;
                      return (
                        <li
                          key={person.id}
                          className={
                            isToday
                              ? "-mx-2.5 flex items-center gap-2.5 rounded-[10px] bg-brand-50 px-2.5 py-2"
                              : "flex items-center gap-2.5 border-b border-zinc-100 py-2 last:border-b-0"
                          }
                        >
                          <Avatar
                            id={person.id}
                            name={person.name}
                            avatarUrl={person.avatarUrl}
                            className={`h-[34px] w-[34px] text-[11px] ${isToday ? "ring-2 ring-brand-400" : ""}`}
                          />
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-[13px] text-zinc-950">
                              {person.name}
                              {person.id === user.id && " (bạn)"}
                            </b>
                            <span
                              className={
                                isToday
                                  ? "text-xs font-semibold text-brand-800"
                                  : "text-xs text-zinc-600"
                              }
                            >
                              {isToday
                                ? `Hôm nay · ${formatBirthdayShort(person.nextDate)}`
                                : formatBirthdayWithWeekday(person.nextDate)}
                            </span>
                          </span>
                          {isToday && person.id !== user.id ? (
                            <BirthdayWishButton
                              size="sm"
                              recipientId={person.id}
                              recipientName={person.name}
                              defaultMessage={defaultBirthdayWish(givenName(person.name))}
                              alreadyWished={hasWished(person.id)}
                            />
                          ) : (
                            !isToday && (
                              <span className="shrink-0 text-xs font-semibold text-brand-700">
                                {birthdayCountdownLabel(person.daysUntil)}
                              </span>
                            )
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[13px] text-zinc-600">
                    Chưa có sinh nhật nào trong 30 ngày tới.
                  </p>
                )}
                {!me.birthday && (
                  <Link
                    href="/profile"
                    prefetch={false}
                    className="mt-3 flex items-center gap-2 rounded-[10px] border border-dashed border-brand-300 px-3 py-2 text-xs font-medium text-brand-800 hover:bg-brand-50"
                  >
                    <Cake size={14} aria-hidden="true" />
                    Thêm ngày sinh của bạn để cả nhà cùng chúc mừng
                  </Link>
                )}
              </Card>

              {showMeetings && (
                <Card title="Lịch họp hôm nay" icon={CalendarClock} labelledBy="meetings-heading" delay={280}>
                  {meetingsToday.length > 0 ? (
                    <ul className="mb-3 space-y-1">
                      {meetingsToday.slice(0, 4).map((meeting) => (
                        <li key={meeting.id}>
                          <Link
                            href={`/meetings?view=mine&focus=${meeting.id}`}
                            prefetch={false}
                            className="group flex gap-3 rounded-[8px] px-1.5 py-1.5 transition-all duration-150 hover:bg-zinc-50 hover:translate-x-1"
                          >
                            <span className="w-12 shrink-0 text-[13px] font-semibold tabular-nums text-brand-700">
                              {minuteToTime(vnMinuteOfDay(meeting.startAt))}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium text-zinc-900 transition-colors group-hover:text-brand-800">{meeting.title}</span>
                              {meeting.room && (
                                <span className="block truncate text-xs text-zinc-600">{meeting.room.name}</span>
                              )}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-3 text-[13px] text-zinc-600">Không có lịch họp hôm nay.</p>
                  )}
                  <Link
                    href="/meetings"
                    prefetch={false}
                    className="flex h-9 items-center justify-center rounded-[10px] bg-brand-700 text-[13px] font-semibold text-white transition-all duration-150 hover:bg-brand-800 hover:shadow-sm"
                  >
                    Đặt phòng họp
                  </Link>
                </Card>
              )}

              <Card title="Nghỉ phép của bạn" icon={Plane} labelledBy="leave-heading" delay={340}>
                <div className="flex justify-between text-[13px]">
                  <b>Phép năm {year}</b>
                  <span className="text-zinc-600">
                    Đã dùng {formatLeaveDays(leave.used)}/{formatLeaveDays(leave.quota)} ngày
                  </span>
                </div>
                <div
                  className="mb-3.5 mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100"
                  role="img"
                  aria-label={`Đã dùng ${formatLeaveDays(leave.used)} trên ${formatLeaveDays(leave.quota)} ngày phép`}
                >
                  <div
                    className="tf-progress-fill h-full rounded-full bg-brand-500"
                    style={{ "--tf-progress-width": `${usedPercent}%` } as CSSProperties}
                  />
                </div>
                <Link
                  href="/leave"
                  prefetch={false}
                  className="flex h-9 items-center justify-center rounded-[10px] border-[1.5px] border-brand-500 text-[13px] font-semibold text-brand-800 transition-all duration-150 hover:bg-brand-50 hover:shadow-sm"
                >
                  Xin nghỉ phép
                </Link>
              </Card>

              {absentToday.length > 0 && (
                <Card title="Hôm nay vắng mặt" icon={UserRoundX} labelledBy="absent-heading" delay={400}>
                  <ul className="space-y-1.5">
                    {absentToday.map((request) => (
                      <li key={request.id} className="flex items-center gap-2.5">
                        <Avatar
                          id={request.user.id}
                          name={request.user.name}
                          avatarUrl={request.user.avatarUrl}
                          className="h-7 w-7 text-[11px]"
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px]">{request.user.name}</span>
                        <span className="text-xs text-zinc-600">
                          {request.halfDay === "AM"
                            ? "Nghỉ buổi sáng"
                            : request.halfDay === "PM"
                              ? "Nghỉ buổi chiều"
                              : "Nghỉ cả ngày"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card
                title={`Dự án đang chạy · ${runningProjects.length}`}
                icon={BriefcaseBusiness}
                labelledBy="projects-heading"
                delay={400}
                action={<CardLink href="/projects">Tất cả</CardLink>}
              >
                {runningProjects.length > 0 ? (
                  <ul>
                    {runningProjects.slice(0, 6).map((project) => (
                      <li key={project.id}>
                        <Link
                          href={`/projects/${project.id}`}
                          prefetch={false}
                          className="group flex items-center gap-2.5 border-b border-zinc-100 px-1 py-2 text-[13px] last:border-b-0 hover:text-brand-700 transition-all duration-150 hover:translate-x-1"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full transition-transform duration-150 group-hover:scale-125"
                            style={{ backgroundColor: projectStatusColor(project.status) }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                          <span className="text-xs tabular-nums text-zinc-600 group-hover:text-brand-700">
                            {project.tasks.length}/{project._count.tasks}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-2 text-[13px] text-zinc-600">
                    <BriefcaseBusiness size={15} aria-hidden="true" />
                    Bạn chưa tham gia dự án nào đang chạy.
                  </p>
                )}
              </Card>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
