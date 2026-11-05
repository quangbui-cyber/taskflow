"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarX2, Check, X } from "lucide-react";
import {
  cancelMeeting,
  cancelMeetingSeries,
  respondToMeeting,
  type MeetingActionState,
} from "@/app/actions/meetings";
import { useInteraction } from "@/components/InteractionProvider";
import { formatDateVN } from "@/lib/dates";
import { recurrenceLabel } from "@/lib/meetingRecurrence";

function useMeetingAction() {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<MeetingActionState>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) notify({ message: result.error, tone: "error" });
      else if (result.success) notify({ message: result.success, tone: "success" });
      router.refresh();
    });
  }

  return { pending, run };
}

export function MeetingResponseButtons({
  meetingId,
  response,
}: {
  meetingId: string;
  response: string;
}) {
  const { pending, run } = useMeetingAction();

  return (
    <div className="flex gap-2" role="group" aria-label="Phản hồi lời mời">
      <button
        type="button"
        disabled={pending}
        aria-pressed={response === "ACCEPTED"}
        onClick={() => run(() => respondToMeeting(meetingId, "ACCEPTED"))}
        className={`tf-button-secondary !min-h-9 !px-3 text-xs ${
          response === "ACCEPTED" ? "!border-brand-400 !bg-brand-50 !text-brand-800" : ""
        }`}
      >
        <Check size={14} aria-hidden="true" />
        Tham dự
      </button>
      <button
        type="button"
        disabled={pending}
        aria-pressed={response === "DECLINED"}
        onClick={() => run(() => respondToMeeting(meetingId, "DECLINED"))}
        className={`tf-button-secondary !min-h-9 !px-3 text-xs ${
          response === "DECLINED" ? "!border-red-200 !bg-red-50 !text-red-700" : ""
        }`}
      >
        <X size={14} aria-hidden="true" />
        Từ chối
      </button>
    </div>
  );
}

export type SeriesOccurrence = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
};

type CancelScope = "one" | "following" | "all";

export function CancelMeetingButton({
  meetingId,
  title,
  roomName,
  startAt,
  seriesFrequency = null,
  occurrences = [],
}: {
  meetingId: string;
  title: string;
  roomName: string | null;
  startAt?: string;
  /** Có giá trị khi cuộc họp thuộc một chuỗi lặp lại: huỷ sẽ hỏi phạm vi. */
  seriesFrequency?: string | null;
  /** Mọi buổi của chuỗi, theo thứ tự thời gian. */
  occurrences?: SeriesOccurrence[];
}) {
  const { pending, run } = useMeetingAction();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<CancelScope>("one");
  // Mốc "đã diễn ra" chốt lúc mở hộp thoại, không đổi theo mỗi lần render.
  const [openedAt, setOpenedAt] = useState(0);
  const isSeries = Boolean(seriesFrequency) && occurrences.length > 1 && Boolean(startAt);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, pending]);

  if (!isSeries) {
    return (
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          const roomNote = roomName ? ` ${roomName} sẽ trống trở lại.` : "";
          if (
            window.confirm(
              `Huỷ cuộc họp "${title}"? Mọi người tham dự sẽ được báo.${roomNote}`
            )
          ) {
            run(() => cancelMeeting(meetingId));
          }
        }}
        className="tf-button-danger !min-h-9 !px-3 text-xs"
      >
        <CalendarX2 size={14} aria-hidden="true" />
        Huỷ họp
      </button>
    );
  }

  const now = openedAt;
  const thisStart = new Date(startAt!).getTime();
  const strip = occurrences.map((occurrence) => {
    const past = new Date(occurrence.endAt).getTime() < now;
    const alreadyCancelled = occurrence.status === "CANCELLED";
    const active = !past && !alreadyCancelled;
    const occurrenceStart = new Date(occurrence.startAt).getTime();
    const willCancel =
      active &&
      (scope === "all" ||
        (scope === "one" && occurrence.id === meetingId) ||
        (scope === "following" && occurrenceStart >= thisStart));
    return { occurrence, past, alreadyCancelled, willCancel };
  });
  const cancelCount = strip.filter((item) => item.willCancel).length;
  const thisDate = formatDateVN(new Date(startAt!));
  const options: Array<{ key: CancelScope; label: string; hint: string }> = [
    { key: "one", label: "Chỉ buổi này", hint: thisDate },
    { key: "following", label: "Buổi này và các buổi sau", hint: `Từ ${thisDate} trở đi` },
    { key: "all", label: "Toàn bộ chuỗi", hint: "Mọi buổi chưa diễn ra" },
  ];

  function confirm() {
    setOpen(false);
    run(() =>
      scope === "one" ? cancelMeeting(meetingId) : cancelMeetingSeries(meetingId, scope)
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setScope("one");
          setOpenedAt(Date.now());
          setOpen(true);
        }}
        className="tf-button-danger !min-h-9 !px-3 text-xs"
      >
        <CalendarX2 size={14} aria-hidden="true" />
        Huỷ họp
      </button>

      {open && (
        <div
          className="tf-overlay-enter fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`cancel-series-${meetingId}`}
            className="tf-modal-enter w-full max-w-[460px] rounded-[14px] border border-zinc-200 bg-white p-5 text-left shadow-2xl"
          >
            <h2 id={`cancel-series-${meetingId}`} className="text-lg font-semibold text-zinc-900">
              Huỷ lịch họp lặp lại
            </h2>
            <p className="mt-0.5 text-[13px] text-zinc-500">
              {title} · {recurrenceLabel(seriesFrequency)}
            </p>

            <div className="mt-4 space-y-2" role="radiogroup" aria-label="Phạm vi huỷ">
              {options.map((option) => (
                <label
                  key={option.key}
                  className={`flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors ${
                    scope === option.key
                      ? "border-red-300 bg-red-50"
                      : "border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  <input
                    type="radio"
                    name={`scope-${meetingId}`}
                    className="mt-1"
                    checked={scope === option.key}
                    onChange={() => setScope(option.key)}
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-900">{option.label}</span>
                    <span className="text-xs text-zinc-500">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Các buổi của chuỗi">
              {strip.map(({ occurrence, past, alreadyCancelled, willCancel }) => (
                <span
                  key={occurrence.id}
                  className={`rounded-[8px] border px-2.5 py-1 text-xs tabular-nums ${
                    willCancel
                      ? "border-red-200 bg-red-50 text-red-700 line-through"
                      : past || alreadyCancelled
                        ? "border-zinc-200 bg-zinc-50 text-zinc-400"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {formatDateVN(new Date(occurrence.startAt)).slice(0, 5)}
                </span>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="tf-button-secondary" onClick={() => setOpen(false)}>
                Giữ lịch
              </button>
              <button
                type="button"
                className="tf-button-danger"
                disabled={pending || cancelCount === 0}
                onClick={confirm}
              >
                {cancelCount === 1 ? "Huỷ 1 buổi" : `Huỷ ${cancelCount} buổi`}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
