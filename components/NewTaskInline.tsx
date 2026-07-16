"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { createTask, type ActionState } from "@/app/actions/tasks";
import { PRIORITIES, type MemberDTO } from "@/lib/types";
import DeadlineField from "@/components/DeadlineField";
import UserPicker from "@/components/UserPicker";
import { useInteraction } from "@/components/InteractionProvider";

export default function NewTaskInline({
  projectId,
  status,
  members,
  defaultOpen = false,
}: {
  projectId: string;
  status: string;
  members: MemberDTO[];
  defaultOpen?: boolean;
}) {
  const { notify } = useInteraction();
  const [editing, setEditing] = useState(defaultOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const dueDate = String(formData.get("dueDate") ?? "");
      if (dueDate) formData.set("dueDate", new Date(dueDate).toISOString());

      const result = await createTask(prev, formData);
      if (result.error) {
        notify({ message: result.error, tone: "error" });
      } else {
        formRef.current?.reset();
        setEditing(false);
        notify({ message: "Đã tạo task.", tone: "success" });
      }
      return result;
    },
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);
  const memberOptions = members.map((member) => ({
    id: member.userId,
    name: member.user.name,
    email: member.user.email,
    avatarUrl: member.user.avatarUrl,
  }));

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) return;

    function closeOnOutsideClick(event: PointerEvent) {
      const target = event.target as Node;
      const targetElement =
        target instanceof Element ? target : target.parentElement;

      if (
        formRef.current?.contains(target) ||
        targetElement?.closest("[data-floating-layer]")
      ) {
        return;
      }
      setEditing(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setEditing(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [editing]);

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-2 rounded-[7px] px-2 py-2 text-left text-sm text-zinc-500 transition-colors hover:bg-white hover:text-brand-700"
      >
        <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
        Thêm task
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-[8px] border border-zinc-200 bg-white p-3 shadow-sm"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="status" value={status} />
      <label className="block">
        <span className="text-xs font-medium text-zinc-500">Tên task</span>
        <input
          ref={inputRef}
          name="title"
          type="text"
          required
          placeholder="Nhập tên task..."
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
          className="tf-field mt-1 bg-white"
        />
      </label>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Người làm</span>
          <UserPicker
            name="assigneeId"
            options={memberOptions}
            placeholder="Chưa gán"
            emptyLabel="Chưa gán"
            ariaLabel="Người làm"
            className="mt-1"
            menuPlacement="top"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Ưu tiên</span>
          <div className="relative mt-1">
            <select
              name="priority"
              defaultValue="MEDIUM"
              className="tf-field appearance-none !pr-10"
            >
              {PRIORITIES.map((priority) => (
                <option key={priority.key} value={priority.key}>
                  {priority.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
          </div>
        </label>
      </div>

      <div>
        <DeadlineField name="dueDate" compact />
      </div>

      <label className="block">
        <span className="text-xs font-medium text-zinc-500">Mô tả</span>
        <textarea
          name="description"
          rows={3}
          placeholder="Mô tả công việc..."
          className="tf-field mt-1 resize-y"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-zinc-500">
          Kết quả công việc
        </span>
        <textarea
          name="result"
          rows={3}
          placeholder="Nội dung đã hoàn thành hoặc bàn giao..."
          className="tf-field mt-1 resize-y"
        />
      </label>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="tf-button-primary !min-h-8 !px-3 !py-1 text-xs"
          aria-busy={pending}
        >
          {pending && <span className="tf-spinner" aria-hidden="true" />}
          {pending ? "Đang thêm..." : "Tạo task"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="tf-button-secondary !min-h-8 !px-3 !py-1 text-xs"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}
