"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, DoorOpen, Plus, UserRound, UsersRound, Video, X } from "lucide-react";
import MeetingComposer, { type MeetingSlot } from "@/components/MeetingComposer";
import type { MeetingComposerData } from "@/lib/meetingComposerData";
import {
  addDaysToKey,
  formatWeekLabel,
  layoutOverlaps,
  minuteToTime,
  vnMinuteOfDay,
} from "@/lib/meetingCalendar";
import { toDateInputVN } from "@/lib/dates";
import { vnDateTimeToUtc } from "@/lib/meetings";

export type CalendarRoom = { id: string; name: string; capacity: number | null };
export type CalendarMeeting = {
  id: string;
  roomId: string;
  title: string;
  startAt: string;
  endAt: string;
  organizerName: string;
  attendeeCount: number;
  /** Người xem là người tổ chức hoặc được mời */
  isMine: boolean;
  /** Chỉ gửi cho người trong cuộc họp */
  meetingUrl: string | null;
};

// Mỗi phòng một màu, theo thứ tự tên phòng.
const ROOM_COLORS = [
  { solid: "#d9363e", soft: "#fdecec", ink: "#9b1f25" },
  { solid: "#1d6fd8", soft: "#e8f1fd", ink: "#0f4a99" },
  { solid: "#7c3aed", soft: "#f1eafe", ink: "#5b21b6" },
  { solid: "#0e8a7b", soft: "#e3f6f3", ink: "#0b5f55" },
  { solid: "#c2650a", soft: "#fdf0e3", ink: "#8a4706" },
];
const WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];
const WEEKDAYS_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const HOUR_PX = 60;
const DEFAULT_START = 7 * 60;
const DEFAULT_END = 20 * 60;
const SLOT_MIN = 30;

