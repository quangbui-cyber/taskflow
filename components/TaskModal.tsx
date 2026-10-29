"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, Check, ChevronDown, Eye, Save, Trash2, X } from "lucide-react";
import {
  addFollower,
  deleteTask,
  removeFollower,
  updateTask,
} from "@/app/actions/tasks";
import { PRIORITIES, STATUSES, type MemberDTO, type TaskDTO } from "@/lib/types";
import DeadlineField, { toDeadlineLocalValue } from "@/components/DeadlineField";
import Avatar from "@/components/Avatar";
import CommentBody from "@/components/CommentBody";
import CommentComposer from "@/components/CommentComposer";
import UserPicker from "@/components/UserPicker";
import TaskFileSection from "@/components/TaskFileSection";
import DetectedLinks from "@/components/DetectedLinks";
import { useInteraction } from "@/components/InteractionProvider";

const PRIORITY_DOT: Record<string, string> = {
  LOW: "bg-emerald-500",
  MEDIUM: "bg-orange-500",
  HIGH: "bg-red-500",
};

export default function TaskModal({
  task,
  members,
  currentUserId,
  onClose,
}: {
  task: TaskDTO;
  members: MemberDTO[];
  currentUserId: string;
  onClose: () => void;
}) {
  const { notify } = useInteraction();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [result, setResult] = useState(task.result ?? "");
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [openPicker, setOpenPicker] = useState<"followers" | "priority" | null>(
    null
  );
  const [startDate, setStartDate] = useState(
    task.startDate ? toDeadlineLocalValue(task.startDate) : ""
  );
  const [dueDate, setDueDate] = useState(
    task.dueDate ? toDeadlineLocalValue(task.dueDate) : ""
  );
  const [saving, startSaving] = useTransition();
  const [following, startFollowing] = useTransition();
  const followersPickerRef = useRef<HTMLDivElement>(null);
  const priorityPickerRef = useRef<HTMLDivElement>(null);

  const followerIds = new Set(task.followers.map((f) => f.id));
  const isFollowing = followerIds.has(currentUserId);
  const addableFollowers = members.filter((m) => !followerIds.has(m.userId));
  const selectedPriority =
    PRIORITIES.find((p) => p.key === priority) ?? PRIORITIES[0];
  const memberOptions = members.map((m) => ({
    id: m.userId,
    name: m.user.name,
    email: m.user.email,
    avatarUrl: m.user.avatarUrl,
  }));

  useEffect(() => {
    if (!openPicker) return;

    function closePicker(event: PointerEvent) {
      const activePicker =
        openPicker === "followers" ? followersPickerRef.current : priorityPickerRef.current;
      if (!activePicker?.contains(event.target as Node)) setOpenPicker(null);
    }

    function closePickerOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenPicker(null);
    }

    document.addEventListener("pointerdown", closePicker, true);
    document.addEventListener("keydown", closePickerOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closePicker, true);
      document.removeEventListener("keydown", closePickerOnEscape);
    };
  }, [openPicker]);

  function toggleFollow() {
    startFollowing(async () => {
      try {
        if (isFollowing) await removeFollower(task.id, currentUserId);
        else await addFollower(task.id, currentUserId);
        notify({
          message: isFollowing ? "Đã bỏ theo dõi task." : "Đã theo dõi task.",
          tone: "success",
        });
      } catch {
        notify({ message: "Không thể cập nhật theo dõi.", tone: "error" });
      }
    });
  }

  function changeFollower(userId: string, shouldFollow: boolean) {
    startFollowing(async () => {
      try {
        if (shouldFollow) await addFollower(task.id, userId);
        else await removeFollower(task.id, userId);
        notify({
          message: shouldFollow ? "Đã thêm người theo dõi." : "Đã bỏ người theo dõi.",
          tone: "success",
        });
      } catch {
        notify({ message: "Không thể cập nhật người theo dõi.", tone: "error" });
      }
    });
  }

  function save() {
    if (!title.trim()) return;
    startSaving(async () => {
      try {
        await updateTask(task.id, {
          title: title.trim(),
          description: description.trim() || null,
          result: result.trim() || null,
          status,
          priority,
          assigneeId: assigneeId || null,
          // Gửi thời điểm tuyệt đối (ISO) tính theo múi giờ trình duyệt,
          // để server (chạy UTC trên Vercel) lưu đúng, không lệch giờ.
          startDate: startDate ? new Date(startDate).toISOString() : null,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        });
        notify({ message: "Đã lưu thay đổi task.", tone: "success" });
        onClose();
      } catch {
        notify({ message: "Không thể lưu task. Vui lòng thử lại.", tone: "error" });
      }
    });
  }

  function remove() {
    if (!confirm("Xoá task này?")) return;
    startSaving(async () => {
      try {
        await deleteTask(task.id);
        notify({ message: "Đã xoá task.", tone: "success" });
        onClose();
      } catch {
        notify({ message: "Không thể xoá task.", tone: "error" });
      }
    });
  }

  return (
    <div
      className="tf-overlay-enter fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-3 backdrop-blur-[2px] sm:p-8"
      onClick={onClose}
    >
      <div
        className="tf-modal-enter my-auto w-full max-w-2xl rounded-[10px] border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              title="Bấm để sửa tên task"
              className="-mx-2 min-w-0 flex-1 rounded-[7px] border border-transparent px-2 py-1 text-lg font-semibold hover:border-zinc-200 hover:bg-zinc-50 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/30"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={toggleFollow}
                disabled={following}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                  isFollowing
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-zinc-200 text-zinc-500 hover:border-brand-300 hover:text-brand-700"
                }`}
                title="Nhận thông báo khi task có bình luận hoặc thay đổi quan trọng"
              >
                <Bell size={14} aria-hidden="true" />
                {isFollowing ? "Đang theo dõi" : "Theo dõi"}
              </button>
              <button
                onClick={onClose}
                className="tf-icon-button !h-9 !min-h-9 !w-9"
                aria-label="Đóng"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="-mt-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <Eye size={14} aria-hidden="true" />
              Người theo dõi
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {task.followers.length === 0 && (
                <span className="text-sm text-zinc-400">
                  Chưa có ai theo dõi.
                </span>
              )}
              {task.followers.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 pl-1 pr-2 py-0.5 text-sm"
                >
                  <Avatar
                    id={f.id}
                    name={f.name}
                    avatarUrl={f.avatarUrl}
                    className="h-5 w-5 text-[10px]"
                  />
                  {f.name}
                  <button
                    onClick={() => changeFollower(f.id, false)}
                    disabled={following}
                    className="text-zinc-400 hover:text-red-500 disabled:opacity-50"
                    title="Bỏ theo dõi"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              {addableFollowers.length > 0 && (
                <div ref={followersPickerRef} className="relative">
                  <button
                    type="button"
                    disabled={following}
                    onClick={() =>
                      setOpenPicker((current) =>
                        current === "followers" ? null : "followers"
                      )
                    }
                    className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-dashed border-zinc-300 bg-white px-2.5 py-1 text-sm text-zinc-500 transition-colors hover:border-brand-300 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:opacity-50"
                    aria-haspopup="listbox"
                    aria-expanded={openPicker === "followers"}
                  >
                    + Thêm người theo dõi
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {openPicker === "followers" && (
                    <div
                      className="tf-popover-enter absolute left-0 z-50 mt-2 w-72 overflow-hidden rounded-[8px] border border-zinc-200 bg-white p-1 shadow-lg"
                      role="listbox"
                    >
                      {addableFollowers.map((m) => (
                        <button
                          key={m.userId}
                          type="button"
                          onClick={() => {
                            setOpenPicker(null);
                            changeFollower(m.userId, true);
                          }}
                          className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left transition-colors hover:bg-brand-50 focus:bg-brand-50 focus:outline-none"
                          role="option"
                          aria-selected={false}
                        >
                          <Avatar
                            id={m.userId}
                            name={m.user.name}
                            avatarUrl={m.user.avatarUrl}
                            className="h-8 w-8 text-xs"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-zinc-800">
                              {m.user.name}
                            </span>
                            <span className="block truncate text-xs text-zinc-400">
                              {m.user.email}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Trạng thái
              </span>
              <span className="relative mt-1 block">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="tf-field !h-12 !min-h-12 appearance-none !py-2 !pr-11"
                >
                  {STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
                  aria-hidden="true"
                />
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Độ ưu tiên
              </span>
              <div ref={priorityPickerRef} className="relative mt-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenPicker((current) =>
                      current === "priority" ? null : "priority"
                    )
                  }
                  className="tf-field flex !h-12 !min-h-12 w-full items-center justify-between !py-2 text-left"
                  aria-haspopup="listbox"
                  aria-expanded={openPicker === "priority"}
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        PRIORITY_DOT[selectedPriority.key] ?? "bg-zinc-300"
                      }`}
                      aria-hidden="true"
                    />
                    <span
                      className={`tf-badge ${
                        selectedPriority.className
                      }`}
                    >
                      {selectedPriority.label}
                    </span>
                  </span>
                  <ChevronDown size={15} className="text-zinc-400" aria-hidden="true" />
                </button>
                {openPicker === "priority" && (
                  <div
                    className="tf-popover-enter absolute left-0 z-50 mt-2 w-full overflow-hidden rounded-[8px] border border-zinc-200 bg-white p-1 shadow-lg"
                    role="listbox"
                  >
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => {
                          setPriority(p.key);
                          setOpenPicker(null);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-2 text-left transition-colors hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none"
                        role="option"
                        aria-selected={priority === p.key}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              PRIORITY_DOT[p.key] ?? "bg-zinc-300"
                            }`}
                            aria-hidden="true"
                          />
                          <span className={`tf-badge ${p.className}`}>
                            {p.label}
                          </span>
                        </span>
                        {priority === p.key && (
                          <Check size={15} className="text-zinc-500" aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Người làm
              </span>
              <UserPicker
                value={assigneeId}
                onChange={setAssigneeId}
                options={memberOptions}
                placeholder="Chọn người làm"
                emptyLabel="— Chưa gán —"
                ariaLabel="Người làm"
                className="mt-1"
                controlClassName="!h-12 !min-h-12 !py-1.5"
              />
            </label>

            <DeadlineField
              label="Thời gian thực hiện"
              startValue={startDate}
              value={dueDate}
              onStartChange={setStartDate}
              onChange={setDueDate}
              className="col-span-2"
            />
          </div>

          <div>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500">Mô tả</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Thêm mô tả chi tiết..."
                className="tf-field mt-1 resize-y"
              />
            </label>
            <TaskFileSection
              taskId={task.id}
              kind="BRIEF"
              initialFiles={task.files.filter((f) => f.kind === "BRIEF")}
              currentUserId={currentUserId}
            />
          </div>

          <div>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Kết quả công việc
              </span>
              <textarea
                value={result}
                onChange={(event) => setResult(event.target.value)}
                rows={4}
                placeholder="Ghi lại nội dung đã hoàn thành, đường dẫn hoặc thông tin bàn giao..."
                className="tf-field mt-1 resize-y border-emerald-200 bg-emerald-50/30 focus:bg-white"
              />
            </label>
            <DetectedLinks text={result} />
            <TaskFileSection
              taskId={task.id}
              kind="RESULT"
              initialFiles={task.files.filter((f) => f.kind === "RESULT")}
              currentUserId={currentUserId}
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={remove}
              disabled={saving}
              className="tf-button-danger"
            >
              <Trash2 size={16} aria-hidden="true" />
              Xoá task
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="tf-button-secondary"
              >
                Huỷ
              </button>
              <button
                onClick={save}
                disabled={saving || !title.trim()}
                className="tf-button-primary"
                aria-busy={saving}
              >
                {saving ? (
                  <span className="tf-spinner" aria-hidden="true" />
                ) : (
                  <Save size={16} aria-hidden="true" />
                )}
                {saving ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>

          <div className="border-t border-zinc-100 pt-4 space-y-3">
            <h3 className="text-sm font-semibold">
              Bình luận ({task.comments.length})
            </h3>
            <ul className="space-y-3 max-h-56 overflow-y-auto">
              {task.comments.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <Avatar
                    id={c.author.id}
                    name={c.author.name}
                    avatarUrl={c.author.avatarUrl}
                    className="h-7 w-7 text-xs"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-400">
                      <span className="font-medium text-zinc-600">
                        {c.author.name}
                      </span>{" "}
                      ·{" "}
                      {new Date(c.createdAt).toLocaleString("vi-VN", {
                        day: "numeric",
                        month: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <CommentBody body={c.body} mentions={c.mentions} />
                  </div>
                </li>
              ))}
              {task.comments.length === 0 && (
                <li className="text-sm text-zinc-400">Chưa có bình luận nào.</li>
              )}
            </ul>

            <CommentComposer key={task.id} taskId={task.id} members={members} />
          </div>
        </div>
      </div>
    </div>
  );
}
