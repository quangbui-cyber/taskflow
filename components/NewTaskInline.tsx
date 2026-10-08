"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { createTask, type ActionState } from "@/app/actions/tasks";
import { PRIORITIES, type MemberDTO } from "@/lib/types";
import DeadlineField from "@/components/DeadlineField";
import UserPicker from "@/components/UserPicker";
import { useInteraction } from "@/components/InteractionProvider";
import TaskAttachmentPicker from "@/components/TaskAttachmentPicker";
import { MAX_TASK_CREATION_FILE_SIZE } from "@/lib/taskCreationFiles";
import { formatProjectFileSize } from "@/lib/projectFiles";

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
  const formRef = useRef<HTMLFormElement>(null);
  const [briefFiles, setBriefFiles] = useState<File[]>([]);
  const [resultFiles, setResultFiles] = useState<File[]>([]);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const dueDate = String(formData.get("dueDate") ?? "");
      if (dueDate) formData.set("dueDate", new Date(dueDate).toISOString());
      for (const file of briefFiles) formData.append("briefFiles", file);
      for (const file of resultFiles) formData.append("resultFiles", file);

      let result: ActionState;
      try {
        result = await createTask(prev, formData);
      } catch {
        result = { error: "Không thể tạo task. Vui lòng thử lại." };
      }
      if (result.error) {
        notify({ message: result.error, tone: "error" });
      } else {
        formRef.current?.reset();
        setBriefFiles([]);
        setResultFiles([]);
        setEditing(false);
        notify({ message: "Đã tạo task.", tone: "success" });
      }
      return result;
    },
    {}
  );
  const totalFileSize = [...briefFiles, ...resultFiles].reduce((size, file) => size + file.size, 0);
  const closeEditor = useCallback(() => {
    if (pending) return;
    setBriefFiles([]);
    setResultFiles([]);
    setEditing(false);
  }, [pending]);

  function selectFiles(kind: "BRIEF" | "RESULT", files: File[]) {
    const empty = files.find((file) => file.size === 0);
    if (empty) {
      notify({ message: `Tệp “${empty.name}” không có nội dung.`, tone: "error" });
      return;
    }
    const otherFiles = kind === "BRIEF" ? resultFiles : briefFiles;
    const total = [...files, ...otherFiles].reduce((size, file) => size + file.size, 0);
    if (total > MAX_TASK_CREATION_FILE_SIZE) {
      notify({ message: "Tổng dung lượng tệp đính kèm khi tạo task tối đa 4 MB.", tone: "error" });
      return;
    }
    if (kind === "BRIEF") setBriefFiles(files);
    else setResultFiles(files);
  }
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
    if (!editing || pending) return;

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
      closeEditor();
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeEditor();
    }

    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [editing, pending, closeEditor]);

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
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        // Dispatch manually so validation errors do not reset the draft.
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      className="space-y-3 rounded-[8px] border border-zinc-200 bg-white p-3 shadow-sm"
    >
      <fieldset disabled={pending} className="min-w-0 space-y-3 border-0 p-0">
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
              if (event.key === "Escape") closeEditor();
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

        <TaskAttachmentPicker
          label="Đính kèm tệp giao việc"
          files={briefFiles}
          onChange={(files) => selectFiles("BRIEF", files)}
          disabled={pending}
        />

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

        <TaskAttachmentPicker
          label="Đính kèm tệp kết quả"
          files={resultFiles}
          onChange={(files) => selectFiles("RESULT", files)}
          disabled={pending}
        />
        <p className="text-xs text-zinc-500">
          Tệp sẽ được tải lên khi bấm Tạo task. Tổng dung lượng tối đa 4 MB
          {totalFileSize > 0 && ` · đã chọn ${formatProjectFileSize(totalFileSize)}`}.
        </p>

        {state.error && <p role="alert" className="text-xs text-red-600">{state.error}</p>}
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
            onClick={closeEditor}
            className="tf-button-secondary !min-h-8 !px-3 !py-1 text-xs"
          >
            Huỷ
          </button>
        </div>
      </fieldset>
    </form>
  );
}
