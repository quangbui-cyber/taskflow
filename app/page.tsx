import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BriefcaseBusiness,
  CalendarClock,
  CheckCheck,
  FileCheck2,
  FolderOpen,
  Heart,
  Plane,
  Plus,
  Star,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { canCreateProjects, requireUser } from "@/lib/auth";
import { daysUntil, isOverdue } from "@/lib/dates";
import { meetingsEnabled } from "@/lib/features";
import { getDailyInspiration } from "@/lib/daily-inspiration";
import { formatLeaveDays, summarizeLeave, todayInVietnam } from "@/lib/leave";
import { loadLeaveManagers } from "@/lib/leaveData";
import { recognitionCategoryLabel, recognitionMonthRange } from "@/lib/recognitions";
import { minuteToTime, vnMinuteOfDay } from "@/lib/meetingCalendar";
import {
  ARCHIVED_PROJECT_STATUS_KEYS,
  projectStatusColor,
} from "@/lib/types";
import Sidebar from "@/components/Sidebar";
import Avatar from "@/components/Avatar";
import TaskListItem from "@/components/TaskListItem";

const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const PROJECT_STATUS_ORDER: Record<string, number> = { ON_PROCESS: 0, BIDDING: 1 };

const CATEGORY_TONE: Record<string, string> = {
  SUPPORT: "bg-brand-100 text-brand-800",
  INSPIRATION: "bg-blue-100 text-blue-800",
  CARE: "bg-orange-100 text-orange-800",
  KINDNESS: "bg-violet-100 text-violet-800",
};

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
  tone = "text-zinc-950",
}: {
  href: string;
  value: string | number;
  label: string;
  tone?: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="min-w-[104px] rounded-[14px] border border-zinc-200 bg-white px-4 py-3 text-center transition-colors hover:border-brand-300"
    >
      <span className={`block text-2xl font-bold leading-7 tabular-nums ${tone}`}>{value}</span>
      <span className="text-xs text-zinc-600">{label}</span>
    </Link>
  );
}

