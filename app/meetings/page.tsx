import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { CalendarClock, DoorOpen, FileText, NotebookPen, Video } from "lucide-react";
import Avatar from "@/components/Avatar";
import {
  CancelMeetingButton,
  MeetingResponseButtons,
} from "@/components/MeetingActions";
import MeetingComposer from "@/components/MeetingComposer";
import RoomCalendar, { type CalendarMeeting } from "@/components/RoomCalendar";
import Sidebar from "@/components/Sidebar";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { meetingRecapsEnabled, meetingsEnabled } from "@/lib/features";
import { formatHour, toDateInputVN } from "@/lib/dates";
import { formatMeetingDay, meetingResponseLabel } from "@/lib/meetings";
import { calendarWeekRange, resolveCalendarWeek } from "@/lib/meetingCalendar";
import { canManageMeetingRecap, meetingRecorderId } from "@/lib/meetingRecap";
import { loadMeetingComposerData, type MeetingComposerData } from "@/lib/meetingComposerData";
import { prisma } from "@/lib/prisma";

type MeetingView = "rooms" | "mine" | "past";

const PAST_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

const meetingInclude = {
  room: { select: { id: true, name: true } },
  organizer: { select: { id: true, name: true, avatarUrl: true } },
  attendees: {
    select: {
      userId: true,
      response: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  recap: { select: { status: true, sentAt: true } },
} satisfies Prisma.MeetingInclude;

type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof meetingInclude }>;

const RESPONSE_STYLES: Record<string, string> = {
  PENDING: "bg-zinc-100 text-zinc-600",
  ACCEPTED: "bg-brand-50 text-brand-800",
  DECLINED: "bg-red-50 text-red-700",
};

const RESPONSE_RING: Record<string, string> = {
  PENDING: "ring-zinc-200",
  ACCEPTED: "ring-brand-400",
  DECLINED: "ring-red-300",
};

/** Nút mở trang biên bản: người tổ chức/admin thấy trạng thái, người tham dự chỉ thấy khi đã gửi. */
function recapLink(meeting: MeetingRow, canManage: boolean, recapsEnabled: boolean): string | null {
  if (meeting.status === "CANCELLED") return null;
  const recap = meeting.recap;
  if (!canManage) return recap?.sentAt ? "Biên bản" : null;
  // Người tổ chức/admin thấy nút ngay từ tab "Lịch của tôi"; bắt đầu ghi được cả trước giờ họp.
  if (!recap) return recapsEnabled ? "Tạo biên bản" : null;
  if (recap.status === "PROCESSING") return "Biên bản: đang xử lý";
  if (recap.status === "FAILED") return "Biên bản: lỗi";
  return recap.sentAt ? "Biên bản" : "Biên bản: chờ gửi";
}

function MeetingCard({
  meeting,
  viewer,
  focused,
  now,
  composerProps,
  recapsEnabled,
}: {
  meeting: MeetingRow;
  viewer: { id: string; role: string };
  focused: boolean;
  now: Date;
  composerProps: MeetingComposerData;
  recapsEnabled: boolean;
}) {
  const isOrganizer = meeting.organizerId === viewer.id;
  const myInvite = meeting.attendees.find((attendee) => attendee.userId === viewer.id);
  const isParticipant = isOrganizer || Boolean(myInvite);
  const canManage = isOrganizer || viewer.role === "ADMIN";
  // Người ghi biên bản (mặc định là người tổ chức) cũng được tạo/gửi biên bản.
  const canRecap = canManageMeetingRecap(meeting, viewer);
  const recorderId = meetingRecorderId(meeting);
  const recorderName =
    recorderId === meeting.organizerId
      ? meeting.organizer.name
      : meeting.attendees.find((attendee) => attendee.userId === recorderId)?.user.name;
  const cancelled = meeting.status === "CANCELLED";
  const ended = meeting.endAt.getTime() < now.getTime();
  const ongoing = !cancelled && !ended && meeting.startAt.getTime() <= now.getTime();
  const open = !cancelled && !ended;
  // Sửa giờ họp đã bắt đầu sẽ bị chặn (không đặt lịch về quá khứ), nên chỉ cho sửa trước giờ họp.
  const editable = open && !ongoing && canManage;
  const accepted = meeting.attendees.filter((attendee) => attendee.response === "ACCEPTED").length;
  const recapLabel = isParticipant || canRecap ? recapLink(meeting, canRecap, recapsEnabled) : null;

  return (
    <article
      id={`meeting-${meeting.id}`}
      className={`grid gap-4 border-b border-zinc-200 py-5 last:border-b-0 sm:grid-cols-[112px_minmax(0,1fr)] ${
        focused ? "-mx-3 rounded-[8px] bg-brand-50/65 px-3 ring-2 ring-brand-200" : ""
      }`}
    >
      <div className="flex items-baseline gap-2 sm:block">
        <p
          className={`text-lg font-semibold tabular-nums leading-tight ${
            cancelled ? "text-zinc-400 line-through" : "text-zinc-900"
          }`}
        >
          {formatHour(meeting.startAt)}
        </p>
        <p className="text-xs tabular-nums text-zinc-500">đến {formatHour(meeting.endAt)}</p>
        {ongoing && (
          <span className="tf-badge mt-0 bg-emerald-50 text-emerald-700 sm:mt-2">Đang diễn ra</span>
        )}
        {cancelled && <span className="tf-badge mt-0 bg-zinc-100 text-zinc-500 sm:mt-2">Đã huỷ</span>}
      </div>

      <div className="min-w-0">
        <h3
          className={`text-[15px] font-semibold leading-6 ${
            cancelled ? "text-zinc-400 line-through" : "text-zinc-900"
          }`}
        >
          {meeting.title}
        </h3>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <DoorOpen size={14} aria-hidden="true" />
            {meeting.room?.name ?? "Không dùng phòng"}
          </span>
          {meeting.meetingUrl && isParticipant && !cancelled && (
            <a
              href={meeting.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline"
            >
              <Video size={14} aria-hidden="true" />
              Vào họp online
            </a>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Avatar
              id={meeting.organizer.id}
              name={meeting.organizer.name}
              avatarUrl={meeting.organizer.avatarUrl}
              className="h-5 w-5 text-[10px]"
            />
            {isOrganizer ? "Bạn tổ chức" : `${meeting.organizer.name} tổ chức`}
          </span>
          {recorderName && (
            <span className="inline-flex items-center gap-1.5">
              <NotebookPen size={14} aria-hidden="true" />
              {recorderId === viewer.id ? "Bạn ghi biên bản" : `${recorderName} ghi biên bản`}
            </span>
          )}
        </div>

        {meeting.description && isParticipant && (
          <p className="mt-2.5 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-zinc-600">
            {meeting.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <ul className="flex -space-x-1.5" aria-label="Người tham dự">
            {meeting.attendees.slice(0, 8).map((attendee) => (
              <li
                key={attendee.userId}
                title={`${attendee.user.name} · ${meetingResponseLabel(attendee.response)}`}
              >
                <Avatar
                  id={attendee.user.id}
                  name={attendee.user.name}
                  avatarUrl={attendee.user.avatarUrl}
                  className={`h-7 w-7 text-[11px] ring-2 ${RESPONSE_RING[attendee.response] ?? RESPONSE_RING.PENDING} ${
                    attendee.response === "DECLINED" ? "opacity-50" : ""
                  }`}
                />
              </li>
            ))}
          </ul>
          <span className="text-xs text-zinc-500">
            {meeting.attendees.length === 0
              ? "Không mời đồng nghiệp (họp với khách)"
              : `${meeting.attendees.length > 8 ? `+${meeting.attendees.length - 8} · ` : ""}${accepted}/${meeting.attendees.length} người đã nhận lời`}
          </span>
          {myInvite && !open && (
            <span className={`tf-badge ${RESPONSE_STYLES[myInvite.response] ?? RESPONSE_STYLES.PENDING}`}>
              Bạn: {meetingResponseLabel(myInvite.response)}
            </span>
          )}
          {recapLabel && !(open && canRecap) && (
            <Link
              href={`/meetings/${meeting.id}/recap`}
              prefetch={false}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
            >
              <FileText size={14} aria-hidden="true" />
              {recapLabel}
            </Link>
          )}
        </div>

        {open && (myInvite || canManage || canRecap) && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {myInvite && (
              <MeetingResponseButtons meetingId={meeting.id} response={myInvite.response} />
            )}
            {editable && (
              <MeetingComposer
                {...composerProps}
                organizerId={meeting.organizerId}
                meeting={{
                  id: meeting.id,
                  organizerId: meeting.organizerId,
                  title: meeting.title,
                  description: meeting.description ?? "",
                  startAt: meeting.startAt.toISOString(),
                  endAt: meeting.endAt.toISOString(),
                  roomId: meeting.roomId,
                  meetingUrl: meeting.meetingUrl ?? "",
                  attendeeIds: meeting.attendees.map((attendee) => attendee.userId),
                  recorderId: meeting.recorderId,
                }}
              />
            )}
            {recapLabel && canRecap && (
              <Link
                href={`/meetings/${meeting.id}/recap`}
                prefetch={false}
                title="Người ghi biên bản, người tổ chức hoặc quản trị viên tạo được biên bản"
                className="tf-button-secondary !min-h-9 !px-3 text-xs"
              >
                <FileText size={14} aria-hidden="true" />
                {recapLabel}
              </Link>
            )}
            {canManage && (
              <CancelMeetingButton
                meetingId={meeting.id}
                title={meeting.title}
                roomName={meeting.room?.name ?? null}
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; focus?: string; week?: string; room?: string }>;
}) {
  const user = await requireUser();
  // Tính năng đang tạm ẩn: link cũ (thông báo, email) đưa về trang chính.
  if (!meetingsEnabled()) redirect("/");
  const params = await searchParams;
  const now = new Date();
  const mineWhere: Prisma.MeetingWhereInput = {
    OR: [{ organizerId: user.id }, { attendees: { some: { userId: user.id } } }],
  };

  // Mặc định mở lịch phòng; link cũ "?view=all" (tab Toàn công ty đã bỏ) cũng về lịch phòng.
  let view: MeetingView =
    params.view === "mine" || params.view === "past" ? params.view : "rooms";
  // Mở từ thông báo/email: đưa tới đúng cuộc họp trong "Lịch của tôi" hoặc "Đã qua".
  if (params.focus && !params.view) {
    view = "mine";
    const focusedMeeting = await prisma.meeting.findFirst({
      where: { id: params.focus, ...mineWhere },
      select: { status: true, endAt: true },
    });
    if (
      focusedMeeting &&
      (focusedMeeting.status === "CANCELLED" || focusedMeeting.endAt.getTime() < now.getTime())
    ) {
      view = "past";
    }
  }

  const upcomingWhere: Prisma.MeetingWhereInput = {
    status: "SCHEDULED",
    endAt: { gte: now },
  };
  const pastWhere: Prisma.MeetingWhereInput = {
    AND: [
      mineWhere,
      { OR: [{ status: "CANCELLED" }, { endAt: { lt: now } }] },
      { startAt: { gte: new Date(now.getTime() - PAST_WINDOW_MS) } },
    ],
  };
  const listWhere: Prisma.MeetingWhereInput =
    view === "past"
      ? params.focus
        ? // Mở một cuộc họp cụ thể (từ lịch phòng, thông báo) thì vẫn hiện dù đã quá 60 ngày.
          { OR: [pastWhere, { AND: [mineWhere, { id: params.focus }] }] }
        : pastWhere
      : { ...upcomingWhere, ...mineWhere };

  const weekStart = resolveCalendarWeek(params.week, now);
  const week = calendarWeekRange(weekStart);
  const [meetings, weekMeetings, { composerProps, rooms }, sidebarProjects] = await Promise.all([
    view === "rooms"
      ? Promise.resolve([] as MeetingRow[])
      : prisma.meeting.findMany({
          where: listWhere,
          include: meetingInclude,
          orderBy: { startAt: view === "past" ? "desc" : "asc" },
          take: 100,
        }),
    view === "rooms"
      ? prisma.meeting.findMany({
          where: {
            status: "SCHEDULED",
            roomId: { not: null },
            startAt: { lt: week.end },
            endAt: { gt: week.start },
          },
          select: {
            id: true,
            roomId: true,
            title: true,
            startAt: true,
            endAt: true,
            meetingUrl: true,
            organizerId: true,
            organizer: { select: { name: true } },
            attendees: { select: { userId: true } },
          },
          orderBy: { startAt: "asc" },
          take: 500,
        })
      : Promise.resolve([]),
    loadMeetingComposerData(now),
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

  const days: { key: string; label: string; meetings: MeetingRow[] }[] = [];
  for (const meeting of meetings) {
    const key = toDateInputVN(meeting.startAt);
    const day = days.at(-1)?.key === key ? days.at(-1)! : null;
    if (day) day.meetings.push(meeting);
    else days.push({ key, label: formatMeetingDay(meeting.startAt, now), meetings: [meeting] });
  }

  const recapsEnabled = meetingRecapsEnabled();
  const calendarMeetings: CalendarMeeting[] = weekMeetings.map((meeting) => {
    const isMine =
      meeting.organizerId === user.id || meeting.attendees.some((attendee) => attendee.userId === user.id);
    return {
      id: meeting.id,
      roomId: meeting.roomId!,
      title: meeting.title,
      startAt: meeting.startAt.toISOString(),
      endAt: meeting.endAt.toISOString(),
      organizerName: meeting.organizer.name,
      attendeeCount: meeting.attendees.length,
      isMine,
      meetingUrl: isMine ? meeting.meetingUrl : null,
    };
  });

  const tabs: Array<{ key: MeetingView; label: string }> = [
    { key: "rooms", label: "Lịch phòng" },
    { key: "mine", label: "Lịch của tôi" },
    { key: "past", label: "Đã qua" },
  ];

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="meetings" />

      <main className="tf-main">
        <div className="tf-page !max-w-[1220px] space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
                  <CalendarClock size={20} aria-hidden="true" />
                </span>
                <h1 className="tf-page-title">Lịch họp</h1>
              </div>
              <p className="tf-page-subtitle">
                Xem phòng nào còn trống và bấm vào ô trống trên lịch để đặt họp.
              </p>
            </div>
            <MeetingComposer {...composerProps} organizerId={user.id} />
          </header>

          <section className="tf-panel overflow-hidden">
            <nav
              className="tf-scroll-tabs flex gap-1 border-b border-zinc-200 px-3"
              aria-label="Lọc lịch họp"
            >
              {tabs.map((tab) => (
                <Link
                  key={tab.key}
                  href={tab.key === "rooms" ? "/meetings" : `/meetings?view=${tab.key}`}
                  prefetch={false}
                  aria-current={view === tab.key ? "page" : undefined}
                  className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                    view === tab.key
                      ? "border-brand-500 text-zinc-950"
                      : "border-transparent text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>

            {view === "rooms" ? (
              <RoomCalendar
                key={weekStart}
                weekStart={weekStart}
                nowIso={now.toISOString()}
                rooms={rooms}
                meetings={calendarMeetings}
                initialRoomId={params.room ?? null}
                viewerId={user.id}
                composerProps={composerProps}
              />
            ) : days.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <CalendarClock size={25} aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-lg font-semibold text-zinc-800">
                  {view === "past" ? "Chưa có cuộc họp nào đã qua" : "Chưa có lịch họp sắp tới"}
                </h2>
                <p className="mt-1 max-w-sm text-sm leading-6 text-zinc-500">
                  {view === "past"
                    ? "Các cuộc họp đã kết thúc hoặc đã huỷ trong 60 ngày gần đây sẽ hiện ở đây."
                    : "Bấm “Đặt lịch họp” để chọn giờ, phòng và gửi lời mời."}
                </p>
              </div>
            ) : (
              days.map((day) => (
                <section key={day.key} aria-label={day.label}>
                  <h2 className="border-b border-zinc-100 bg-zinc-50/70 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {day.label}
                  </h2>
                  <div className="px-5">
                    {day.meetings.map((meeting) => (
                      <MeetingCard
                        key={meeting.id}
                        meeting={meeting}
                        viewer={user}
                        focused={params.focus === meeting.id}
                        now={now}
                        composerProps={composerProps}
                        recapsEnabled={recapsEnabled}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
