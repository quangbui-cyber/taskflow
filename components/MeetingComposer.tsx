"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Check,
  ChevronDown,
  DoorOpen,
  Pencil,
  UsersRound,
  Video,
  X,
} from "lucide-react";
import {
  createMeeting,
  updateMeeting,
  type MeetingActionState,
} from "@/app/actions/meetings";
import Avatar from "@/components/Avatar";
import { useActionFeedback } from "@/components/InteractionProvider";
import { formatHour, toDateInputVN } from "@/lib/dates";
import {
  MEETING_DESCRIPTION_MAX,
  MEETING_TITLE_MAX,
  MEETING_TIME_SLOTS,
  formatMeetingTime,
  presetMeetingAttendees,
  rangesOverlap,
  vnDateTimeToUtc,
} from "@/lib/meetings";

export type MeetingPerson = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};
export type MeetingRoomOption = { id: string; name: string; capacity: number | null };
export type MeetingGroupOption = { id: string; name: string; memberIds: string[] };
/** Một lượt giữ phòng đang có hiệu lực — dùng để báo phòng bận ngay khi chọn giờ */
export type RoomBooking = {
  meetingId: string;
  roomId: string;
  startAt: string;
  endAt: string;
  title: string;
  organizerName: string;
};
/** Khung giờ bận của những người trong một cuộc họp sắp tới (người đã từ chối không tính) */
export type PersonSchedule = {
  meetingId: string;
  startAt: string;
  endAt: string;
  userIds: string[];
};
/** Khung giờ chọn sẵn khi bấm ô trống trên lịch phòng */
export type MeetingSlot = { date: string; startTime: string; endTime: string; roomId: string };
export type EditableMeeting = {
  id: string;
  organizerId: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  roomId: string | null;
  meetingUrl: string;
  attendeeIds: string[];
  recorderId: string | null;
};

type FormValues = {
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  roomId: string;
  meetingUrl: string;
  attendeeIds: string[];
  /** "" = người tổ chức tự ghi biên bản */
  recorderId: string;
};

const INITIAL_STATE: MeetingActionState = {};

/** Mốc sau `time` đúng `steps` lần 30 phút, không vượt quá mốc cuối ngày (23:30) */
function slotAfter(time: string, steps: number): string {
  const index = MEETING_TIME_SLOTS.indexOf(time);
  return MEETING_TIME_SLOTS[Math.min(index + steps, MEETING_TIME_SLOTS.length - 1)];
}

const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "10:00";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mặc định: 09:00 – 10:00. Chưa tới 9 giờ sáng thì gợi ý hôm nay; đã qua thì gợi ý
 * ngày làm việc kế tiếp (bỏ qua Thứ Bảy, Chủ nhật) vì không đặt được lịch trong quá khứ.
 */
function defaultValues(attendeeIds: string[] = [], now = new Date()): FormValues {
  let day = now;
  if (formatHour(now) >= DEFAULT_START_TIME) {
    do {
      day = new Date(day.getTime() + DAY_MS);
    } while ([0, 6].includes(new Date(`${toDateInputVN(day)}T00:00:00Z`).getUTCDay()));
  }
  return {
    title: "",
    description: "",
    date: toDateInputVN(day),
    startTime: DEFAULT_START_TIME,
    endTime: DEFAULT_END_TIME,
    roomId: "",
    meetingUrl: "",
    attendeeIds,
    recorderId: "",
  };
}

function sameIds(a: string[], b: string[]) {
  const set = new Set(a);
  return a.length === b.length && b.every((id) => set.has(id));
}

function valuesFromMeeting(meeting: EditableMeeting): FormValues {
  const startAt = new Date(meeting.startAt);
  const endAt = new Date(meeting.endAt);
  return {
    title: meeting.title,
    description: meeting.description,
    date: toDateInputVN(startAt),
    startTime: formatHour(startAt),
    endTime: formatHour(endAt),
    roomId: meeting.roomId ?? "",
    meetingUrl: meeting.meetingUrl,
    attendeeIds: meeting.attendeeIds,
    recorderId: meeting.recorderId ?? "",
  };
}