function dayKeyOf(iso: string) {
  // Ngày theo giờ VN của một thời điểm
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Tên ngắn cho khối họp hẹp: hai chữ cuối ("Huỳnh Thị Hồng Nhung" → "Hồng Nhung") */
function shortName(name: string) {
  const words = name.trim().split(/\s+/);
  return words.length > 2 ? words.slice(-2).join(" ") : name;
}

function shortDate(key: string) {
  const [, month, day] = key.split("-");
  return `${day}/${month}`;
}

export default function RoomCalendar({
  weekStart,
  nowIso,
  rooms,
  meetings,
  initialRoomId,
  viewerId,
  composerProps,
}: {
  /** Thứ Hai của tuần đang xem (yyyy-MM-dd, giờ VN) */
  weekStart: string;
  nowIso: string;
  rooms: CalendarRoom[];
  meetings: CalendarMeeting[];
  initialRoomId: string | null;
  viewerId: string;
  composerProps: MeetingComposerData;
}) {
  // "" = xem tất cả phòng; bấm một phòng để xem riêng, bấm lại phòng đó để về tất cả.
  const [roomId, setRoomId] = useState(
    rooms.some((room) => room.id === initialRoomId) ? initialRoomId! : ""
  );
  // Đồng hồ chạy theo phút để ô đã qua giờ, vạch giờ hiện tại và họp đã xong luôn đúng khi để trang mở lâu.
  const [nowMs, setNowMs] = useState(() => Date.parse(nowIso));
  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(tick);
  }, []);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const todayKey = toDateInputVN(now);
  const hasWeekendMeetings = meetings.some((meeting) => {
    const key = dayKeyOf(meeting.startAt);
    return key >= addDaysToKey(weekStart, 5);
  });
  const [showWeekend, setShowWeekend] = useState(hasWeekendMeetings);
  const dayCount = showWeekend ? 7 : 5;
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, index) => addDaysToKey(weekStart, index)),
    [dayCount, weekStart]
  );
  const todayIndex = days.indexOf(todayKey);
  const [mobileDay, setMobileDay] = useState(Math.max(todayIndex, 0));
  const [slot, setSlot] = useState<MeetingSlot | null>(null);
  const [selected, setSelected] = useState<{ meeting: CalendarMeeting; rect: DOMRect } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const colorOfRoom = (id: string) => {
    const index = rooms.findIndex((item) => item.id === id);
    return ROOM_COLORS[Math.max(index, 0) % ROOM_COLORS.length];
  };
  const room = rooms.find((item) => item.id === roomId) ?? null;
  const visibleRooms = room ? [room] : rooms;

  const roomMeetings = useMemo(
    () =>
      meetings
        // Chỉ hiện họp của phòng đang hoạt động (phòng đã ngưng dùng không còn nút và màu riêng).
        .filter((meeting) => rooms.some((item) => item.id === meeting.roomId))
        .filter((meeting) => !roomId || meeting.roomId === roomId)
        .map((meeting) => {
          const start = new Date(meeting.startAt);
          const end = new Date(meeting.endAt);
          const day = dayKeyOf(meeting.startAt);
          const startMin = vnMinuteOfDay(start);
          // Họp kéo qua nửa đêm thì cắt ở cuối ngày.
          const endMin = dayKeyOf(meeting.endAt) === day ? vnMinuteOfDay(end) : 24 * 60;
          return { ...meeting, day, startMin, endMin, done: end.getTime() <= now.getTime() };
        }),
    [meetings, rooms, roomId, now]
  );
  // Xem tất cả phòng: mỗi phòng một làn cố định trong ô ngày, để ô trống của phòng này
  // không bị khối họp của phòng kia che mất.
  const laneCount = visibleRooms.length;
  const laneOf = (id: string) => Math.max(visibleRooms.findIndex((item) => item.id === id), 0);
  const laneStyle = (lane: number, lanes: number) => {
    const widthPct = 100 / lanes;
    return { left: `calc(${lane * widthPct}% + 4px)`, width: `calc(${widthPct}% - 6px)` };
  };

  // Khung giờ hiển thị: 7:00–20:00, nới ra nếu có họp sớm/muộn hơn.
  const visibleMeetings = roomMeetings.filter((meeting) => days.includes(meeting.day));
  const startMin = Math.min(
    DEFAULT_START,
    ...visibleMeetings.map((meeting) => Math.floor(meeting.startMin / 60) * 60)
  );
  const endMin = Math.max(
    DEFAULT_END,
    ...visibleMeetings.map((meeting) => Math.ceil(meeting.endMin / 60) * 60)
  );
  const hours = Array.from({ length: (endMin - startMin) / 60 }, (_, index) => startMin + index * 60);
  const px = (minute: number) => ((minute - startMin) / 60) * HOUR_PX;
  const nowMin = vnMinuteOfDay(now);

  useEffect(() => {
    // Mở lịch thì cuộn tới khoảng 8 giờ sáng (hoặc gần giờ hiện tại nếu đang trong tuần).
    const target = todayIndex >= 0 ? Math.max(nowMin - 90, startMin) : 8 * 60;
    scrollRef.current?.scrollTo({ top: Math.max(px(target), 0) });
    // Chỉ chạy khi đổi tuần.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  useEffect(() => {
    if (!selected) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setSelected(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [selected]);

  function chooseRoom(id: string) {
    const next = id === roomId ? "" : id;
    setRoomId(next);
    setSelected(null);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("room", next);
    else url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
  }

  function weekHref(offsetWeeks: number | null) {
    const params = new URLSearchParams();
    if (offsetWeeks !== null) params.set("week", addDaysToKey(weekStart, offsetWeeks * 7));
    if (roomId) params.set("room", roomId);
    const query = params.toString();
    return query ? `/meetings?${query}` : "/meetings";
  }

  function roomBusy(id: string, day: string, minute: number) {
    return roomMeetings.some(
      (meeting) =>
        meeting.roomId === id && meeting.day === day && meeting.startMin < minute + SLOT_MIN && meeting.endMin > minute
    );
  }

  function openSlot(day: string, minute: number, target: CalendarRoom) {
    // Mặc định 1 tiếng, nhưng không lấn sang cuộc họp kế tiếp trong phòng.
    const next = roomMeetings
      .filter((meeting) => meeting.roomId === target.id && meeting.day === day && meeting.startMin >= minute + SLOT_MIN)
      .reduce((min, meeting) => Math.min(min, meeting.startMin), minute + 60);
    setSlot({
      date: day,
      startTime: minuteToTime(minute),
      endTime: minuteToTime(Math.min(next, minute + 60)),
      roomId: target.id,
    });
  }

  function isPastSlot(day: string, minute: number) {
    const at = vnDateTimeToUtc(day, minuteToTime(minute));
    return !at || at.getTime() < now.getTime();
  }


  if (rooms.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <DoorOpen size={25} aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-zinc-800">Chưa có phòng họp nào</h2>
      </div>
    );
  }

  const gridStyle = { "--days": days.length } as React.CSSProperties;
  const columns =
    "[grid-template-columns:48px_minmax(0,1fr)] md:[grid-template-columns:56px_repeat(var(--days),minmax(0,1fr))]";

  return (
    <div>
      {/* Thanh công cụ: tuần · phòng · cuối tuần */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50/70 px-3 py-3 sm:px-4">
        <div className="flex items-center gap-1.5">
          <Link href={weekHref(-1)} prefetch={false} className="tf-icon-button !h-9 !min-h-9 !w-9" aria-label="Tuần trước">
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
          <span className="min-w-[112px] whitespace-nowrap text-center text-sm font-semibold tabular-nums text-zinc-900 sm:min-w-[132px]">
            {formatWeekLabel(weekStart, dayCount)}
          </span>
          <Link href={weekHref(1)} prefetch={false} className="tf-icon-button !h-9 !min-h-9 !w-9" aria-label="Tuần sau">
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
          <Link href={weekHref(null)} prefetch={false} className="tf-button-secondary ml-1 !min-h-9 whitespace-nowrap !px-3 text-xs">
            Tuần này
          </Link>
        </div>

        <div className="order-first flex w-full justify-center gap-2 lg:order-none lg:w-auto" role="tablist" aria-label="Chọn phòng họp">
          {rooms.map((item, index) => {
            const tone = ROOM_COLORS[index % ROOM_COLORS.length];
            const active = item.id === roomId;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={active ? "Bấm lần nữa để xem tất cả phòng" : `Chỉ xem phòng ${item.name}`}
                onClick={() => chooseRoom(item.id)}
                className="tf-pressable inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] border-[1.5px] px-2.5 transition-colors sm:flex-none sm:px-4"
                style={
                  active
                    ? { background: tone.solid, borderColor: tone.solid, color: "#fff" }
                    : { background: "#fff", borderColor: tone.solid, color: tone.solid }
                }
              >
                <span className="truncate text-[12px] font-bold sm:text-[13px] sm:uppercase sm:tracking-[0.06em]">
                  {item.name}
                </span>
                {item.capacity ? (
                  <span className="hidden text-[11px] font-medium normal-case tracking-normal opacity-80 sm:inline">
                    {item.capacity} chỗ
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-zinc-600">
          <input
            type="checkbox"
            checked={showWeekend}
            onChange={(event) => {
              setShowWeekend(event.target.checked);
              if (!event.target.checked) setMobileDay((day) => Math.min(day, 4));
            }}
            className="h-4 w-4 accent-[#a8d431]"
          />
          Hiện Thứ Bảy, Chủ nhật
        </label>
      </div>

      {/* Chọn ngày trên điện thoại */}
      <div className="tf-scroll-tabs flex gap-1.5 overflow-x-auto border-b border-zinc-200 px-3 py-2.5 md:hidden">
        {days.map((day, index) => (
          <button
            key={day}
            type="button"
            onClick={() => setMobileDay(index)}
            aria-pressed={index === mobileDay}
            className={`min-w-[52px] shrink-0 rounded-[8px] border px-2 py-1.5 text-xs font-medium transition-colors ${
              index === mobileDay
                ? "border-brand-400 bg-brand-50 text-brand-800"
                : "border-zinc-200 bg-white text-zinc-500"
            }`}
          >
            <span className="block text-xs font-medium">{WEEKDAYS_SHORT[index]}</span>
            <span className={`block text-base font-semibold ${day === todayKey ? "text-brand-700" : "text-zinc-900"}`}>
              {Number(day.slice(8))}
            </span>
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="relative max-h-[calc(100vh-290px)] min-h-[420px] overflow-y-auto" style={gridStyle}>
        {/* Tiêu đề ngày */}
        <div className={`sticky top-0 z-20 hidden border-b border-zinc-200 bg-white md:grid ${columns}`}>
          <div />
          {days.map((day, index) => {
            const isToday = day === todayKey;
            return (
              <div
                key={day}
                className={`border-l border-zinc-200 px-1 py-2 text-center text-xs font-medium ${
                  index === mobileDay ? "" : "hidden md:block"
                } ${isToday ? "text-brand-800" : "text-zinc-500"}`}
              >
                {WEEKDAYS[index]}
                <span
                  className={`mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-[17px] font-semibold tabular-nums ${
                    isToday ? "bg-brand-400 text-zinc-950" : "text-zinc-900"
                  }`}
                >
                  {Number(day.slice(8))}
                </span>
              </div>
            );
          })}
        </div>

        {/* Lưới giờ */}
        <div className={`relative grid ${columns}`}>
          <div aria-hidden="true">
            {hours.map((hour, index) => (
              <div key={hour} className="relative text-right" style={{ height: HOUR_PX }}>
                {index > 0 && (
                  <span className="absolute -top-2 right-2 text-[11px] tabular-nums text-zinc-400">
                    {minuteToTime(hour)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const isToday = day === todayKey;
            const pastDay = day < todayKey;
            const ofDay = roomMeetings.filter((meeting) => meeting.day === day);
            const dayMeetings = room
              ? layoutOverlaps(ofDay)
              : ofDay.map((meeting) => ({ ...meeting, column: laneOf(meeting.roomId), columns: laneCount }));
            const slots = Array.from({ length: (endMin - startMin) / SLOT_MIN }, (_, index) => startMin + index * SLOT_MIN);
            return (
              <div
                key={day}
                className={`relative border-l border-zinc-200 ${dayIndex === mobileDay ? "" : "hidden md:block"} ${
                  pastDay ? "bg-zinc-50/80" : dayIndex >= 5 ? "bg-zinc-50/40" : ""
                }`}
                style={{ height: hours.length * HOUR_PX }}
              >
                {/* Đường kẻ giờ và nửa giờ */}
                {hours.map((hour) => (
                  <div
                    key={hour}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 border-t border-zinc-200"
                    style={{ top: px(hour) }}
                  >
                    <div className="absolute inset-x-0 border-t border-dashed border-zinc-100" style={{ top: HOUR_PX / 2 }} />
                  </div>
                ))}

                {/* Ô trống: bấm để đặt phòng */}
                {visibleRooms.flatMap((target, lane) =>
                  slots.map((minute) => {
                  if (isPastSlot(day, minute) || roomBusy(target.id, day, minute)) return null;
                  return (
                    <button
                      key={`${target.id}-${minute}`}
                      type="button"
                      onClick={() => openSlot(day, minute, target)}
                      aria-label={`Đặt phòng ${target.name}, ${WEEKDAYS[dayIndex]} ${shortDate(day)}, ${minuteToTime(minute)}`}
                      title={room ? undefined : `Đặt phòng ${target.name}`}
                      className="group absolute z-0 rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                      style={{ top: px(minute) + 1, height: HOUR_PX / 2 - 2, ...laneStyle(lane, laneCount) }}
                    >
                      <span className="hidden h-full items-center gap-1 rounded-[6px] border border-dashed border-emerald-300 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 group-hover:flex group-focus-visible:flex">
                        <Plus size={12} aria-hidden="true" />
                        {minuteToTime(minute)}
                      </span>
                    </button>
                  );
                  })
                )}

                {/* Cuộc họp */}
                {dayMeetings.map((meeting) => {
                  const height = Math.max(px(meeting.endMin) - px(meeting.startMin) - 2, 20);
                  const tone = colorOfRoom(meeting.roomId);
                  const style = meeting.isMine
                    ? { background: tone.solid, color: "#fff", borderColor: tone.ink }
                    : { background: tone.soft, color: tone.ink, borderColor: tone.solid };

                  return (
                    <button
                      key={meeting.id}
                      type="button"
                      onClick={(event) => {
                        setSelected({ meeting, rect: event.currentTarget.getBoundingClientRect() });
                      }}
                      title={[
                        `${minuteToTime(meeting.startMin)} – ${minuteToTime(meeting.endMin)}`,
                        meeting.title,
                        `Người đặt: ${meeting.organizerName}`,
                        roomId ? null : `Phòng ${rooms.find((item) => item.id === meeting.roomId)?.name ?? ""}`,
                      ]
                        .filter(Boolean)
                        .join("\n")}
                      className={`absolute z-10 overflow-hidden rounded-[7px] border-l-4 px-2 py-[3px] text-left text-xs leading-[1.3] shadow-sm transition-shadow hover:z-20 hover:shadow-md ${
                        meeting.done ? "opacity-55" : ""
                      }`}
                      style={{
                        ...style,
                        top: px(meeting.startMin) + 1,
                        height,
                        ...laneStyle(meeting.column, meeting.columns),
                      }}
                    >
                      {meeting.columns > 1 ? (
                        // Khối hẹp (họp trùng giờ ở phòng khác): giờ bắt đầu + tên ngắn người đặt.
                        <>
                          <span className="block truncate text-[11px] font-bold leading-[14px] tabular-nums">
                            {minuteToTime(meeting.startMin)}
                          </span>
                          <span className="block truncate text-[11px] font-semibold leading-[14px]">
                            {shortName(meeting.organizerName)}
                          </span>
                          {height >= 56 && (
                            <span className="block truncate text-[11px] leading-[14px] opacity-85">{meeting.title}</span>
                          )}
                        </>
                      ) : height < 38 ? (
                        // Họp ngắn (30 phút): một dòng giờ bắt đầu + người đặt.
                        <span className="block truncate text-[11px] leading-[16px]">
                          <span className="font-bold tabular-nums">{minuteToTime(meeting.startMin)}</span>
                          <span className="font-semibold"> · {meeting.organizerName}</span>
                        </span>
                      ) : (
                        <>
                          <span className="block truncate text-[11px] font-bold leading-[14px] tabular-nums">
                            {minuteToTime(meeting.startMin)} – {minuteToTime(meeting.endMin)}
                          </span>
                          <span
                            className={`block text-xs font-semibold leading-[16px] ${
                              height >= 84 ? "line-clamp-2" : "truncate"
                            }`}
                          >
                            {meeting.title}
                          </span>
                          <span className="flex min-w-0 items-center gap-1 text-[11px] leading-[14px] opacity-90">
                            <UserRound size={11} className="shrink-0" aria-hidden="true" />
                            <span className="truncate">{meeting.organizerName}</span>
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}

                {isToday && nowMin >= startMin && nowMin <= endMin && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 z-[15] h-0.5 bg-red-500"
                    style={{ top: px(nowMin) }}
                  >
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <MeetingPopover
          ref={popoverRef}
          meeting={selected.meeting}
          rect={selected.rect}
          roomName={rooms.find((item) => item.id === selected.meeting.roomId)?.name ?? ""}
          dayLabel={(() => {
            const key = dayKeyOf(selected.meeting.startAt);
            const index = Math.round(
              (Date.parse(`${key}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000
            );
            return `${WEEKDAYS[index] ?? ""}, ${shortDate(key)}`;
          })()}
          onClose={() => setSelected(null)}
        />
      )}

      {slot && (
        <MeetingComposer
          key={`${slot.date}-${slot.startTime}-${slot.roomId}`}
          {...composerProps}
          organizerId={viewerId}
          initialSlot={slot}
          defaultOpen
          hideTrigger
          onClose={() => setSlot(null)}
        />
      )}
    </div>
  );
}

function MeetingPopover({
  ref,
  meeting,
  rect,
  roomName,
  dayLabel,
  onClose,
}: {
  ref: React.Ref<HTMLDivElement>;
  meeting: CalendarMeeting;
  rect: DOMRect;
  roomName: string;
  dayLabel: string;
  onClose: () => void;
}) {
  const start = new Date(meeting.startAt);
  const end = new Date(meeting.endAt);
  // Đặt bên phải khối họp; hết chỗ thì sang bên trái, màn hình hẹp thì căn giữa.
  const viewportW = window.innerWidth;
  const width = Math.min(300, viewportW - 24);
  const left =
    rect.right + 8 + width <= viewportW - 12
      ? rect.right + 8
      : rect.left - 8 - width >= 12
        ? rect.left - 8 - width
        : (viewportW - width) / 2;
  const top = Math.min(Math.max(12, rect.top), window.innerHeight - 280);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={meeting.title}
      className="tf-modal-enter fixed z-40 rounded-[10px] border border-zinc-200 bg-white p-4 shadow-2xl"
      style={{ left, top, width }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-6 text-zinc-900">{meeting.title}</h3>
        <button type="button" onClick={onClose} className="-mr-1 -mt-1 rounded-[6px] p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Đóng">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {meeting.isMine && (
        <span className="tf-badge mt-1 bg-brand-50 text-brand-800">Bạn có trong cuộc họp này</span>
      )}
      <ul className="mt-3 space-y-2 text-[13px] text-zinc-600">
        <li className="flex items-center gap-2">
          <Clock size={15} className="shrink-0 text-zinc-400" aria-hidden="true" />
          <span className="tabular-nums">
            {dayLabel} · {minuteToTime(vnMinuteOfDay(start))} – {minuteToTime(vnMinuteOfDay(end))}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <DoorOpen size={15} className="shrink-0 text-zinc-400" aria-hidden="true" />
          Phòng {roomName}
        </li>
        <li className="flex items-center gap-2">
          <UserRound size={15} className="shrink-0 text-zinc-400" aria-hidden="true" />
          {meeting.organizerName} tổ chức
        </li>
        <li className="flex items-center gap-2">
          <UsersRound size={15} className="shrink-0 text-zinc-400" aria-hidden="true" />
          {meeting.attendeeCount ? `${meeting.attendeeCount} người được mời` : "Không mời đồng nghiệp (họp với khách)"}
        </li>
      </ul>
      {meeting.isMine ? (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {meeting.meetingUrl && (
            <a
              href={meeting.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tf-button-secondary !min-h-9 !px-3 text-xs"
            >
              <Video size={14} aria-hidden="true" />
              Vào họp online
            </a>
          )}
          <Link
            href={`/meetings?focus=${meeting.id}#meeting-${meeting.id}`}
            prefetch={false}
            className="tf-button-primary !min-h-9 !px-3 text-xs"
          >
            Xem chi tiết
          </Link>
        </div>
      ) : null}
    </div>
  );
}
