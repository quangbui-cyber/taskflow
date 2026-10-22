"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ListPlus, Pencil, Plus, SquareArrowOutUpRight, Trash2, UserRound } from "lucide-react";
import {
  createTaskFromRecapActionItem,
  deleteRecapActionItem,
  saveRecapActionItem,
  toggleRecapActionItem,
  type MeetingRecapActionState,
} from "@/app/actions/meetingRecaps";
import Avatar from "@/components/Avatar";
import { useInteraction } from "@/components/InteractionProvider";
import { STATUSES } from "@/lib/types";

export type RecapPerson = { id: string; name: string; avatarUrl: string | null };

export type RecapActionItemView = {
  id: string;
  title: string;
  owner: RecapPerson | null;
  ownerName: string | null;
  dueDate: string | null; // YYYY-MM-DD (giờ VN)
  dueText: string | null;
  done: boolean;
  task: { id: string; status: string; projectId: string; projectName: string } | null;
};

type Draft = { id?: string; title: string; ownerId: string; dueDate: string };

const formatDue = (value: string) => {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
};

const taskStatusLabel = (status: string) => STATUSES.find((item) => item.key === status)?.label ?? status;

function ItemForm({
  draft,
  people,
  dueHint,
  pending,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  people: RecapPerson[];
  dueHint: string | null;
  pending: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="space-y-2.5 rounded-[8px] border border-zinc-200 bg-zinc-50/70 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label className="block">
        <span className="sr-only">Việc cần làm</span>
        <input
          autoFocus
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          maxLength={300}
          placeholder="Việc cần làm, ví dụ: Gửi báo giá cho khách"
          className="tf-field w-full"
        />
      </label>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="tf-label">Người phụ trách</span>
          <select
            value={draft.ownerId}
            onChange={(event) => onChange({ ...draft, ownerId: event.target.value })}
            className="tf-field w-full"
          >
            <option value="">Chưa giao</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="tf-label">Hạn chót</span>
          <input
            type="date"
            value={draft.dueDate}
            onChange={(event) => onChange({ ...draft, dueDate: event.target.value })}
            className="tf-field w-full"
          />
          {dueHint && !draft.dueDate && (
            <span className="mt-1 block text-xs text-zinc-500">Trong họp nói: “{dueHint}”</span>
          )}
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || !draft.title.trim()} className="tf-button-primary !min-h-9 !px-3 text-xs">
          Lưu
        </button>
        <button type="button" onClick={onCancel} className="tf-button-secondary !min-h-9 !px-3 text-xs">
          Huỷ
        </button>
      </div>
    </form>
  );
}

