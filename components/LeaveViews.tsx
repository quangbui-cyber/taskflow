"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Check, Plus, Save, Send, X } from "lucide-react";
import {
  cancelLeaveRequest,
  createLeaveRequest,
  decideLeaveRequest,
  setAnnualLeaveDays,
  setLeaveManagers,
  type LeaveState,
} from "@/app/actions/leave";
import {
  useActionFeedback,
  useInteraction,
} from "@/components/InteractionProvider";
import {
  HALF_DAY_OPTIONS,
  LEAVE_TYPES,
  MAX_ANNUAL_LEAVE_DAYS,
  countLeaveDays,
  formatLeaveDays,
  leaveRangeError,
  leaveTypeInfo,
  parseLeaveDate,
} from "@/lib/leave";

function useLeaveAction() {
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<LeaveState>) {
    startTransition(async () => {
      const result = await action();
      notify({
        message: result.error ?? result.success ?? "Đã lưu.",
        tone: result.error ? "error" : "success",
      });
    });
  }
  return { pending, run };
}

/** Form tạo đơn: tính sẵn số ngày và cảnh báo khi vượt quỹ phép còn lại. */
export function LeaveRequestForm({
  today,
  remaining,
  approverName,
}: {
  today: string; // yyyy-mm-dd theo giờ Việt Nam
  remaining: number; // quỹ phép còn lại sau khi trừ đơn đã duyệt và đang chờ
  approverName: string; // tên người sẽ duyệt đơn
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<string>(LEAVE_TYPES[0].key);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [halfDay, setHalfDay] = useState("");
  const [state, formAction, pending] = useActionState<LeaveState, FormData>(
    createLeaveRequest,
    {}
  );
  useActionFeedback(state);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  const start = parseLeaveDate(startDate);
  const end = parseLeaveDate(endDate);
  const singleDay = startDate === endDate;
  const effectiveHalfDay = singleDay && halfDay ? halfDay : null;
  const rangeError =
    start && end ? leaveRangeError(start, end, effectiveHalfDay) : null;
  const days =
    start && end && !rangeError
      ? countLeaveDays(start, end, effectiveHalfDay)
      : 0;
  const overQuota = leaveTypeInfo(type).deductsQuota && days > remaining;

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">Tạo đơn xin nghỉ</h2>
      </div>
      <form ref={formRef} action={formAction} className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="text-xs font-medium text-zinc-500">Từ ngày</span>
            <input
              name="startDate"
              type="date"
              required
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                if (event.target.value > endDate) setEndDate(event.target.value);
              }}
              className="tf-field mt-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-500">Đến ngày</span>
            <input
              name="endDate"
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="tf-field mt-1.5"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-500">Thời gian</span>
            <select
              name="halfDay"
              value={singleDay ? halfDay : ""}
              disabled={!singleDay}
              onChange={(event) => setHalfDay(event.target.value)}
              className="tf-field mt-1.5 disabled:bg-zinc-50 disabled:text-zinc-400"
              title={
                singleDay ? undefined : "Nghỉ nửa ngày chỉ áp dụng khi nghỉ một ngày"
              }
            >
              <option value="">Cả ngày</option>
              {HALF_DAY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  Nửa ngày — {option.label.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-500">Loại nghỉ</span>
            <select
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="tf-field mt-1.5"
            >
              {LEAVE_TYPES.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Lý do</span>
          <textarea
            name="reason"
            rows={2}
            maxLength={500}
            className="tf-field mt-1.5"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-zinc-600">
            {rangeError ? (
              <span className="text-red-600">{rangeError}</span>
            ) : (
              <>
                Số ngày nghỉ:{" "}
                <strong className="tabular-nums text-zinc-950">
                  {formatLeaveDays(days)}
                </strong>
                <span className="mx-2 text-zinc-300">·</span>
                Người duyệt:{" "}
                <strong className="font-medium text-zinc-950">
                  {approverName}
                </strong>
                {overQuota && (
                  <span className="ml-2 text-amber-600">
                    Vượt quỹ phép còn lại ({formatLeaveDays(Math.max(0, remaining))}{" "}
                    ngày). Vẫn gửi được, người duyệt sẽ quyết định.
                  </span>
                )}
              </>
            )}
          </p>
          <button
            type="submit"
            disabled={pending || Boolean(rangeError)}
            aria-busy={pending}
            className="tf-button-primary"
          >
            {pending ? (
              <span className="tf-spinner" aria-hidden="true" />
            ) : (
              <Send size={16} aria-hidden="true" />
            )}
            {pending ? "Đang gửi..." : "Gửi đơn"}
          </button>
        </div>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      </form>
    </section>
  );
}

export function LeaveCancelButton({ requestId }: { requestId: string }) {
  const { pending, run } = useLeaveAction();
  return (
    <button
      type="button"
      disabled={pending}
      className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
      onClick={() => {
        if (window.confirm("Huỷ đơn xin nghỉ này?")) {
          run(() => cancelLeaveRequest(requestId));
        }
      }}
    >
      Huỷ đơn
    </button>
  );
}

export function LeaveDecisionButtons({
  requestId,
  requesterName,
}: {
  requestId: string;
  requesterName: string;
}) {
  const { pending, run } = useLeaveAction();
  return (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        disabled={pending}
        className="tf-button-primary !min-h-8 !px-2.5 !py-1 text-xs"
        onClick={() => run(() => decideLeaveRequest(requestId, true, ""))}
      >
        <Check size={14} aria-hidden="true" />
        Duyệt
      </button>
      <button
        type="button"
        disabled={pending}
        className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
        onClick={() => {
          const note = window.prompt(
            `Lý do từ chối đơn của ${requesterName} (có thể để trống):`,
            ""
          );
          if (note === null) return;
          run(() => decideLeaveRequest(requestId, false, note));
        }}
      >
        <X size={14} aria-hidden="true" />
        Từ chối
      </button>
    </div>
  );
}

/** Ô đặt số ngày phép năm của một người (Admin). */
export function LeaveQuotaInput({
  userId,
  userName,
  days,
}: {
  userId: string;
  userName: string;
  days: number;
}) {
  const { pending, run } = useLeaveAction();
  const [value, setValue] = useState(String(days));
  const parsed = Number(value.replace(",", "."));
  const changed = value.trim() !== "" && parsed !== days;

  return (
    <form
      className="flex items-center justify-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => setAnnualLeaveDays(userId, parsed));
      }}
    >
      <input
        type="number"
        min={0}
        max={MAX_ANNUAL_LEAVE_DAYS}
        step={0.5}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={`Số ngày phép năm của ${userName}`}
        className="h-8 w-20 rounded-[6px] border border-zinc-200 px-2 text-right text-[13px] tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
      <button
        type="submit"
        disabled={pending || !changed}
        className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0"
        title="Lưu số ngày phép"
        aria-label={`Lưu số ngày phép của ${userName}`}
      >
        <Save size={14} aria-hidden="true" />
      </button>
    </form>
  );
}

