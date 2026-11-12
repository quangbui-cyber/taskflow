import { formatCrmDate, vnDayStart } from "./dates";
import { OPPORTUNITY_OUTCOMES } from "./labels";
import { formatCompactVnd } from "./opportunityFormat";

export type OpportunityViewInput = {
  stage: string; outcome: string | null;
  briefReceivedAt: Date | null; briefSummary: string | null; proposalDueAt: Date | null; winStrategy: string | null; proposalPlannedAt: Date | null;
  wonAt: Date | null; closedAt: Date | null; contractValue: number | null; project: { id: string; name: string } | null;
  outcomeReasonLabel: string | null; outcomeNote: string | null;
  tasks: unknown[]; files: unknown[]; meetings: unknown[];
};
export type OpportunityPrimaryAction = { key: "BRIEF" | "BIDDING" | "RESULT"; label: string } | null;

export function opportunityPrimaryAction(stage: string, outcome: string | null, rights: { canAdvance: boolean; canClose: boolean }): OpportunityPrimaryAction {
  if (outcome !== null) return null;
  if (stage === "CARE" && rights.canAdvance) return { key: "BRIEF", label: "Nhận Brief" };
  if (stage === "BRIEF" && rights.canAdvance) return { key: "BIDDING", label: "Chuyển sang Bidding" };
  if (stage === "BIDDING" && rights.canClose) return { key: "RESULT", label: "Ghi kết quả thầu" };
  return null;
}

export type BriefChecklistItem = { key: "briefReceivedAt" | "briefSummary" | "proposalDueAt" | "winStrategy" | "proposalPlannedAt"; label: string; done: boolean; value: string | null; text: string | null; canAdd: boolean };
/** canAdd mirrors the fields EditOpportunityDialog exposes at the current stage; the caller still checks EDIT. */
export function briefChecklist(detail: OpportunityViewInput, now: Date): BriefChecklistItem[] {
  const open = detail.outcome === null;
  const pastCare = detail.stage !== "CARE", bidding = detail.stage === "BIDDING";
  const date = (key: BriefChecklistItem["key"], label: string, value: Date | null, editable: boolean): BriefChecklistItem =>
    ({ key, label, done: !!value, value: value ? formatCrmDate(value, now) : null, text: null, canAdd: open && editable && !value });
  const text = (key: BriefChecklistItem["key"], label: string, value: string | null, editable: boolean): BriefChecklistItem => {
    const done = !!value?.trim();
    return { key, label, done, value: done ? "Có" : null, text: done ? value : null, canAdd: open && editable && !done };
  };
  return [
    date("briefReceivedAt", "Ngày nhận Brief", detail.briefReceivedAt, false),
    text("briefSummary", "Đề bài tóm tắt", detail.briefSummary, pastCare),
    date("proposalDueAt", "Hạn nộp đề xuất", detail.proposalDueAt, pastCare),
    text("winStrategy", "Chiến lược thắng thầu", detail.winStrategy, bidding),
    date("proposalPlannedAt", "Ngày gửi đề xuất dự kiến", detail.proposalPlannedAt, bidding),
  ];
}

export type OutcomeBanner = {
  tone: "won" | "closed"; title: string; project: { id: string; name: string } | null;
  transferred: { tasks: number; files: number; meetings: number } | null; transferredLabel: string | null;
  reason: string | null; note: string | null;
};
export function outcomeBanner(detail: OpportunityViewInput, now: Date): OutcomeBanner | null {
  if (detail.outcome === null) return null;
  if (detail.outcome === "WON") {
    const date = detail.wonAt ?? detail.closedAt;
    const transferred = { tasks: detail.tasks.length, files: detail.files.length, meetings: detail.meetings.length };
    return {
      tone: "won", title: [`Đã thắng${date ? ` ${formatCrmDate(date, now)}` : ""}`, detail.contractValue !== null ? `Hợp đồng ${formatCompactVnd(detail.contractValue)}` : null].filter(Boolean).join(" · "),
      project: detail.project, transferred, transferredLabel: `${transferred.tasks} việc, ${transferred.files} file, ${transferred.meetings} cuộc họp`, reason: null, note: null,
    };
  }
  const label = OPPORTUNITY_OUTCOMES.find(o => o.key === detail.outcome)?.label ?? detail.outcome;
  return { tone: "closed", title: detail.closedAt ? `${label} · ${formatCrmDate(detail.closedAt, now)}` : label, project: null, transferred: null, transferredLabel: null, reason: detail.outcomeReasonLabel, note: detail.outcomeNote };
}

export function proposalCountdown(dueAt: Date | null, now: Date): { days: number; dateLabel: string; label: string; tone: "late" | "warn" | null } | null {
  if (!dueAt) return null;
  const days = Math.round((vnDayStart(dueAt).getTime() - vnDayStart(now).getTime()) / 86400000);
  const dateLabel = formatCrmDate(dueAt, now);
  const rest = days > 0 ? `còn ${days} ngày` : days === 0 ? "hạn hôm nay" : `quá hạn ${-days} ngày`;
  return { days, dateLabel, label: `Nộp đề xuất ${dateLabel} · ${rest}`, tone: days < 0 ? "late" : days <= 3 ? "warn" : null };
}

export const OPPORTUNITY_TAB_KEYS = ["tasks", "files", "meetings", "touchpoints", "history"] as const;
export type OpportunityTabKey = typeof OPPORTUNITY_TAB_KEYS[number];
export function opportunityTabs(detail: Pick<OpportunityViewInput, "outcome" | "tasks" | "files" | "meetings">, meetingsEnabled: boolean): { key: OpportunityTabKey; label: string }[] {
  return [
    { key: "tasks" as const, label: `${detail.outcome === "WON" ? "Việc đã chuyển sang Project" : "Việc chuẩn bị thầu"} (${detail.tasks.length})` },
    { key: "files" as const, label: `File (${detail.files.length})` },
    ...(meetingsEnabled ? [{ key: "meetings" as const, label: `Cuộc họp (${detail.meetings.length})` }] : []),
    { key: "touchpoints" as const, label: "Điểm chạm" },
    { key: "history" as const, label: "Lịch sử giai đoạn" },
  ];
}
