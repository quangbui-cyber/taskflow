"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { DoorOpen, Plus, Trash2 } from "lucide-react";
import {
  createMeetingRoom,
  deleteMeetingRoom,
  setMeetingRoomActive,
  type MeetingActionState,
} from "@/app/actions/meetings";
import {
  useActionFeedback,
  useInteraction,
} from "@/components/InteractionProvider";

type RoomItem = {
  id: string;
  name: string;
  capacity: number | null;
  isActive: boolean;
  upcomingCount: number;
};

export default function MeetingRoomManager({ rooms }: { rooms: RoomItem[] }) {
  const { notify } = useInteraction();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<MeetingActionState, FormData>(
    createMeetingRoom,
    {}
  );
  const [changing, startTransition] = useTransition();
  useActionFeedback(state);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  function run(action: () => Promise<MeetingActionState>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) notify({ message: result.error, tone: "error" });
      else if (result.success) notify({ message: result.success, tone: "success" });
    });
  }

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
            <DoorOpen size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">Phòng họp</h2>
          </div>
        </div>
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="flex flex-col gap-2 border-b border-zinc-100 p-4 sm:flex-row"
      >
        {/* .tf-field luôn rộng 100% nên phải đặt kích thước ở khung bọc, không đặt trên ô nhập. */}
        <div className="min-w-0 flex-1">
          <input
            name="name"
            type="text"
            required
            maxLength={60}
            placeholder="Tên phòng, ví dụ: Phòng họp tầng 3"
            className="tf-field"
            aria-label="Tên phòng họp"
          />
        </div>
        <div className="shrink-0 sm:w-28">
          <input
            name="capacity"
            type="number"
            min={1}
            max={1000}
            placeholder="Sức chứa"
            className="tf-field"
            aria-label="Sức chứa"
          />
        </div>
        <button type="submit" disabled={pending} className="tf-button-primary shrink-0" aria-busy={pending}>
          {pending ? (
            <span className="tf-spinner" aria-hidden="true" />
          ) : (
            <Plus size={16} aria-hidden="true" />
          )}
          {pending ? "Đang thêm..." : "Thêm"}
        </button>
      </form>

      <ul className="divide-y divide-zinc-100">
        {rooms.length === 0 && (
          <li className="px-5 py-4 text-sm text-zinc-400">Chưa có phòng họp nào.</li>
        )}
        {rooms.map((room) => (
          <li key={room.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className={`truncate font-medium ${room.isActive ? "text-zinc-900" : "text-zinc-400"}`}>
                {room.name}
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                {[
                  room.capacity ? `${room.capacity} chỗ` : null,
                  `${room.upcomingCount} cuộc họp sắp tới`,
                  room.isActive ? null : "Đã ngừng dùng",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              type="button"
              disabled={changing}
              onClick={() => run(() => setMeetingRoomActive(room.id, !room.isActive))}
              className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
            >
              {room.isActive ? "Ngừng dùng" : "Mở lại"}
            </button>
            <button
              type="button"
              disabled={changing}
              onClick={() => {
                if (window.confirm(`Xoá phòng "${room.name}"?`)) {
                  run(() => deleteMeetingRoom(room.id));
                }
              }}
              className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0 !border-transparent hover:!border-red-100 hover:!bg-red-50 hover:!text-red-500"
              title="Xoá"
              aria-label={`Xoá ${room.name}`}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