/**
 * Chọn quản lý nghỉ phép (Admin): mỗi người một ô chọn, bấm dấu + để thêm
 * người nữa. Mỗi thay đổi được lưu ngay.
 */
export function LeaveManagerPicker({
  users,
  selectedIds,
}: {
  users: Array<{ id: string; name: string }>;
  selectedIds: string[];
}) {
  const { pending, run } = useLeaveAction();
  // Mỗi phần tử là một ô chọn; "" là ô mới thêm chưa chọn ai.
  const [slots, setSlots] = useState<string[]>(
    selectedIds.length > 0 ? selectedIds : [""]
  );

  function apply(next: string[]) {
    setSlots(next.length > 0 ? next : [""]);
    const before = slots.filter(Boolean);
    const after = next.filter(Boolean);
    if (before.join("|") !== after.join("|")) {
      run(() => setLeaveManagers(after));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {slots.map((value, index) => (
        <div key={index} className="flex items-center gap-1">
          <select
            value={value}
            disabled={pending}
            aria-label={`Quản lý nghỉ phép ${index + 1}`}
            onChange={(event) =>
              apply(
                slots.map((slot, i) => (i === index ? event.target.value : slot))
              )
            }
            className="tf-field w-56"
          >
            <option value="">Chọn quản lý</option>
            {users
              .filter((user) => user.id === value || !slots.includes(user.id))
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
          </select>
          {slots.length > 1 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => apply(slots.filter((_, i) => i !== index))}
              className="tf-icon-button shrink-0"
              title="Bỏ quản lý này"
              aria-label={`Bỏ quản lý nghỉ phép ${index + 1}`}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        disabled={pending || slots.includes("") || slots.length >= users.length}
        onClick={() => setSlots([...slots, ""])}
        className="tf-icon-button shrink-0"
        title="Thêm quản lý"
        aria-label="Thêm quản lý nghỉ phép"
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
