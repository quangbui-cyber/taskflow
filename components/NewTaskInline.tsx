"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, X } from "lucide-react";
import { createTask, type ActionState } from "@/app/actions/tasks";
import { PRIORITIES, STATUSES, type MemberDTO } from "@/lib/types";
import DeadlineField from "@/components/DeadlineField";
import UserPicker from "@/components/UserPicker";
import TaskAttributeSelect from "@/components/TaskAttributeSelect";
import { useInteraction } from "@/components/InteractionProvider";
import TaskAttachmentPicker from "@/components/TaskAttachmentPicker";
import { MAX_TASK_CREATION_FILE_SIZE } from "@/lib/taskCreationFiles";
import { formatProjectFileSize } from "@/lib/projectFiles";

// Same breakpoint where the board switches to three columns side by side.
const DESKTOP_QUERY = "(min-width: 768px)";
const STATUS_DOTS: Record<string, string> = {
  TODO: "bg-amber-500",
  IN_PROGRESS: "bg-blue-500",
  DONE: "bg-emerald-500",
};
const PRIORITY_DOTS: Record<string, string> = {
  LOW: "bg-emerald-500",
  MEDIUM: "bg-orange-500",
  HIGH: "bg-red-500",
};

function subscribeToDesktop(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useIsDesktop() {
  return useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false
  );
}

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
  const isDesktop = useIsDesktop();
  const headingId = useId();
  const [editing, setEditing] = useState(defaultOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [briefFiles, setBriefFiles] = useState<File[]>([]);
  const [resultFiles, setResultFiles] = useState<File[]>([]);
  // The draft lives here rather than in the inputs, because crossing the
  // desktop breakpoint swaps the dialog and inline form and remounts them.
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [taskStatus, setTaskStatus] = useState(status);
  const [priority, setPriority] = useState("MEDIUM");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState("");
  const [deliverableOpen, setDeliverableOpen] = useState(false);
  const resetDraft = useCallback(() => {
    setTitle("");
    setAssigneeId("");
    setTaskStatus(status);
    setPriority("MEDIUM");
    setStartDate("");
    setDueDate("");
    setDescription("");
    setResult("");
    setDeliverableOpen(false);
    setBriefFiles([]);
    setResultFiles([]);
  }, [status]);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const startDate = String(formData.get("startDate") ?? "");
      const dueDate = String(formData.get("dueDate") ?? "");
      if (startDate) formData.set("startDate", new Date(startDate).toISOString());
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
        resetDraft();
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
    resetDraft();
    setEditing(false);
  }, [pending, resetDraft]);

  // In the dialog, a stray Escape or backdrop click should not throw away
  // anything already filled in or picked, so those only close an empty draft.
  const hasDraft =
    [title, description, result].some((value) => value.trim()) ||
    Boolean(assigneeId) ||
    taskStatus !== status ||
    priority !== "MEDIUM" ||
    Boolean(startDate) ||
    Boolean(dueDate) ||
    briefFiles.length > 0 ||
    resultFiles.length > 0;

  const requestClose = useCallback(() => {
    if (isDesktop && hasDraft) return;
    closeEditor();
  }, [isDesktop, hasDraft, closeEditor]);

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
  }, [editing, isDesktop]);

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
      requestClose();
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !document.querySelector('[data-floating-layer][data-open="true"]')
      ) {
        requestClose();
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [editing, pending, requestClose]);

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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // Dispatch manually so validation errors do not reset the draft.
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  const hiddenFields = (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="status" value={taskStatus} />
    </>
  );

  const titleField = (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500">Tên task</span>
      <input
        ref={inputRef}
        name="title"
        type="text"
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Nhập tên task..."
        className={`tf-field mt-1 bg-white ${isDesktop ? "!text-base font-medium" : ""}`}
      />
    </label>
  );

  const assigneeField = (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500">Người làm</span>
      <UserPicker
        name="assigneeId"
        value={assigneeId}
        onChange={setAssigneeId}
        options={memberOptions}
        placeholder="Chưa gán"
        emptyLabel="Chưa gán"
        ariaLabel="Người làm"
        className="mt-1"
        menuPlacement={isDesktop ? "bottom" : "top"}
      />
    </label>
  );

  const priorityField = (
    <TaskAttributeSelect
      name="priority"
      label="Ưu tiên"
      value={priority}
      onChange={setPriority}
      options={PRIORITIES}
      dotClasses={PRIORITY_DOTS}
    />
  );

  const statusField = (
    <TaskAttributeSelect
      label="Trạng thái"
      value={taskStatus}
      onChange={setTaskStatus}
      options={STATUSES}
      dotClasses={STATUS_DOTS}
    />
  );

  const deadlineField = (
    <DeadlineField
      name="dueDate"
      startName="startDate"
      defaultValue={dueDate}
      defaultStartValue={startDate}
      onChange={setDueDate}
      onStartChange={setStartDate}
      compact
    />
  );

  const descriptionField = (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500">Mô tả</span>
      <textarea
        name="description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={isDesktop ? 9 : 3}
        placeholder="Mô tả công việc..."
        className="tf-field mt-1 resize-y"
      />
    </label>
  );

  const briefPicker = (
    <TaskAttachmentPicker
      label="Đính kèm tệp giao việc"
      files={briefFiles}
      onChange={(files) => selectFiles("BRIEF", files)}
      disabled={pending}
    />
  );

  const resultField = (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500">
        Kết quả công việc
      </span>
      <textarea
        name="result"
        value={result}
        onChange={(event) => setResult(event.target.value)}
        rows={isDesktop ? 5 : 3}
        placeholder="Nội dung đã hoàn thành hoặc bàn giao..."
        className="tf-field mt-1 resize-y"
      />
    </label>
  );

  const resultPicker = (
    <TaskAttachmentPicker
      label="Đính kèm tệp kết quả"
      files={resultFiles}
      onChange={(files) => selectFiles("RESULT", files)}
      disabled={pending}
    />
  );

  const deliverableFields = (
    <details
      className="group rounded-[8px] border border-zinc-200 bg-zinc-50/60"
      open={deliverableOpen}
      onToggle={(event) => setDeliverableOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium text-zinc-700 marker:content-none">
        <span>Kết quả ban đầu</span>
        <span className="text-xs font-normal text-zinc-400 group-open:hidden">
          Không bắt buộc
        </span>
        <ChevronDown
          size={15}
          className="hidden text-zinc-400 transition-transform group-open:block group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-zinc-200 px-3 pb-3 pt-3">
        {resultField}
        {resultPicker}
      </div>
    </details>
  );

  const fileNote =
    totalFileSize > 0 ? (
      <p className="text-xs text-zinc-500">Đã chọn {formatProjectFileSize(totalFileSize)} / 4 MB</p>
    ) : null;

  const errorMessage = state.error && (
    <p role="alert" className="text-xs text-red-600">{state.error}</p>
  );

  const submitButton = (
    <button
      type="submit"
      disabled={pending}
      className={`tf-button-primary ${isDesktop ? "" : "!min-h-8 !px-3 !py-1 text-xs"}`}
      aria-busy={pending}
    >
      {pending && <span className="tf-spinner" aria-hidden="true" />}
      {pending ? "Đang thêm..." : "Tạo task"}
    </button>
  );

  const cancelButton = (
    <button
      type="button"
      onClick={closeEditor}
      className={`tf-button-secondary ${isDesktop ? "" : "!min-h-8 !px-3 !py-1 text-xs"}`}
    >
      Huỷ
    </button>
  );

  if (isDesktop) {
    return createPortal(
      <div className="tf-overlay-enter fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/35 p-6 backdrop-blur-[2px]">
        <form
          ref={formRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          onSubmit={submit}
          className="tf-modal-enter max-h-full w-full max-w-4xl overflow-y-auto rounded-[10px] border border-zinc-200 bg-white shadow-xl"
        >
          {/* A fieldset can't shrink as a flex box, so the whole dialog
              scrolls and the header and buttons stay pinned with sticky. */}
          <fieldset disabled={pending} className="min-w-0 border-0 p-0">
            {hiddenFields}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-6 py-4">
              <div>
                <h2 id={headingId} className="text-base font-semibold text-zinc-900">
                  Tạo task mới
                </h2>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="tf-icon-button shrink-0"
                aria-label="Đóng"
                title="Đóng"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_17rem] gap-6 px-6 py-5">
              <div className="min-w-0 space-y-4">
                {titleField}
                <div>
                  {descriptionField}
                  {briefPicker}
                </div>
                {deliverableFields}
              </div>

              <aside className="h-fit space-y-4 rounded-[8px] border border-zinc-200 bg-zinc-50/70 p-4">
                {assigneeField}
                {statusField}
                {priorityField}
                {deadlineField}
              </aside>
            </div>

            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t border-zinc-200 bg-white px-6 py-3">
              <div className="min-w-0 space-y-1">
                {errorMessage}
                {fileNote}
              </div>
              <div className="flex shrink-0 gap-2">
                {cancelButton}
                {submitButton}
              </div>
            </div>
          </fieldset>
        </form>
      </div>,
      document.body
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="space-y-3 rounded-[8px] border border-zinc-200 bg-white p-3 shadow-sm"
    >
      <fieldset disabled={pending} className="min-w-0 space-y-3 border-0 p-0">
        {hiddenFields}
        {titleField}

        {assigneeField}
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {statusField}
          {priorityField}
        </div>

        <div>{deadlineField}</div>

        {descriptionField}
        {briefPicker}
        {deliverableFields}
        {fileNote}

        {errorMessage}
        <div className="flex gap-2">
          {submitButton}
          {cancelButton}
        </div>
      </fieldset>
    </form>
  );
}
