import { canClose } from "./opportunityStage";
import { parseThousandsInput } from "./opportunityFormat";
import { vnDayStartFromKey } from "./dates";

export type OpportunityStage = "CARE" | "BRIEF" | "BIDDING";
export type OutcomeChoice = "WON" | "LOST_COMPETITIVE" | "CUSTOMER_CANCELLED" | "CS_DECLINED";
export type ReasonGroup = "LOST" | "CANCELLED" | "DECLINED";
export type OutcomeReasons = Record<ReasonGroup, { id: string; label: string; requiresNote: boolean }[]>;
export type StageForm = { briefReceivedAt?: string; proposalDueAt?: string; budgetMin?: string; budgetMax?: string; briefSummary?: string; winStrategy?: string; proposalPlannedAt?: string };
export type OutcomeForm = {
  outcome: OutcomeChoice | null; contractValue: string; wonAt: string; projectName: string; reasonId: string; note: string; lessons: string;
  followUp: boolean; followUpTitle: string; assigneeId: string | null; dueDate: string;
};
export function allowedOutcomes(stage: OpportunityStage, outcome: string | null): OutcomeChoice[] {
  return (["WON", "LOST_COMPETITIVE", "CUSTOMER_CANCELLED", "CS_DECLINED"] as const).filter(choice => canClose({ stage, outcome }, choice));
}
export function reasonGroupFor(outcome: OutcomeChoice | null): ReasonGroup | null {
  return outcome === "LOST_COMPETITIVE" ? "LOST" : outcome === "CUSTOMER_CANCELLED" ? "CANCELLED" : outcome === "CS_DECLINED" ? "DECLINED" : null;
}
function validDay(key: string | undefined) { try { vnDayStartFromKey(key ?? ""); return true; } catch { return false; } }
export function validateStageForm(to: "BRIEF" | "BIDDING", s: StageForm, todayKey: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (to === "BRIEF") {
    if (!validDay(s.briefReceivedAt)) errors.briefReceivedAt = "Nhập ngày nhận Brief.";
    else if (s.briefReceivedAt! > todayKey) errors.briefReceivedAt = "Ngày nhận Brief không được sau hôm nay.";
    for (const key of ["budgetMin", "budgetMax"] as const) if (s[key] && parseThousandsInput(s[key]!) === null) errors[key] = "Ngân sách dự kiến không hợp lệ.";
    const min = parseThousandsInput(s.budgetMin ?? ""); const max = parseThousandsInput(s.budgetMax ?? "");
    if (min !== null && max !== null && min > max) errors.budgetMin = "Ngân sách từ phải nhỏ hơn hoặc bằng ngân sách đến.";
  }
  const date = to === "BRIEF" ? "proposalDueAt" : "proposalPlannedAt";
  if (s[date] && !validDay(s[date])) errors[date] = "Nhập ngày hợp lệ.";
  return errors;
}
export function validateOutcomeForm(s: OutcomeForm, reasons: OutcomeReasons, todayKey: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!s.outcome) return { outcome: "Chọn kết quả." };
  if (s.outcome === "WON") {
    if ((parseThousandsInput(s.contractValue) ?? 0) <= 0) errors.contractValue = "Nhập giá trị hợp đồng.";
    if (!validDay(s.wonAt) || s.wonAt > todayKey) errors.wonAt = "Chọn ngày thắng không sau hôm nay.";
    if (!s.projectName.trim()) errors.projectName = "Nhập tên Project.";
  } else {
    const reason = reasons[reasonGroupFor(s.outcome)!].find(r => r.id === s.reasonId);
    if (!reason) errors.reasonId = "Chọn lý do.";
    else if (reason.requiresNote && !s.note.trim()) errors.note = "Ghi chú cho lý do Khác.";
    if (s.followUp) {
      if (!s.followUpTitle.trim() || !validDay(s.dueDate)) errors.followUp = "Nhập việc cần làm và hạn.";
      if (!s.assigneeId) errors.assigneeId = "Chọn người làm đang hoạt động.";
    }
  }
  return errors;
}
const money = (value: string | undefined) => value ? String(parseThousandsInput(value)) : null;
export function buildAdvancePayload(opportunityId: string, version: number, to: "BRIEF" | "BIDDING", s: StageForm) {
  const base = { opportunityId, expectedVersion: version, to };
  return to === "BRIEF"
    ? { ...base, briefReceivedAt: s.briefReceivedAt, proposalDueAt: s.proposalDueAt || null, budgetMin: money(s.budgetMin), budgetMax: money(s.budgetMax), briefSummary: s.briefSummary?.trim() || null }
    : { ...base, winStrategy: s.winStrategy?.trim() || null, proposalPlannedAt: s.proposalPlannedAt || null };
}
export function buildClosePayload(opportunityId: string, version: number, s: OutcomeForm) {
  return { opportunityId, expectedVersion: version, outcome: s.outcome, reasonId: s.reasonId, note: s.note.trim() || null, lessons: s.outcome === "LOST_COMPETITIVE" ? s.lessons.trim() || null : null,
    ...(s.followUp ? { followUp: { title: s.followUpTitle.trim(), assigneeId: s.assigneeId, dueDate: s.dueDate } } : {}),
  };
}
export function buildWinPayload(opportunityId: string, version: number, s: OutcomeForm) {
  return { opportunityId, expectedVersion: version, contractValue: money(s.contractValue), wonAt: s.wonAt, projectName: s.projectName.trim() };
}
export function outcomeFooterLines(outcome: OutcomeChoice | null, openBidPrepTaskCount: number, preview: { tasks: number; files: number; meetings: number } | null): string[] {
  if (outcome === null) return [];
  const lines: string[] = [];
  if (outcome === "WON" && preview) lines.push(`Chuyển sang Project: ${preview.tasks} việc · ${preview.files} file · ${preview.meetings} cuộc họp`);
  else if (outcome !== "WON" && openBidPrepTaskCount > 0) lines.push(`${openBidPrepTaskCount} việc chuẩn bị thầu đang mở sẽ đóng.`);
  return [...lines, "Cơ hội đã kết thúc không mở lại được."];
}
