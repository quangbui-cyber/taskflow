"use client";

import { useActionState, useState, useTransition } from "react";
import { Bell, Eye, Save, Send, Trash2, X } from "lucide-react";
import {
  addComment,
  addFollower,
  deleteTask,
  removeFollower,
  updateTask,
  type ActionState,
} from "@/app/actions/tasks";
import { PRIORITIES, STATUSES, type MemberDTO, type TaskDTO } from "@/lib/types";
import { avatarClass } from "@/lib/avatar";

/** Chuyển ISO string sang giá trị cho input datetime-local (chỉ đến giờ, phút = 00) */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

/** Làm tròn giá trị datetime-local về đầu giờ rồi trả ISO tuyệt đối */
function roundToHour(local: string): string {
  const d = new Date(local);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

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
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [result, setResult] = useState(task.result ?? "");
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(
    task.dueDate ? toDatetimeLocal(task.dueDate) : ""
  );
  const [saving, startSaving] = useTransition();
  const [following, startFollowing] = useTransition();

  const [commentState, commentAction, commentPending] = useActionState<
    ActionState,
    FormData
  >(addComment, {});

  const followerIds = new Set(task.followers.map((f) => f.id));
  const isFollowing = followerIds.has(currentUserId);
  const addableFollowers = members.filter((m) => !followerIds.has(m.userId));

  function toggleFollow() {
    startFollowing(async () => {
      if (isFollowing) await removeFollower(task.id, currentUserId);
      else await addFollower(task.id, currentUserId);
    });
  }

  function save() {
    if (!title.trim()) return;
    startSaving(async () => {
      await updateTask(task.id, {
        title: title.trim(),
        description: description.trim() || null,
        result: result.trim() || null,
        status,
        priority,
        assigneeId: assigneeId || null,
        // Gửi thời điểm tuyệt đối (ISO) tính theo múi giờ trình duyệt,
        // để server (chạy UTC trên Vercel) lưu đúng, không lệch giờ.
        // Làm tròn về đầu giờ (phút = 0) vì app chỉ dùng mốc giờ.
        dueDate: dueDate ? roundToHour(dueDate) : null,
      });
      onClose();
    });
  }

  function remove() {
    if (!confirm("Xoá task này?")) return;
    startSaving(async () => {
      await deleteTask(task.id);
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-3 backdrop-blur-[2px] sm:p-8"
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-2xl rounded-[10px] border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              title="Bấm để sửa tên task"
              className="-mx-2 min-w-0 flex-1 rounded-[7px] border border-transparent px-2 py-1 text-lg font-semibold hover:border-zinc-200 hover:bg-zinc-50 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={toggleFollow}
                disabled={following}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                  isFollowing
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-zinc-200 text-zinc-500 hover:border-blue-300 hover:text-blue-600"
                }`}
                title="Nhận thông báo khi task hoàn thành hoặc có bình luận"
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
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${avatarClass(f.id)}`}
                  >
                    {f.name.charAt(0).toUpperCase()}
                  </span>
                  {f.name}
                  <button
                    onClick={() =>
                      startFollowing(() => removeFollower(task.id, f.id))
                    }
                    disabled={following}
                    className="text-zinc-400 hover:text-red-500 disabled:opacity-50"
                    title="Bỏ theo dõi"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              {addableFollowers.length > 0 && (
                <select
                  value=""
                  disabled={following}
                  onChange={(e) => {
                    const uid = e.target.value;
                    if (uid) startFollowing(() => addFollower(task.id, uid));
                  }}
                  className="rounded-[7px] border border-dashed border-zinc-300 px-2.5 py-1 text-sm text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
                >
                  <option value="">+ Thêm người theo dõi</option>
                  {addableFollowers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Trạng thái
              </span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="tf-field mt-1 !min-h-9 !py-1.5"
              >
                {STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Độ ưu tiên
              </span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="tf-field mt-1 !min-h-9 !py-1.5"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Người làm
              </span>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="tf-field mt-1 !min-h-9 !py-1.5"
              >
                <option value="">— Chưa gán —</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Hạn chót (ngày & giờ)
              </span>
              <input
                type="datetime-local"
                step={3600}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="tf-field mt-1 !min-h-9 !py-1.5"
              />
            </label>
          </div>

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
              >
                <Save size={16} aria-hidden="true" />
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
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${avatarClass(c.author.id)}`}
                  >
                    {c.author.name.charAt(0).toUpperCase()}
                  </span>
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
                    <p className="text-sm text-zinc-700 whitespace-pre-wrap">
                      {c.body}
                    </p>
                  </div>
                </li>
              ))}
              {task.comments.length === 0 && (
                <li className="text-sm text-zinc-400">Chưa có bình luận nào.</li>
              )}
            </ul>

            <form action={commentAction} className="flex gap-2">
              <input type="hidden" name="taskId" value={task.id} />
              <input
                name="body"
                type="text"
                required
                placeholder="Viết bình luận..."
                className="tf-field flex-1"
              />
              <button
                type="submit"
                disabled={commentPending}
                className="tf-button-primary"
              >
                <Send size={15} aria-hidden="true" />
                Gửi
              </button>
            </form>
            {commentState.error && (
              <p className="text-xs text-red-600">{commentState.error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
