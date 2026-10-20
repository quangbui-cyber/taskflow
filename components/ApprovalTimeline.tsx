"use client";

import {
  CheckCircle2,
  Clock,
  RotateCcw,
  XCircle,
  User,
  ShieldCheck,
  Calculator,
  Crown,
} from "lucide-react";
import { Badge } from "@/components/ui/Presentation";
import type { Request } from "@/components/CostFlowPanel";

const ROLE_INFO: Record<string, { label: string; icon: typeof User; color: string }> = {
  ACCOUNT: { label: "Người lập (Account)", icon: User, color: "text-[var(--info)] bg-[var(--info-soft)]" },
  MANAGER: { label: "Quản lý (Manager)", icon: ShieldCheck, color: "text-[var(--success)] bg-[var(--success-soft)]" },
  ACCOUNTANT: { label: "Kế toán (Accountant)", icon: Calculator, color: "text-[var(--warning)] bg-[var(--warning-soft)]" },
  CEO: { label: "CEO (Phê duyệt cấp chi)", icon: Crown, color: "text-[var(--color-brand-800)] bg-[var(--primary-soft)]" },
  AC_DD: { label: "Phó Giám đốc (Duyệt AC)", icon: ShieldCheck, color: "text-[var(--info)] bg-[var(--info-soft)]" },
};

type TimelineStep = {
  role: string;
  label: string;
  assigneeId?: string;
  assigneeName?: string;
  state: "completed" | "current" | "pending" | "returned" | "rejected";
  actionLabel?: string;
  actionTone?: "success" | "warning" | "danger" | "neutral" | "info";
  timestamp?: string;
  reason?: string;
};

type Props = {
  request: Request;
  users: Map<string, string>;
  projectedSteps?: { role: string; assigneeId?: string }[];
};