function QuickAction({
  href,
  label,
  icon: Icon,
  tone,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="flex items-center gap-3 rounded-[12px] border border-transparent bg-zinc-50 px-3 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:border-zinc-200 hover:bg-white"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${tone}`}>
        <Icon size={17} strokeWidth={2} aria-hidden="true" />
      </span>
      {label}
    </Link>
  );
}

function Card({
  title,
  action,
  children,
  labelledBy,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  labelledBy: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="rounded-[16px] border border-zinc-200 bg-white p-5"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={labelledBy} className="text-[15px] font-semibold text-zinc-950">
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
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        annualLeaveDays: true,
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
      where: { createdAt: { gte: month.start, lt: month.end } },
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
  ]);

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
          <section
            aria-labelledby="greeting-heading"
            className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-4 overflow-hidden rounded-[20px] border border-zinc-200 bg-white px-6 py-6 sm:px-7"
          >
            <span className="pointer-events-none absolute -right-12 -top-24 h-56 w-56 rounded-full bg-brand-50" aria-hidden="true" />
            <span className="pointer-events-none absolute -bottom-20 right-56 h-32 w-32 rounded-full bg-amber-50" aria-hidden="true" />
            <div className="relative min-w-0 flex-[1_1_360px]">
              <p className="text-[13px] text-zinc-600 first-letter:uppercase">{dateLabel}</p>
              <h1 id="greeting-heading" className="mt-1 text-[26px] font-bold leading-8 text-zinc-950">
                {greetingFor(now)}, {givenName(user.name)}!
              </h1>
              <p className="mt-1.5 text-sm italic leading-6 text-zinc-700">&ldquo;{quote}&rdquo;</p>
            </div>
            <div className="relative flex flex-wrap gap-2.5">
              <StatLink
                href="/tasks"
                value={urgentTasks.length}
                label="Việc gấp"
                tone={urgentTasks.length === 0 ? "text-emerald-700" : "text-zinc-950"}
              />
              {showMeetings && (
                <StatLink href="/meetings?view=mine" value={meetingsToday.length} label="Họp hôm nay" />
              )}
              <StatLink href="/leave" value={formatLeaveDays(leave.remaining)} label="Ngày phép còn" />
            </div>
          </section>

          <nav aria-label="Truy cập nhanh" className="rounded-[16px] border border-zinc-200 bg-white p-4">
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-600">Truy cập nhanh</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {canCreateProjects(user.role) && (
                <QuickAction href="/projects/new" label="Tạo dự án" icon={Plus} tone="bg-brand-400 text-zinc-950" />
              )}
              {showMeetings && (
                <QuickAction href="/meetings" label="Đặt phòng họp" icon={CalendarClock} tone="bg-blue-500 text-white" />
              )}
              <QuickAction href="/leave" label="Xin nghỉ phép" icon={Plane} tone="bg-amber-400 text-zinc-950" />
              <QuickAction href="/recognition" label="Gửi cảm ơn" icon={Heart} tone="bg-pink-500 text-white" />
              <QuickAction href="/workflow" label="Hồ sơ trình duyệt" icon={FileCheck2} tone="bg-violet-500 text-white" />
              <QuickAction href="/documents" label="Tài liệu" icon={FolderOpen} tone="bg-zinc-600 text-white" />
            </div>
          </nav>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-5">
              <Card
                title="Việc cần chú ý"
                labelledBy="attention-heading"
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
                  <p className="flex items-center gap-2.5 rounded-[10px] bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
                    <CheckCheck size={17} aria-hidden="true" />
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
                title="Góc cảm ơn"
                labelledBy="thanks-heading"
                action={<CardLink href="/recognition">Xem tất cả →</CardLink>}
              >
                <div className="flex flex-wrap gap-4">
                  <div className="flex flex-[1_1_200px] flex-col items-center gap-1.5 rounded-[14px] border border-amber-200 bg-amber-50 p-4 text-center">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-900">
                      <Star size={12} fill="currentColor" aria-hidden="true" />
                      Ngôi sao tháng {monthLabel}
                    </span>
                    {star ? (
                      <>
                        <Avatar
                          id={star.id}
                          name={star.name}
                          avatarUrl={star.avatarUrl}
                          className="mt-1 h-14 w-14 text-base ring-2 ring-amber-400 ring-offset-2"
                        />
                        <b className="text-[15px] text-zinc-950">{star.name}</b>
                        <span className="text-xs text-amber-900">
                          Được {starSenders?.size ?? 0} đồng nghiệp cảm ơn
                        </span>
                      </>
                    ) : (
                      <span className="mt-2 text-sm text-amber-900">
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
                          className="flex gap-3 border-b border-zinc-100 py-2.5 last:border-b-0"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-50 text-pink-600">
                            <Heart size={14} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 text-[13px]">
                            <span className="text-zinc-800">
                              <b>{recognition.sender.name}</b> cảm ơn <b>{recognition.recipient.name}</b>
                            </span>{" "}
                            <span
                              className={`whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-[11px] font-semibold ${
                                CATEGORY_TONE[recognition.category] ?? CATEGORY_TONE.KINDNESS
                              }`}
                            >
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
              {showMeetings && (
                <Card title="Lịch họp hôm nay" labelledBy="meetings-heading">
                  {meetingsToday.length > 0 ? (
                    <ul className="mb-3 space-y-1">
                      {meetingsToday.slice(0, 4).map((meeting) => (
                        <li key={meeting.id}>
                          <Link
                            href={`/meetings?view=mine&focus=${meeting.id}`}
                            prefetch={false}
                            className="flex gap-3 rounded-[8px] py-1.5 hover:bg-zinc-50"
                          >
                            <span className="w-12 shrink-0 text-[13px] font-semibold tabular-nums text-blue-700">
                              {minuteToTime(vnMinuteOfDay(meeting.startAt))}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium text-zinc-900">{meeting.title}</span>
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
                    className="flex h-9 items-center justify-center rounded-[10px] bg-brand-700 text-[13px] font-semibold text-white hover:bg-brand-800"
                  >
                    Đặt phòng họp
                  </Link>
                </Card>
              )}

              <Card title="Nghỉ phép của bạn" labelledBy="leave-heading">
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
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${usedPercent}%` }} />
                </div>
                <Link
                  href="/leave"
                  prefetch={false}
                  className="flex h-9 items-center justify-center rounded-[10px] border-[1.5px] border-brand-500 text-[13px] font-semibold text-brand-800 hover:bg-brand-50"
                >
                  Xin nghỉ phép
                </Link>
              </Card>

              {absentToday.length > 0 && (
                <Card title="Hôm nay vắng mặt" labelledBy="absent-heading">
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
                labelledBy="projects-heading"
                action={<CardLink href="/projects">Tất cả</CardLink>}
              >
                {runningProjects.length > 0 ? (
                  <ul>
                    {runningProjects.slice(0, 6).map((project) => (
                      <li key={project.id}>
                        <Link
                          href={`/projects/${project.id}`}
                          prefetch={false}
                          className="flex items-center gap-2.5 border-b border-zinc-100 py-2 text-[13px] last:border-b-0 hover:text-brand-700"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: projectStatusColor(project.status) }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                          <span className="text-xs tabular-nums text-zinc-600">
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
