"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  Bell,
  ChevronDown,
  CircleCheckBig,
  Clock3,
  Eye,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Save,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
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
import DetectedLinks from "@/components/DetectedLinks";
import CommentComposer from "@/components/CommentComposer";
import UserPicker from "@/components/UserPicker";
import TaskFileSection from "@/components/TaskFileSection";
import TaskAttributeSelect from "@/components/TaskAttributeSelect";
import { useInteraction } from "@/components/InteractionProvider";

const PRIORITY_DOT: Record<string, string> = {
  LOW: "bg-emerald-500",
  MEDIUM: "bg-orange-500",
  HIGH: "bg-red-500",
};

const STATUS_DOT: Record<string, string> = {
  TODO: "bg-amber-500",
  IN_PROGRESS: "bg-blue-500",
  DONE: "bg-emerald-500",
};

const STATUS_CLASS: Record<string, string> = {
  TODO: "bg-orange-50 text-orange-700",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  DONE: "bg-emerald-50 text-emerald-700",
};

function formatMetadataDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TaskWorkspaceModal({
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
  const initialStartDate = task.startDate ? toDeadlineLocalValue(task.startDate) : "";
  const initialDueDate = task.dueDate ? toDeadlineLocalValue(task.dueDate) : "";
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [result, setResult] = useState(task.result ?? "");
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [openPicker, setOpenPicker] = useState<
    "followers" | "actions" | null
  >(null);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [saving, startSaving] = useTransition();
  const [following, startFollowing] = useTransition();
  const followersPickerRef = useRef<HTMLDivElement>(null);
  const actionsPickerRef = useRef<HTMLDivElement>(null);

  const followerIds = new Set(task.followers.map((follower) => follower.id));
  const isFollowing = followerIds.has(currentUserId);
  const addableFollowers = members.filter((member) => !followerIds.has(member.userId));
  const selectedStatus = STATUSES.find((item) => item.key === status) ?? STATUSES[0];
  const memberOptions = members.map((member) => ({
    id: member.userId,
    name: member.user.name,
    email: member.user.email,
    avatarUrl: member.user.avatarUrl,
  }));
  const isDirty =
    title !== task.title ||
    description !== (task.description ?? "") ||
    result !== (task.result ?? "") ||
    status !== task.status ||
    priority !== task.priority ||
    assigneeId !== (task.assigneeId ?? "") ||
    startDate !== initialStartDate ||
    dueDate !== initialDueDate;

  function requestClose() {
    if (saving) return;
    if (isDirty && !window.confirm("Bỏ các thay đổi chưa lưu của task này?")) return;
    onClose();
  }

  useEffect(() => {
    if (!openPicker) return;
    const activePicker = openPicker;
    function closePicker(event: PointerEvent) {
      const refs = {
        followers: followersPickerRef,
        actions: actionsPickerRef,
      };
      if (!refs[activePicker].current?.contains(event.target as Node)) setOpenPicker(null);
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

  useEffect(() => {
    function closeModalOnEscape(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !openPicker &&
        !document.querySelector('[data-floating-layer][data-open="true"]')
      ) {
        requestClose();
      }
    }
    document.addEventListener("keydown", closeModalOnEscape);
    return () => document.removeEventListener("keydown", closeModalOnEscape);
  });

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
    if (!title.trim()) {
      notify({ message: "Tiêu đề task không được để trống.", tone: "error" });
      return;
    }
    startSaving(async () => {
      try {
        const response = await updateTask(task.id, {
          title: title.trim(),
          description: description.trim() || null,
          result: result.trim() || null,
          status,
          priority,
          assigneeId: assigneeId || null,
          startDate: startDate ? new Date(startDate).toISOString() : null,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        });
        if (response.error) {
          notify({ message: response.error, tone: "error" });
          return;
        }
        notify({ message: "Đã lưu thay đổi task.", tone: "success" });
        onClose();
      } catch {
        notify({ message: "Không thể lưu task. Vui lòng thử lại.", tone: "error" });
      }
    });
  }

  function remove() {
    setOpenPicker(null);
    if (!window.confirm(`Xoá task “${task.title}”? Hành động này không thể hoàn tác.`)) return;
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
      className="tf-overlay-enter fixed inset-0 z-40 flex items-stretch justify-center bg-zinc-950/35 backdrop-blur-[2px] sm:items-center sm:p-4 lg:p-6"
      onClick={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`task-title-${task.id}`}
        className="tf-modal-enter flex h-full w-full max-w-6xl flex-col overflow-hidden bg-white shadow-xl sm:max-h-[calc(100vh-2rem)] sm:rounded-[12px] sm:border sm:border-zinc-200"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-zinc-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <span className={`tf-badge mt-1.5 shrink-0 ${STATUS_CLASS[status] ?? STATUS_CLASS.TODO}`}>
            {selectedStatus.label}
          </span>
          <input
            id={`task-title-${task.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            title="Bấm để sửa tên task"
            aria-label="Tên task"
            className="min-w-0 flex-1 rounded-[7px] border border-transparent px-2 py-1 text-lg font-semibold text-zinc-950 transition-colors hover:border-zinc-200 hover:bg-zinc-50 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/30 sm:text-xl"
          />
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
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
              <span className="hidden sm:inline">
                {isFollowing ? "Đang theo dõi" : "Theo dõi"}
              </span>
            </button>
            <button type="button" onClick={requestClose} className="tf-icon-button !h-9 !min-h-9 !w-9" aria-label="Đóng">
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f8fa]">
          <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
            <main className="min-w-0 space-y-5 p-4 sm:p-6 lg:border-r lg:border-zinc-200">
              <TaskContentSection
                icon={<FileText size={16} className="text-zinc-400" aria-hidden="true" />}
                title="Nội dung giao việc"
              >
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={7}
                  aria-label="Mô tả"
                  placeholder="Mô tả mục tiêu, yêu cầu và thông tin cần thiết để thực hiện task..."
                  className="tf-field resize-y"
                />
                <TaskFileSection taskId={task.id} kind="BRIEF" initialFiles={task.files.filter((file) => file.kind === "BRIEF")} currentUserId={currentUserId} />
              </TaskContentSection>

              <TaskContentSection
                icon={<CircleCheckBig size={16} className="text-emerald-600" aria-hidden="true" />}
                title="Kết quả & bàn giao"
                className="border-emerald-200"
              >
                <textarea
                  value={result}
                  onChange={(event) => setResult(event.target.value)}
                  rows={5}
                  aria-label="Kết quả công việc"
                  placeholder="Ghi nội dung đã hoàn thành, đường dẫn hoặc thông tin bàn giao..."
                  className="tf-field resize-y border-emerald-200 bg-emerald-50/30 focus:bg-white"
                />
                <DetectedLinks text={result} />
                <TaskFileSection taskId={task.id} kind="RESULT" initialFiles={task.files.filter((file) => file.kind === "RESULT")} currentUserId={currentUserId} />
              </TaskContentSection>

              <section className="rounded-[10px] border border-zinc-200 bg-white p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={16} className="text-zinc-400" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-zinc-900">Hoạt động</h2>
                  </div>
                  <span className="text-xs text-zinc-400">{task.comments.length} bình luận</span>
                </div>
                <ul className="mb-4 max-h-72 space-y-4 overflow-y-auto pr-1">
                  {task.comments.map((comment) => (
                    <li key={comment.id} className="flex gap-2.5">
                      <Avatar id={comment.author.id} name={comment.author.name} avatarUrl={comment.author.avatarUrl} className="h-8 w-8 text-xs" />
                      <div className="min-w-0 flex-1 rounded-[8px] bg-zinc-50 px-3 py-2.5">
                        <p className="mb-1 text-xs text-zinc-400">
                          <span className="font-medium text-zinc-700">{comment.author.name}</span>{" · "}
                          {new Date(comment.createdAt).toLocaleString("vi-VN", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                        <CommentBody body={comment.body} mentions={comment.mentions} />
                      </div>
                    </li>
                  ))}
                  {task.comments.length === 0 && <li className="py-5 text-center text-sm text-zinc-400">Chưa có bình luận nào.</li>}
                </ul>
                <CommentComposer key={task.id} taskId={task.id} members={members} />
              </section>
            </main>

            <aside className="space-y-5 bg-white p-4 sm:p-6 lg:bg-zinc-50/70">
              <section className="space-y-4" aria-labelledby={`task-details-${task.id}`}>
                <h2 id={`task-details-${task.id}`} className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-400">Thông tin</h2>
                <TaskAttributeSelect label="Trạng thái" value={status} onChange={setStatus} options={STATUSES} dotClasses={STATUS_DOT} />
                <label className="block">
                  <span className="text-xs font-medium text-zinc-500">Người làm</span>
                  <UserPicker value={assigneeId} onChange={setAssigneeId} options={memberOptions} placeholder="Chọn người làm" emptyLabel="— Chưa gán —" ariaLabel="Người làm" className="mt-1" />
                </label>

                <TaskAttributeSelect label="Độ ưu tiên" value={priority} onChange={setPriority} options={PRIORITIES} dotClasses={PRIORITY_DOT} />

                <DeadlineField label="Hạn chót" startValue={startDate} value={dueDate} onStartChange={setStartDate} onChange={setDueDate} />
              </section>

              <section className="border-t border-zinc-200 pt-5">
                <div className="mb-2 flex items-center gap-2">
                  <Eye size={14} className="text-zinc-400" aria-hidden="true" />
                  <h2 className="text-xs font-semibold text-zinc-600">Người theo dõi</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {task.followers.map((follower) => (
                    <span key={follower.id} className="inline-flex items-center gap-1.5 rounded-full bg-white py-0.5 pl-1 pr-2 text-xs ring-1 ring-zinc-200">
                      <Avatar id={follower.id} name={follower.name} avatarUrl={follower.avatarUrl} className="h-5 w-5 text-[10px]" />
                      <span className="max-w-28 truncate">{follower.name}</span>
                      <button type="button" onClick={() => changeFollower(follower.id, false)} disabled={following} className="text-zinc-400 hover:text-red-500 disabled:opacity-50" title="Bỏ theo dõi" aria-label={`Bỏ ${follower.name} khỏi người theo dõi`}><X size={11} aria-hidden="true" /></button>
                    </span>
                  ))}
                  {task.followers.length === 0 && <span className="text-xs text-zinc-400">Chưa có người theo dõi.</span>}
                  {addableFollowers.length > 0 && (
                    <div ref={followersPickerRef} className="relative">
                      <button type="button" disabled={following} onClick={() => setOpenPicker((current) => current === "followers" ? null : "followers")} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-zinc-300 bg-white px-2.5 text-xs text-zinc-500 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50" aria-haspopup="listbox" aria-expanded={openPicker === "followers"}>+ Thêm<ChevronDown size={12} aria-hidden="true" /></button>
                      {openPicker === "followers" && (
                        <div className="tf-popover-enter absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-[8px] border border-zinc-200 bg-white p-1 shadow-lg" role="listbox">
                          {addableFollowers.map((member) => (
                            <button key={member.userId} type="button" onClick={() => { setOpenPicker(null); changeFollower(member.userId, true); }} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left transition-colors hover:bg-brand-50 focus:bg-brand-50 focus:outline-none" role="option" aria-selected={false}>
                              <Avatar id={member.userId} name={member.user.name} avatarUrl={member.user.avatarUrl} className="h-8 w-8 text-xs" />
                              <span className="min-w-0"><span className="block truncate text-sm font-medium text-zinc-800">{member.user.name}</span><span className="block truncate text-xs text-zinc-400">{member.user.email}</span></span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-2 border-t border-zinc-200 pt-5 text-xs text-zinc-500">
                <MetadataLine icon={<UserRound size={14} />}><span>Tạo bởi <strong className="font-medium text-zinc-700">{task.creator.name}</strong></span></MetadataLine>
                <MetadataLine icon={<Clock3 size={14} />}>Tạo lúc {formatMetadataDate(task.createdAt)}</MetadataLine>
                <MetadataLine icon={<Clock3 size={14} />}>Cập nhật {formatMetadataDate(task.updatedAt)}</MetadataLine>
                {task.completedAt && <MetadataLine icon={<CircleCheckBig size={14} />} className="text-emerald-700">Hoàn thành {formatMetadataDate(task.completedAt)}</MetadataLine>}
              </section>
            </aside>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 bg-white px-4 py-3 sm:px-6">
          <div ref={actionsPickerRef} className="relative">
            <button type="button" onClick={() => setOpenPicker((current) => current === "actions" ? null : "actions")} className="tf-button-secondary !px-3" aria-haspopup="menu" aria-expanded={openPicker === "actions"}>
              <MoreHorizontal size={16} aria-hidden="true" /><span className="hidden sm:inline">Thao tác</span>
            </button>
            {openPicker === "actions" && (
              <div role="menu" className="tf-popover-enter absolute bottom-full left-0 z-50 mb-2 w-52 rounded-[8px] border border-zinc-200 bg-white p-1 shadow-lg">
                <button type="button" role="menuitem" onClick={remove} disabled={saving} className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={15} aria-hidden="true" />Xoá task</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDirty && <span className="hidden text-xs text-amber-700 sm:inline">Có thay đổi chưa lưu</span>}
            <button type="button" onClick={requestClose} className="tf-button-secondary">Huỷ</button>
            <button type="button" onClick={save} disabled={saving || !title.trim() || !isDirty} className="tf-button-primary" aria-busy={saving}>
              {saving ? <span className="tf-spinner" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function TaskContentSection({
  icon,
  title,
  className = "",
  children,
}: {
  icon: ReactNode;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-[10px] border border-zinc-200 bg-white p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-center gap-2">{icon}<h2 className="text-sm font-semibold text-zinc-900">{title}</h2></div>
      {children}
    </section>
  );
}

function MetadataLine({ icon, className = "", children }: { icon: ReactNode; className?: string; children: ReactNode }) {
  return <div className={`flex items-start gap-2 ${className}`}><span className="mt-0.5 shrink-0 text-zinc-400" aria-hidden="true">{icon}</span><span>{children}</span></div>;
}