export default function ApprovalTimeline({ request, users, projectedSteps }: Props) {
  const steps: TimelineStep[] = [];

  // Step 0: Creator (Account)
  const submitEvent = request.approvalEvents.find(
    e => e.attemptId === request.currentAttemptId && e.action === "SUBMIT"
  );
  steps.push({
    role: "ACCOUNT",
    label: ROLE_INFO.ACCOUNT.label,
    assigneeId: request.creatorId,
    assigneeName: users.get(request.creatorId) ?? "Người lập",
    state: submitEvent ? "completed" : "current",
    actionLabel: submitEvent ? "Đã nộp hồ sơ" : "Đang soạn nháp",
    actionTone: submitEvent ? "info" : "neutral",
    timestamp: submitEvent?.createdAt
      ? new Date(submitEvent.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
      : undefined,
    reason: submitEvent?.reason
  });

  // Steps 1..N: Defined approval steps
  const activeSteps = request.steps.length > 0
    ? request.steps
    : (projectedSteps ?? [
        { role: "MANAGER", assigneeId: "" },
        { role: "ACCOUNTANT", assigneeId: "" },
        { role: "CEO", assigneeId: "" }
      ]);

  activeSteps.forEach((step, idx) => {
    const roleKey = step.role;
    const roleMeta = ROLE_INFO[roleKey] ?? {
      label: roleKey,
      icon: User,
      color: "text-[var(--text-secondary)] bg-[var(--surface-soft)]"
    };

    // Find decision or event in current attempt for this step
    const event = request.approvalEvents.find(
      e => e.attemptId === request.currentAttemptId &&
           e.stepIndex === idx &&
           ["APPROVE", "RETURN", "REJECT"].includes(e.action)
    );

    let state: TimelineStep["state"] = "pending";
    let actionLabel = "Chưa xử lý";
    let actionTone: TimelineStep["actionTone"] = "neutral";
    const reason = event?.reason;

    if (event) {
      if (event.action === "APPROVE") {
        state = "completed";
        actionLabel = "Đã phê duyệt";
        actionTone = "success";
      } else if (event.action === "RETURN") {
        state = "returned";
        actionLabel = "Đã trả để sửa";
        actionTone = "warning";
      } else if (event.action === "REJECT") {
        state = "rejected";
        actionLabel = "Từ chối";
        actionTone = "danger";
      }
    } else if (request.state === "SUBMITTED" && request.currentStep === idx) {
      state = "current";
      actionLabel = "Đang chờ xử lý";
      actionTone = "info";
    }

    steps.push({
      role: roleKey,
      label: roleMeta.label,
      assigneeId: step.assigneeId,
      assigneeName: step.assigneeId ? (users.get(step.assigneeId) ?? "Chưa phân công") : "Chưa phân công",
      state,
      actionLabel,
      actionTone,
      timestamp: event?.createdAt
        ? new Date(event.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
        : undefined,
      reason
    });
  });

  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          Tiến trình phê duyệt ({activeSteps.length} bước duyệt)
        </h4>
        <span className="text-xs text-[var(--text-secondary)]">
          {request.state === "APPROVED"
            ? "Đã hoàn thành toàn bộ vòng duyệt"
            : request.state === "SUBMITTED"
            ? `Đang ở bước ${request.currentStep + 1}/${request.steps.length}`
            : request.state === "RETURNED"
            ? "Hồ sơ đã được trả về để chỉnh sửa"
            : request.state === "REJECTED"
            ? "Hồ sơ đã bị từ chối"
            : "Bản nháp chưa gửi"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 relative">
        {steps.map((step, idx) => {
          const roleMeta = ROLE_INFO[step.role] ?? {
            label: step.role,
            icon: User,
            color: "text-[var(--text-secondary)] bg-[var(--surface-soft)]"
          };
          const StepIcon = roleMeta.icon;

          const isCompleted = step.state === "completed";
          const isCurrent = step.state === "current";
          const isReturned = step.state === "returned";
          const isRejected = step.state === "rejected";

          return (
            <div
              key={`${step.role}-${idx}`}
              className={`relative rounded-xl border p-3.5 transition-all flex flex-col justify-between ${
                isCurrent
                  ? "border-[var(--info)] bg-[var(--info-soft)] shadow-sm ring-1 ring-[var(--info)]"
                  : isCompleted
                  ? "border-[var(--success)] bg-[var(--success-soft)]"
                  : isReturned
                  ? "border-[var(--warning)] bg-[var(--warning-soft)]"
                  : isRejected
                  ? "border-[var(--danger)] bg-[var(--danger-soft)]"
                  : "border-[var(--border)] bg-[var(--surface-soft)] opacity-80"
              }`}
            >
              <div>
                {/* Step indicator and role */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${
                        isCompleted
                          ? "bg-[var(--success)] text-white"
                          : isCurrent
                          ? "bg-[var(--info)] text-white animate-pulse"
                          : isReturned
                          ? "bg-[var(--warning)] text-white"
                          : isRejected
                          ? "bg-[var(--danger)] text-white"
                          : "bg-[var(--surface-muted)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 size={14} aria-hidden="true" />
                      ) : isReturned ? (
                        <RotateCcw size={14} aria-hidden="true" />
                      ) : isRejected ? (
                        <XCircle size={14} aria-hidden="true" />
                      ) : isCurrent ? (
                        <Clock size={14} aria-hidden="true" />
                      ) : (
                        idx + 1
                      )}
                    </span>
                    <span className="text-xs font-medium text-[var(--foreground)] truncate max-w-[120px]" title={roleMeta.label}>
                      {idx === 0 ? "Account" : step.role}
                    </span>
                  </div>

                  <Badge tone={step.actionTone ?? "neutral"}>
                    {step.actionLabel}
                  </Badge>
                </div>

                {/* Actor Info */}
                <div className="flex items-center gap-2 mt-2">
                  <div className={`p-1.5 rounded-lg shrink-0 ${roleMeta.color}`}>
                    <StepIcon size={14} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--foreground)] truncate" title={step.assigneeName}>
                      {step.assigneeName}
                    </p>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {roleMeta.label}
                    </p>
                  </div>
                </div>
              </div>

              {/* Timestamp and Decision Reason */}
              <div className="mt-3 pt-2 border-t border-[var(--border)]/60 text-xs">
                {step.timestamp ? (
                  <p className="text-[11px] text-[var(--text-secondary)] mb-1 flex items-center gap-1">
                    <Clock size={10} aria-hidden="true" />
                    {step.timestamp}
                  </p>
                ) : (
                  <p className="text-[11px] text-[var(--text-secondary)] mb-1 italic">
                    Chưa ghi nhận thời gian
                  </p>
                )}

                {step.reason ? (
                  <div className="p-2 rounded bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--foreground)] break-words">
                    <p className="font-medium text-[var(--text-secondary)] text-[10px] uppercase mb-0.5">
                      Ý kiến / Ghi chú:
                    </p>
                    {step.reason}
                  </div>
                ) : isCurrent ? (
                  <p className="text-[11px] text-[var(--info)] font-medium">
                    Đang chờ xử lý...
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