/** Mục "Việc cần làm" của biên bản: tick xong, gắn người phụ trách, tạo task trong dự án. */
export default function RecapActionItems({
  meetingId,
  items,
  people,
  projects,
  defaultProjectId,
  viewerId,
  canManage,
  editable,
}: {
  meetingId: string;
  items: RecapActionItemView[];
  people: RecapPerson[];
  projects: { id: string; name: string }[];
  defaultProjectId: string | null;
  viewerId: string;
  canManage: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [doneState, setDone] = useOptimistic(
    new Map(items.map((item) => [item.id, item.done])),
    (current, [id, done]: [string, boolean]) => new Map(current).set(id, done)
  );

  function run(action: () => Promise<MeetingRecapActionState>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.error) notify({ message: result.error, tone: "error" });
      else {
        if (result.success) notify({ message: result.success, tone: "success" });
        after?.();
      }
      router.refresh();
    });
  }

  function toggle(item: RecapActionItemView, done: boolean) {
    startTransition(async () => {
      setDone([item.id, done]);
      const result = await toggleRecapActionItem(item.id, done);
      if (result.error) notify({ message: result.error, tone: "error" });
      router.refresh();
    });
  }

  function createTask(item: RecapActionItemView, target: string) {
    run(() => createTaskFromRecapActionItem(item.id, target), () => setPickingFor(null));
  }

  const doneCount = items.filter((item) => doneState.get(item.id)).length;
  const editingId = draft?.id ?? null;

  if (items.length === 0 && !editable) return null;

  return (
    <section aria-labelledby="recap-actions-heading" className="mt-6 border-t border-zinc-100 pt-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="recap-actions-heading" className="text-base font-semibold text-zinc-950">
          Việc cần làm
        </h2>
        {items.length > 0 && (
          <span className="tf-badge mt-0 bg-zinc-100 text-zinc-600">
            {doneCount}/{items.length} xong
          </span>
        )}
      </div>

      {items.length === 0 && !draft && (
        <p className="text-sm text-zinc-500">Chưa có việc nào trong danh sách.</p>
      )}

      <ul className="divide-y divide-zinc-100">
        {items.map((item) => {
          const done = doneState.get(item.id) ?? item.done;
          const isOwner = item.owner?.id === viewerId;
          const canToggle = !item.task && (canManage || isOwner);
          if (editingId === item.id && draft) {
            return (
              <li key={item.id} className="py-2.5">
                <ItemForm
                  draft={draft}
                  people={people}
                  dueHint={item.dueText}
                  pending={pending}
                  onChange={setDraft}
                  onSave={() => run(() => saveRecapActionItem(meetingId, draft), () => setDraft(null))}
                  onCancel={() => setDraft(null)}
                />
              </li>
            );
          }
          return (
            <li key={item.id} className="group flex items-start gap-3 py-2.5">
              <input
                type="checkbox"
                checked={done}
                disabled={!canToggle || pending}
                onChange={(event) => toggle(item, event.target.checked)}
                aria-label={`Đánh dấu xong: ${item.title}`}
                title={
                  item.task
                    ? "Trạng thái theo task đã tạo"
                    : canToggle
                      ? undefined
                      : "Chỉ người phụ trách hoặc người tổ chức mới đánh dấu được"
                }
                className="mt-1 h-4 w-4 shrink-0 accent-[#a8d431] disabled:cursor-not-allowed"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`break-words text-[15px] leading-6 ${
                    done ? "text-zinc-400 line-through decoration-zinc-300" : "text-zinc-800"
                  }`}
                >
                  {item.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                  {item.owner ? (
                    <span className={`inline-flex items-center gap-1.5 ${isOwner ? "font-medium text-zinc-800" : ""}`}>
                      <Avatar
                        id={item.owner.id}
                        name={item.owner.name}
                        avatarUrl={item.owner.avatarUrl}
                        className="h-5 w-5 text-[10px]"
                      />
                      {isOwner ? "Bạn" : item.owner.name}
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-amber-700"
                      title={item.ownerName ? `Trong họp nhắc tới: ${item.ownerName}` : undefined}
                    >
                      <UserRound size={13} aria-hidden="true" />
                      {item.ownerName ? `Chưa giao (nhắc tới: ${item.ownerName})` : "Chưa giao"}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays size={13} aria-hidden="true" />
                    {item.dueDate ? formatDue(item.dueDate) : item.dueText ? `“${item.dueText}”` : "Chưa có hạn"}
                  </span>
                  {item.task && (
                    <Link
                      href={`/projects/${item.task.projectId}?task=${item.task.id}`}
                      className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                    >
                      <SquareArrowOutUpRight size={13} aria-hidden="true" />
                      Task · {item.task.projectName} · {taskStatusLabel(item.task.status)}
                    </Link>
                  )}
                </div>

                {pickingFor === item.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={projectId}
                      onChange={(event) => setProjectId(event.target.value)}
                      className="tf-field !min-h-9 max-w-full text-sm sm:w-64"
                      aria-label="Dự án để tạo task"
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={pending || !projectId}
                      onClick={() => createTask(item, projectId)}
                      className="tf-button-primary !min-h-9 !px-3 text-xs"
                    >
                      Tạo task
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickingFor(null)}
                      className="tf-button-secondary !min-h-9 !px-3 text-xs"
                    >
                      Huỷ
                    </button>
                  </div>
                )}
              </div>

              {editable && (
                <div className="flex shrink-0 items-center gap-1">
                  {!item.task && pickingFor !== item.id && (
                    <button
                      type="button"
                      disabled={pending || projects.length === 0}
                      title={projects.length === 0 ? "Bạn chưa thuộc dự án nào để tạo task" : "Tạo task trong dự án"}
                      aria-label={`Tạo task: ${item.title}`}
                      onClick={() =>
                        defaultProjectId ? createTask(item, defaultProjectId) : setPickingFor(item.id)
                      }
                      className="tf-button-secondary !min-h-8 !px-2.5 text-xs"
                    >
                      <ListPlus size={14} aria-hidden="true" />
                      <span className="hidden sm:inline">Tạo task</span>
                    </button>
                  )}
                  {!item.task && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        setDraft({
                          id: item.id,
                          title: item.title,
                          ownerId: item.owner?.id ?? "",
                          dueDate: item.dueDate ?? "",
                        })
                      }
                      className="rounded-[6px] p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                      aria-label={`Sửa: ${item.title}`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const note = item.task ? " Task đã tạo vẫn giữ nguyên." : "";
                      if (window.confirm(`Xoá “${item.title}” khỏi biên bản?${note}`)) {
                        run(() => deleteRecapActionItem(item.id));
                      }
                    }}
                    className="rounded-[6px] p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-700"
                    aria-label={`Xoá: ${item.title}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {editable &&
        (draft && !draft.id ? (
          <div className="mt-2">
            <ItemForm
              draft={draft}
              people={people}
              dueHint={null}
              pending={pending}
              onChange={setDraft}
              onSave={() => run(() => saveRecapActionItem(meetingId, draft), () => setDraft(null))}
              onCancel={() => setDraft(null)}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDraft({ title: "", ownerId: "", dueDate: "" })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-sm font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
          >
            <Plus size={15} aria-hidden="true" />
            Thêm việc
          </button>
        ))}
    </section>
  );
}