export default function MeetingComposer({
  people,
  rooms,
  groups,
  bookings,
  schedules,
  organizerId,
  meeting,
  emailEnabled,
  initialAttendeeIds,
  projectId,
  triggerLabel = "Đặt lịch họp",
  triggerClassName = "tf-button-primary min-h-11 px-4",
  initialSlot,
  defaultOpen = false,
  hideTrigger = false,
  onClose,
}: {
  people: MeetingPerson[];
  rooms: MeetingRoomOption[];
  groups: MeetingGroupOption[];
  bookings: RoomBooking[];
  schedules: PersonSchedule[];
  /** Người tổ chức không nằm trong danh sách mời */
  organizerId: string;
  /** Có giá trị thì form ở chế độ sửa */
  meeting?: EditableMeeting;
  emailEnabled: boolean;
  /** Người được chọn sẵn khi mở form tạo mới (ví dụ: thành viên dự án); vẫn bỏ bớt/thêm được */
  initialAttendeeIds?: string[];
  /** Tạo từ trang dự án: cuộc họp gắn với dự án, biên bản được lưu vào tài liệu dự án */
  projectId?: string;
  /** Chữ trên nút mở form tạo mới */
  triggerLabel?: string;
  triggerClassName?: string;
  /** Mở từ ô trống trên lịch phòng: điền sẵn ngày, giờ và phòng */
  initialSlot?: MeetingSlot;
  defaultOpen?: boolean;
  /** Không hiện nút mở form (form do nơi khác mở, ví dụ lịch phòng) */
  hideTrigger?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  // Chỉ chọn sẵn người mời được: đang hoạt động và không phải người tổ chức.
  const presetAttendeeIds = useMemo(
    () =>
      presetMeetingAttendees(
        initialAttendeeIds ?? [],
        people.map((person) => person.id),
        organizerId
      ),
    [initialAttendeeIds, organizerId, people]
  );
  // Bản mới nhất cho effect đóng form, để danh sách đổi sau router.refresh() không chạy lại effect.
  const presetRef = useRef(presetAttendeeIds);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    presetRef.current = presetAttendeeIds;
    onCloseRef.current = onClose;
  }, [presetAttendeeIds, onClose]);
  const [values, setValues] = useState<FormValues>(() =>
    meeting
      ? valuesFromMeeting(meeting)
      : { ...defaultValues(presetAttendeeIds), ...initialSlot }
  );
  const [query, setQuery] = useState("");
  const action = useMemo(
    () => (meeting ? updateMeeting.bind(null, meeting.id) : createMeeting),
    [meeting]
  );
  const [state, formAction, actionPending] = useActionState(action, INITIAL_STATE);
  const [submitting, startSubmit] = useTransition();
  const pending = actionPending || submitting;
  useActionFeedback(state);

  const invitable = useMemo(
    () => people.filter((person) => person.id !== organizerId),
    [organizerId, people]
  );
  const selected = useMemo(() => new Set(values.attendeeIds), [values.attendeeIds]);
  // Bỏ người đang được giao ghi biên bản khỏi danh sách mời thì quay về người tổ chức.
  const recorderId = selected.has(values.recorderId) ? values.recorderId : "";
  const organizerName = people.find((person) => person.id === organizerId)?.name ?? "Người tổ chức";
  const selectedPeople = invitable.filter((person) => selected.has(person.id));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPeople = invitable.filter((person) =>
    `${person.name} ${person.email}`.toLowerCase().includes(normalizedQuery)
  );

  const startMs = vnDateTimeToUtc(values.date, values.startTime)?.getTime() ?? null;
  const endMs = vnDateTimeToUtc(values.date, values.endTime)?.getTime() ?? null;
  const timeValid = startMs !== null && endMs !== null && endMs > startMs;

  // Phòng nào đang bị cuộc họp khác giữ trong khung giờ vừa chọn.
  const roomClashes = useMemo(() => {
    const clashes = new Map<string, RoomBooking>();
    if (startMs === null || endMs === null || endMs <= startMs) return clashes;
    const startAt = new Date(startMs);
    const endAt = new Date(endMs);
    for (const booking of bookings) {
      if (booking.meetingId === meeting?.id || clashes.has(booking.roomId)) continue;
      if (rangesOverlap(startAt, endAt, new Date(booking.startAt), new Date(booking.endAt))) {
        clashes.set(booking.roomId, booking);
      }
    }
    return clashes;
  }, [bookings, meeting?.id, startMs, endMs]);
  // Lịch họp của từng người trong ngày đang chọn, đánh dấu khoảng nào trùng với khung giờ vừa chọn.
  const daySchedules = useMemo(() => {
    const byPerson = new Map<string, { key: string; label: string; clash: boolean }[]>();
    const hasRange = startMs !== null && endMs !== null && endMs > startMs;
    const sorted = schedules
      .filter(
        (schedule) =>
          schedule.meetingId !== meeting?.id &&
          toDateInputVN(new Date(schedule.startAt)) === values.date
      )
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    for (const schedule of sorted) {
      const scheduleStart = new Date(schedule.startAt);
      const scheduleEnd = new Date(schedule.endAt);
      const slot = {
        key: schedule.meetingId,
        label: formatMeetingTime(scheduleStart, scheduleEnd),
        clash:
          hasRange &&
          rangesOverlap(new Date(startMs), new Date(endMs), scheduleStart, scheduleEnd),
      };
      for (const userId of schedule.userIds) {
        const slots = byPerson.get(userId) ?? [];
        slots.push(slot);
        byPerson.set(userId, slots);
      }
    }
    return byPerson;
  }, [schedules, meeting?.id, values.date, startMs, endMs]);
  const isBusy = (userId: string) =>
    daySchedules.get(userId)?.some((slot) => slot.clash) ?? false;
  const busySelectedCount = values.attendeeIds.filter(isBusy).length;
  const selectedRoomClash = values.roomId ? roomClashes.get(values.roomId) : undefined;

  function close() {
    setOpen(false);
    onClose?.();
  }

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function setStartTime(startTime: string) {
    setValues((current) => ({
      ...current,
      startTime,
      // Dời giờ bắt đầu ra sau giờ kết thúc thì tự đẩy giờ kết thúc thành +1 tiếng.
      endTime: current.endTime > startTime ? current.endTime : slotAfter(startTime, 2),
    }));
  }

  function toggleAttendee(userId: string) {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    set("attendeeIds", [...next]);
  }

  /** Thành viên của nhóm có thể mời được (bỏ người đã bị vô hiệu hoá, người tổ chức...). */
  function groupMemberIds(group: MeetingGroupOption) {
    const allowed = new Set(invitable.map((person) => person.id));
    return group.memberIds.filter((id) => allowed.has(id));
  }

  /** Nhóm coi như đang được chọn khi mọi thành viên mời được của nhóm đều đã chọn. */
  function isGroupSelected(group: MeetingGroupOption) {
    const memberIds = groupMemberIds(group);
    return memberIds.length > 0 && memberIds.every((id) => selected.has(id));
  }

  /** Bấm lần đầu chọn cả nhóm, bấm lần nữa bỏ chọn cả nhóm. */
  function toggleGroup(group: MeetingGroupOption) {
    const memberIds = groupMemberIds(group);
    if (isGroupSelected(group)) {
      const remove = new Set(memberIds);
      set("attendeeIds", values.attendeeIds.filter((id) => !remove.has(id)));
    } else {
      set("attendeeIds", [...new Set([...values.attendeeIds, ...memberIds])]);
    }
  }

  function openDialog() {
    // Form tạo mới luôn mở với mốc giờ tính từ lúc bấm, không phải lúc trang tải.
    if (!meeting) {
      const fresh = defaultValues(presetAttendeeIds);
      // Đang có bản nháp (đã gõ tiêu đề hoặc đã đổi người mời) thì giữ nguyên.
      setValues((current) =>
        current.title || !sameIds(current.attendeeIds, presetAttendeeIds)
          ? current
          : { ...fresh, roomId: current.roomId, meetingUrl: current.meetingUrl }
      );
    } else {
      setValues(valuesFromMeeting(meeting));
    }
    setQuery("");
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        setOpen(false);
        onCloseRef.current?.();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, pending]);

  useEffect(() => {
    // Lỗi thường là phòng vừa bị người khác đặt — tải lại để danh sách phòng bận hiện đúng.
    if (state.error) router.refresh();
    if (!state.success) return;
    router.refresh();
    const frame = window.requestAnimationFrame(() => {
      if (!meeting) setValues(defaultValues(presetRef.current));
      setOpen(false);
      onCloseRef.current?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [meeting, router, state]);

  const canSubmit =
    values.title.trim().length >= 2 &&
    timeValid &&
    values.attendeeIds.length > 0 &&
    !selectedRoomClash;
  const dialogTitleId = meeting ? `meeting-dialog-${meeting.id}` : "meeting-dialog-new";

  return (
    <>
      {meeting ? (
        <button type="button" className="tf-button-secondary !min-h-9 !px-3 text-xs" onClick={openDialog}>
          <Pencil size={14} aria-hidden="true" />
          Sửa
        </button>
      ) : hideTrigger ? null : (
        <button type="button" className={triggerClassName} onClick={openDialog}>
          <CalendarPlus size={18} strokeWidth={1.8} aria-hidden="true" />
          {triggerLabel}
        </button>
      )}

      {open && (
        <div
          className="tf-overlay-enter fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) close();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="tf-modal-enter flex max-h-[calc(100vh-32px)] w-full max-w-2xl flex-col overflow-hidden rounded-[10px] border border-zinc-200 bg-white text-left shadow-2xl"
          >
            <header className="flex shrink-0 items-start justify-between gap-5 border-b border-zinc-200 px-5 py-4 sm:px-6">
              <div>
                <h2 id={dialogTitleId} className="text-xl font-semibold text-zinc-900">
                  {meeting ? "Sửa lịch họp" : "Đặt lịch họp"}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {emailEnabled
                    ? "Người tham dự sẽ nhận thông báo trong app và email kèm lịch."
                    : "Người tham dự sẽ nhận thông báo trong app."}
                </p>
              </div>
              <button
                type="button"
                className="tf-icon-button shrink-0"
                onClick={close}
                disabled={pending}
                aria-label="Đóng"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>

            <form
              // Gọi action qua onSubmit thay vì prop action: React tự reset form sau mỗi
              // action, làm các ô chọn người (controlled) hiển thị lệch với state khi có lỗi.
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                startSubmit(() => formAction(formData));
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
                <label className="block">
                  <span className="tf-label">Tiêu đề</span>
                  <input
                    autoFocus
                    name="title"
                    type="text"
                    value={values.title}
                    onChange={(event) => set("title", event.target.value)}
                    maxLength={MEETING_TITLE_MAX}
                    required
                    placeholder="Ví dụ: Họp kick-off dự án"
                    className="tf-field"
                  />
                </label>

                <div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <label className="block">
                      <span className="tf-label">Ngày</span>
                      <input
                        name="date"
                        type="date"
                        value={values.date}
                        onChange={(event) => set("date", event.target.value)}
                        required
                        className="tf-field"
                      />
                    </label>
                    {(
                      [
                        ["startTime", "Bắt đầu", setStartTime],
                        ["endTime", "Kết thúc", (time: string) => set("endTime", time)],
                      ] as const
                    ).map(([name, label, onSelect]) => (
                      <label key={name} className="block">
                        <span className="tf-label">{label}</span>
                        <span className="relative block">
                          <select
                            name={name}
                            value={values[name]}
                            onChange={(event) => onSelect(event.target.value)}
                            required
                            className="tf-field appearance-none !pr-10 tabular-nums"
                          >
                            {/* Cuộc họp cũ có giờ lẻ vẫn hiện đúng giờ đang lưu cho tới khi chọn lại. */}
                            {!MEETING_TIME_SLOTS.includes(values[name]) && (
                              <option value={values[name]}>{values[name]}</option>
                            )}
                            {MEETING_TIME_SLOTS.map((slot) => (
                              <option key={slot} value={slot}>
                                {slot}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={16}
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
                            aria-hidden="true"
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                  {!timeValid && (
                    <p className="mt-2 text-xs text-red-600">
                      Giờ kết thúc phải sau giờ bắt đầu.
                    </p>
                  )}
                </div>

                <fieldset>
                  <legend className="tf-label">Phòng họp</legend>
                  <input type="hidden" name="roomId" value={values.roomId} />
                  {projectId && !meeting && <input type="hidden" name="projectId" value={projectId} />}
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Phòng họp">
                    {[{ id: "", name: "Không dùng phòng", capacity: null }, ...rooms].map((room) => {
                      const clash = room.id ? roomClashes.get(room.id) : undefined;
                      const checked = values.roomId === room.id;
                      return (
                        <button
                          key={room.id || "none"}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          disabled={Boolean(clash) && !checked}
                          onClick={() => set("roomId", room.id)}
                          className={`flex min-h-[58px] items-center gap-3 rounded-[8px] border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                            checked
                              ? clash
                                ? "border-red-300 bg-red-50"
                                : "border-brand-400 bg-brand-50"
                              : clash
                                ? "border-zinc-200 bg-zinc-50"
                                : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                          }`}
                        >
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] ${
                              checked && !clash
                                ? "bg-brand-400 text-zinc-950"
                                : "bg-zinc-100 text-zinc-500"
                            }`}
                          >
                            {checked && !clash ? (
                              <Check size={16} aria-hidden="true" />
                            ) : room.id ? (
                              <DoorOpen size={16} aria-hidden="true" />
                            ) : (
                              <Video size={16} aria-hidden="true" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block truncate text-sm font-medium ${
                                clash && !checked ? "text-zinc-400" : "text-zinc-800"
                              }`}
                            >
                              {room.name}
                            </span>
                            <span
                              className={`block truncate text-xs ${
                                clash ? "text-red-600" : "text-zinc-400"
                              }`}
                            >
                              {clash
                                ? `Bận ${formatMeetingTime(new Date(clash.startAt), new Date(clash.endAt))} · ${clash.title}`
                                : room.id
                                  ? `Trống${room.capacity ? ` · ${room.capacity} chỗ` : ""}`
                                  : "Họp online hoặc tự sắp xếp chỗ"}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {rooms.length === 0 && (
                    <p className="mt-2 text-xs text-zinc-400">
                      Chưa có phòng họp nào. Admin thêm phòng trong Cài đặt → Phòng họp.
                    </p>
                  )}
                  {selectedRoomClash && (
                    <p className="mt-2 text-xs text-red-600">
                      Phòng đang chọn đã có lịch của {selectedRoomClash.organizerName} trong khung giờ này.
                    </p>
                  )}
                </fieldset>

                <label className="block">
                  <span className="tf-label">Link họp online (không bắt buộc)</span>
                  <input
                    name="meetingUrl"
                    type="url"
                    inputMode="url"
                    value={values.meetingUrl}
                    onChange={(event) => set("meetingUrl", event.target.value)}
                    maxLength={500}
                    placeholder="https://meet.google.com/…"
                    className="tf-field"
                  />
                </label>

                <fieldset>
                  <legend className="tf-label">
                    Người tham dự
                    <span className="ml-1.5 font-normal text-zinc-400">
                      · đã chọn {values.attendeeIds.length}
                    </span>
                  </legend>
                  {values.attendeeIds.map((id) => (
                    <input key={id} type="hidden" name="attendeeIds" value={id} />
                  ))}
                  {groups.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {groups.map((group) => {
                        const active = isGroupSelected(group);
                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => toggleGroup(group)}
                            aria-pressed={active}
                            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors ${
                              active
                                ? "border-brand-400 bg-brand-100 text-brand-900 hover:bg-brand-50"
                                : "border-zinc-200 bg-white text-zinc-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                            }`}
                            title={
                              active
                                ? `Bỏ chọn cả nhóm ${group.name}`
                                : `Thêm cả nhóm ${group.name}`
                            }
                          >
                            <UsersRound size={13} aria-hidden="true" />
                            {group.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="overflow-hidden rounded-[8px] border border-zinc-200">
                    <div className="border-b border-zinc-100 p-2">
                      <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Tìm theo tên hoặc email"
                        className="tf-field !min-h-9 !py-1.5"
                        aria-label="Tìm người tham dự"
                      />
                    </div>
                    <div className="grid max-h-48 grid-cols-1 overflow-y-auto p-2 sm:grid-cols-2">
                      {filteredPeople.map((person) => {
                        const slots = daySchedules.get(person.id) ?? [];
                        const busy = slots.some((slot) => slot.clash);
                        return (
                          <label
                            key={person.id}
                            className="flex cursor-pointer items-start gap-2 rounded-[7px] px-2 py-2 hover:bg-zinc-50"
                            title={person.email}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(person.id)}
                              onChange={() => toggleAttendee(person.id)}
                              className="mt-1.5 h-4 w-4 shrink-0 accent-[#a8d431]"
                            />
                            <Avatar
                              id={person.id}
                              name={person.name}
                              avatarUrl={person.avatarUrl}
                              className="h-7 w-7 text-xs"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-zinc-700">
                                {person.name}
                              </span>
                              <span
                                className={`block text-xs ${
                                  busy
                                    ? "font-medium text-red-600"
                                    : timeValid
                                      ? "text-emerald-700"
                                      : "text-zinc-400"
                                }`}
                              >
                                {busy ? "Bận giờ này" : timeValid ? "Rảnh giờ này" : person.email}
                              </span>
                              {slots.length > 0 && (
                                <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">
                                  Đã có họp:{" "}
                                  {slots.map((slot, index) => (
                                    <span key={slot.key}>
                                      {index > 0 && ", "}
                                      <span
                                        className={`whitespace-nowrap tabular-nums ${
                                          slot.clash ? "font-semibold text-red-600" : ""
                                        }`}
                                      >
                                        {slot.label}
                                      </span>
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                      {filteredPeople.length === 0 && (
                        <p className="p-2 text-sm text-zinc-400">Không có nhân sự phù hợp.</p>
                      )}
                    </div>
                  </div>
                  {busySelectedCount > 0 && (
                    <p className="mt-2 text-xs text-amber-700">
                      {busySelectedCount} người đã chọn đang có cuộc họp khác trong khung giờ này.
                      Bạn vẫn có thể mời, hoặc đổi giờ để mọi người cùng rảnh.
                    </p>
                  )}
                </fieldset>

                <label className="block">
                  <span className="tf-label">Người ghi biên bản</span>
                  <select
                    name="recorderId"
                    value={recorderId}
                    onChange={(event) => set("recorderId", event.target.value)}
                    className="tf-field"
                  >
                    <option value="">{organizerName} (người tổ chức)</option>
                    {selectedPeople.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1.5 block text-xs text-zinc-500">
                    Người này ghi âm và gửi biên bản. Không chọn ai thì người tổ chức tự ghi.
                  </span>
                </label>

                <label className="block">
                  <span className="tf-label">Nội dung (không bắt buộc)</span>
                  <textarea
                    name="description"
                    value={values.description}
                    onChange={(event) => set("description", event.target.value)}
                    maxLength={MEETING_DESCRIPTION_MAX}
                    placeholder="Mục tiêu cuộc họp, tài liệu cần chuẩn bị…"
                    className="tf-field min-h-24 resize-y leading-6"
                  />
                </label>
              </div>

              <div className="flex shrink-0 justify-end gap-2.5 border-t border-zinc-200 px-5 py-4 sm:px-6">
                <button
                  type="button"
                  className="tf-button-secondary"
                  onClick={close}
                  disabled={pending}
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="tf-button-primary"
                  disabled={pending || !canSubmit}
                  aria-busy={pending}
                >
                  {pending ? (
                    <span className="tf-spinner" aria-hidden="true" />
                  ) : (
                    <CalendarPlus size={17} aria-hidden="true" />
                  )}
                  {pending ? "Đang lưu…" : meeting ? "Lưu thay đổi" : "Đặt lịch và gửi lời mời"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
