import { OPPORTUNITY_SOURCES, OPPORTUNITY_STAGES } from "./labels";

type Current = { stage: string; outcome: string | null };
export function canAdvance(current: Current, to: "BRIEF" | "BIDDING"): boolean {
  return current.outcome === null && ((current.stage === "CARE" && to === "BRIEF") || (current.stage === "BRIEF" && to === "BIDDING"));
}
export function canClose(current: Current, outcome: string): boolean {
  if (current.outcome !== null || !OPPORTUNITY_STAGES.some((stage) => stage.key === current.stage)) return false;
  return outcome === "CUSTOMER_CANCELLED" || outcome === "CS_DECLINED" || ((outcome === "WON" || outcome === "LOST_COMPETITIVE") && current.stage === "BIDDING");
}
export function defaultOpportunityName(programLabel: string, year: number): string { return `${programLabel.trim()} ${year}`; }

export type OpenOpportunityInput = {
  clientId: string;
  programTypeCode: string;
  expectedYear: number;
  expectedMonth: number | null;
  expectedQuarter: number | null;
  source: string;
  demandSignal: string;
  name: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  buyingUnitId: string | null;
  picAccountId: string | null;
  responsibleTeamId: string | null;
  expectedEventId: string | null;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && !!value && value.length <= 64;
export const validOpportunityMoney = (value: unknown): value is number | null | undefined => value === null || value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

export function validateOpenOpportunityInput(raw: unknown): { ok: true; value: OpenOpportunityInput } | { errors: Record<string, string> } {
  const input = record(raw) ? raw : {};
  const errors: Record<string, string> = {};
  if (!validId(input.clientId)) errors.clientId = "Chọn khách hàng.";
  if (typeof input.programTypeCode !== "string" || !/^[A-Z][A-Z0-9_]{1,31}$/.test(input.programTypeCode)) errors.programTypeCode = "Chọn loại chương trình.";
  if (typeof input.expectedYear !== "number" || !Number.isInteger(input.expectedYear) || input.expectedYear < 1900 || input.expectedYear > 2200) errors.expectedYear = "Nhập năm dự kiến hợp lệ.";
  const hasMonth = input.expectedMonth !== null && input.expectedMonth !== undefined;
  const hasQuarter = input.expectedQuarter !== null && input.expectedQuarter !== undefined;
  if (hasMonth === hasQuarter || (hasMonth && (typeof input.expectedMonth !== "number" || !Number.isInteger(input.expectedMonth) || input.expectedMonth < 1 || input.expectedMonth > 12)) || (hasQuarter && (typeof input.expectedQuarter !== "number" || !Number.isInteger(input.expectedQuarter) || input.expectedQuarter < 1 || input.expectedQuarter > 4))) errors.expectedMonth = "Nhập tháng hoặc quý dự kiến.";
  if (typeof input.demandSignal !== "string" || !input.demandSignal.trim()) errors.demandSignal = "Nhập tín hiệu nhu cầu.";
  else if (input.demandSignal.trim().length > 2000) errors.demandSignal = "Tín hiệu nhu cầu tối đa 2000 ký tự.";
  if (!OPPORTUNITY_SOURCES.some((source) => source.key === input.source)) errors.source = "Chọn nguồn Cơ hội.";
  if (input.name !== undefined && input.name !== null && (typeof input.name !== "string" || input.name.trim().length > 200)) errors.name = "Tên Cơ hội tối đa 200 ký tự.";
  if (!validOpportunityMoney(input.budgetMin) || !validOpportunityMoney(input.budgetMax) || (typeof input.budgetMin === "number" && typeof input.budgetMax === "number" && input.budgetMin > input.budgetMax)) errors.budgetMin = "Ngân sách dự kiến không hợp lệ.";
  for (const key of ["buyingUnitId", "picAccountId", "responsibleTeamId", "expectedEventId"] as const) if (input[key] !== null && input[key] !== undefined && !validId(input[key])) errors[key] = "Lựa chọn không hợp lệ.";
  if (Object.keys(errors).length) return { errors };
  return { ok: true, value: {
    clientId: input.clientId as string, programTypeCode: input.programTypeCode as string, expectedYear: input.expectedYear as number,
    expectedMonth: (input.expectedMonth as number | undefined) ?? null, expectedQuarter: (input.expectedQuarter as number | undefined) ?? null,
    source: input.source as string, demandSignal: (input.demandSignal as string).trim(), name: typeof input.name === "string" ? input.name.trim() || null : null,
    budgetMin: (input.budgetMin as number | undefined) ?? null, budgetMax: (input.budgetMax as number | undefined) ?? null,
    buyingUnitId: (input.buyingUnitId as string | undefined) ?? null, picAccountId: (input.picAccountId as string | undefined) ?? null,
    responsibleTeamId: (input.responsibleTeamId as string | undefined) ?? null, expectedEventId: (input.expectedEventId as string | undefined) ?? null,
  } };
}
