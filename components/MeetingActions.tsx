"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarX2, Check, X } from "lucide-react";
import {
  cancelMeeting,
  respondToMeeting,
  type MeetingActionState,
} from "@/app/actions/meetings";
import { useInteraction } from "@/components/InteractionProvider";

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

export function CancelMeetingButton({
  meetingId,
  title,
  roomName,
}: {
  meetingId: string;
  title: string;
  roomName: string | null;
}) {
  const { pending, run } = useMeetingAction();

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
