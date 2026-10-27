"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Check,
  DoorOpen,
  Pencil,
  Video,
  X,
} from "lucide-react";
import {
  createMeeting,
  updateMeeting,
  type MeetingActionState,
} from "@/app/actions/meetings";
import Avatar from "@/components/Avatar";
import GoogleMeetLinkButton from "@/components/GoogleMeetLinkButton";
import { useActionFeedback } from "@/components/InteractionProvider";
import PeoplePicker, { type PeoplePickerAvailability } from "@/components/PeoplePicker";
import { ScheduleField } from "@/components/TemporalFields";
import { formatHour, toDateInputVN } from "@/lib/dates";
import {
  MEETING_DESCRIPTION_MAX,
  MEETING_TITLE_MAX,
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
  const pickerAvailability = useMemo<Record<string, PeoplePickerAvailability>>(() => {
    if (!timeValid) return {};
    return Object.fromEntries(
      invitable.map((person) => {
        const clashes = (daySchedules.get(person.id) ?? []).filter((slot) => slot.clash);
        return [
          person.id,
          clashes.length > 0
            ? { status: "busy" as const, label: `Bận ${clashes.map((slot) => slot.label).join(", ")}` }
            : { status: "free" as const },
        ];
      })
    );
  }, [daySchedules, invitable, timeValid]);

  function close() {
    setOpen(false);
    onClose?.();
  }

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
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
            className="tf-modal-enter flex h-[min(860px,calc(100vh-32px))] w-full max-w-6xl flex-col overflow-hidden rounded-[10px] border border-zinc-200 bg-white text-left shadow-2xl"
          >
            <header className="flex shrink-0 items-start justify-between gap-5 border-b border-zinc-200 px-5 py-4 sm:px-6">
              <div>
                <h2 id={dialogTitleId} className="text-xl font-semibold text-zinc-900">
                  {meeting ? "Sửa lịch họp" : "Đặt lịch họp"}
                </h2>
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
              <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.12fr)_minmax(380px,0.88fr)] lg:overflow-hidden">
                <div className="space-y-5 px-5 py-5 sm:px-6 lg:min-h-0 lg:overflow-y-auto">
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

                <ScheduleField
                  label="Thời gian họp"
                  date={values.date}
                  startTime={values.startTime}
                  endTime={values.endTime}
                  disablePast
                  onChange={(date, startTime, endTime) =>
                    setValues((current) => ({
                      ...current,
                      date,
                      startTime,
                      endTime,
                    }))
                  }
                />

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
                <GoogleMeetLinkButton disabled={pending} onLink={(url) => set("meetingUrl", url)} />

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

                <section className="rounded-[9px] border border-zinc-200 bg-zinc-50/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-900">
                        Người tham dự ({values.attendeeIds.length})
                      </h3>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Kiểm tra lại danh sách trước khi gửi lời mời.
                      </p>
                    </div>
                    {busySelectedCount > 0 ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        {busySelectedCount} người trùng lịch
                      </span>
                    ) : values.attendeeIds.length > 0 ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        Tất cả đang rảnh
                      </span>
                    ) : null}
                  </div>

                  {selectedPeople.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {selectedPeople.map((person) => (
                        <button
                          key={person.id}
                          type="button"
                          onClick={() =>
                            set(
                              "attendeeIds",
                              values.attendeeIds.filter((id) => id !== person.id)
                            )
                          }
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-1 pr-2 text-xs font-medium text-zinc-700 hover:border-brand-400"
                          title={`Bỏ chọn ${person.name}`}
                        >
                          <Avatar
                            id={person.id}
                            name={person.name}
                            avatarUrl={person.avatarUrl}
                            className="h-6 w-6 text-[10px]"
                          />
                          {person.name}
                          <X size={12} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-[7px] border border-dashed border-zinc-300 px-3 py-4 text-center text-xs text-zinc-400">
                      Chưa chọn người tham dự.
                    </p>
                  )}

                  <label className="mt-4 block border-t border-zinc-200 pt-3">
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
                </section>
                </div>

                <div className="flex min-h-[560px] flex-col border-t border-zinc-200 bg-zinc-50/50 lg:min-h-0 lg:border-l lg:border-t-0">
                  <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-3">
                    <h3 className="text-sm font-semibold text-zinc-900">Thêm người tham dự</h3>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {projectId && !meeting
                        ? "Đã chọn sẵn thành viên dự án. Tìm thêm hoặc bỏ người không cần thiết."
                        : "Tìm theo tên, tình trạng rảnh hoặc nhóm làm việc."}
                    </p>
                  </div>

                  {values.attendeeIds.map((id) => (
                    <input key={id} type="hidden" name="attendeeIds" value={id} />
                  ))}
                  <PeoplePicker
                    people={invitable}
                    selectedIds={values.attendeeIds}
                    onSelectedIdsChange={(ids) => set("attendeeIds", ids)}
                    groups={groups}
                    availability={pickerAvailability}
                    showAvailabilityFilter={timeValid}
                    showSelectedSummary={false}
                    compactGroups
                  />
                </div>
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
                  {pending
                    ? "Đang lưu…"
                    : meeting
                      ? "Lưu thay đổi"
                      : values.attendeeIds.length
                        ? "Đặt lịch và gửi lời mời"
                        : "Đặt lịch"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
