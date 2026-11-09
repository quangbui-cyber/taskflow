import { vnDayStartFromKey } from "./dates";
import { OPPORTUNITY_SOURCES } from "./labels";
import { validateOpenOpportunityInput, type OpenOpportunityInput } from "./opportunityStage";
import type { AdvanceOpportunityInput, CloseOpportunityInput } from "./opportunityWorkflow";
import type { WinOpportunityInput } from "./opportunityWin";
import type { EditOpportunityInput, ChangeOpportunityPicInput } from "./opportunityService";

type Result<T> = { ok: true; value: T } | { error: string; fieldErrors: Record<string, string> };
type Raw = Record<string, unknown>;
const record = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 64;
const bad = (fieldErrors: Record<string, string>) => ({ error: Object.values(fieldErrors)[0] ?? "Thông tin Cơ hội không hợp lệ.", fieldErrors });
const good = <T>(value: T): Result<T> => ({ ok: true, value });
function base(raw: unknown): Result<{ input: Raw; opportunityId: string; expectedVersion: number }> {
  if (!record(raw)) return bad({ input: "Thông tin Cơ hội không hợp lệ." });
  if (!id(raw.opportunityId)) return bad({ opportunityId: "Chọn Cơ hội." });
  if (!Number.isSafeInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 0) return bad({ expectedVersion: "Phiên bản dữ liệu không hợp lệ." });
  return good({ input: raw, opportunityId: raw.opportunityId, expectedVersion: raw.expectedVersion as number });
}
export function parseMoneyInput(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s.,]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits); return Number.isSafeInteger(value) ? value : null;
}
export function parseVnDateKey(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  try { return vnDayStartFromKey(raw); } catch { return null; }
}
function moneyFields(input: Raw, output: Raw, errors: Record<string, string>) {
  for (const key of ["budgetMin", "budgetMax"]) {
    if (input[key] === undefined) continue;
    if (input[key] === null || input[key] === "") { output[key] = null; continue; }
    const value = parseMoneyInput(input[key]);
    if (value === null) errors[key] = "Ngân sách dự kiến không hợp lệ."; else output[key] = value;
  }
  if (typeof output.budgetMin === "number" && typeof output.budgetMax === "number" && output.budgetMin > output.budgetMax) errors.budgetMin = "Ngân sách dự kiến không hợp lệ.";
}
function dates(input: Raw, output: Raw, errors: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (input[key] === undefined) continue;
    if (input[key] === null || input[key] === "") { output[key] = null; continue; }
    const value = parseVnDateKey(input[key]);
    if (!value) errors[key] = "Nhập ngày hợp lệ."; else output[key] = value;
  }
}
function texts(input: Raw, output: Raw, errors: Record<string, string>, fields: Record<string, number>) {
  for (const [key, limit] of Object.entries(fields)) {
    if (input[key] === undefined) continue;
    if (input[key] !== null && (typeof input[key] !== "string" || (input[key] as string).trim().length > limit)) errors[key] = "Nội dung không hợp lệ.";
    else output[key] = typeof input[key] === "string" ? input[key].trim() || null : null;
  }
}

export function parseOpenOpportunityPayload(raw: unknown): Result<OpenOpportunityInput> {
  if (!record(raw)) return bad({ input: "Thông tin Cơ hội không hợp lệ." });
  const input = { ...raw }; const errors: Record<string, string> = {};
  moneyFields(raw, input, errors);
  if (Object.keys(errors).length) return bad(errors);
  const parsed = validateOpenOpportunityInput(input);
  return "ok" in parsed ? good(parsed.value) : bad(parsed.errors);
}
export function parseAdvancePayload(raw: unknown): Result<AdvanceOpportunityInput> {
  const b = base(raw); if (!("ok" in b)) return b;
  const { input, opportunityId, expectedVersion } = b.value;
  if (input.to !== "BRIEF" && input.to !== "BIDDING") return bad({ to: "Chỉ chuyển sang stage kế tiếp." });
  const output: Raw = { opportunityId, expectedVersion, to: input.to }; const errors: Record<string, string> = {};
  dates(input, output, errors, ["briefReceivedAt", "proposalDueAt", "proposalPlannedAt"]);
  if (input.to === "BRIEF" && !(output.briefReceivedAt instanceof Date)) errors.briefReceivedAt = "Nhập ngày nhận Brief.";
  moneyFields(input, output, errors); texts(input, output, errors, { briefSummary: 4000, winStrategy: 4000 });
  return Object.keys(errors).length ? bad(errors) : good(output as AdvanceOpportunityInput);
}
export function parseClosePayload(raw: unknown): Result<CloseOpportunityInput> {
  const b = base(raw); if (!("ok" in b)) return b;
  const { input, opportunityId, expectedVersion } = b.value;
  const errors: Record<string, string> = {};
  if (typeof input.outcome !== "string" || !["LOST_COMPETITIVE", "CUSTOMER_CANCELLED", "CS_DECLINED"].includes(input.outcome)) errors.outcome = "Chọn kết quả Cơ hội.";
  if (!id(input.reasonId)) errors.reasonId = "Chọn lý do.";
  const output: Raw = { opportunityId, expectedVersion, outcome: input.outcome, reasonId: input.reasonId };
  texts(input, output, errors, { note: 4000, lessons: 4000 });
  if (input.followUp != null) {
    const follow = input.followUp;
    if (!record(follow) || typeof follow.title !== "string" || !follow.title.trim() || follow.title.trim().length > 500 || !id(follow.assigneeId) || !parseVnDateKey(follow.dueDate)) errors.followUp = "Nhập đủ việc, người làm và hạn tiếp cận lại.";
    else output.followUp = { title: follow.title.trim(), assigneeId: follow.assigneeId, dueDate: parseVnDateKey(follow.dueDate)! };
  }
  return Object.keys(errors).length ? bad(errors) : good(output as CloseOpportunityInput);
}
export function parseWinPayload(raw: unknown): Result<WinOpportunityInput> {
  const b = base(raw); if (!("ok" in b)) return b;
  const { input, opportunityId, expectedVersion } = b.value;
  const errors: Record<string, string> = {}; const contractValue = parseMoneyInput(input.contractValue); const wonAt = parseVnDateKey(input.wonAt);
  if (contractValue === null || contractValue <= 0) errors.contractValue = "Nhập giá trị hợp đồng.";
  if (!wonAt) errors.wonAt = "Nhập ngày thắng hợp lệ.";
  if (typeof input.projectName !== "string" || !input.projectName.trim() || input.projectName.trim().length > 200) errors.projectName = "Nhập tên Project từ 1 đến 200 ký tự.";
  return Object.keys(errors).length ? bad(errors) : good({ opportunityId, expectedVersion, contractValue: contractValue!, wonAt: wonAt!, projectName: (input.projectName as string).trim() });
}
export function parseEditPayload(raw: unknown): Result<EditOpportunityInput> {
  const b = base(raw); if (!("ok" in b)) return b;
  const { input, opportunityId, expectedVersion } = b.value; const errors: Record<string, string> = {};
  const output: Raw = { opportunityId, expectedVersion };
  texts(input, output, errors, { name: 200, demandSignal: 2000, confirmReason: 2000, briefSummary: 4000, winStrategy: 4000 });
  for (const key of ["name", "demandSignal"]) if (input[key] !== undefined && !output[key]) errors[key] = key === "name" ? "Nhập tên Cơ hội." : "Nhập tín hiệu nhu cầu.";
  if (input.programTypeCode !== undefined) { if (typeof input.programTypeCode !== "string" || !/^[A-Z][A-Z0-9_]{1,31}$/.test(input.programTypeCode)) errors.programTypeCode = "Chọn loại chương trình."; else output.programTypeCode = input.programTypeCode; }
  if (input.source !== undefined) { if (!OPPORTUNITY_SOURCES.some((s) => s.key === input.source)) errors.source = "Chọn nguồn Cơ hội."; else output.source = input.source; }
  if (input.buyingUnitId !== undefined) { if (input.buyingUnitId !== null && !id(input.buyingUnitId)) errors.buyingUnitId = "Chọn đơn vị mua."; else output.buyingUnitId = input.buyingUnitId; }
  for (const [key, max] of [["expectedYear", 2200], ["expectedMonth", 12], ["expectedQuarter", 4]] as const) {
    if (input[key] === undefined) continue;
    const value = input[key];
    if (value === null && key !== "expectedYear") output[key] = null;
    else if (!Number.isInteger(value) || Number(value) < (key === "expectedYear" ? 1900 : 1) || Number(value) > max) errors[key] = "Nhập thời gian dự kiến hợp lệ.";
    else output[key] = value;
  }
  if (typeof output.expectedMonth === "number" && typeof output.expectedQuarter === "number") errors.expectedMonth = "Nhập tháng hoặc quý dự kiến.";
  moneyFields(input, output, errors); dates(input, output, errors, ["proposalDueAt", "proposalPlannedAt"]);
  if (Object.keys(output).length === 2) errors.input = "Chọn thông tin cần sửa.";
  return Object.keys(errors).length ? bad(errors) : good(output as EditOpportunityInput);
}
export function parseChangePicPayload(raw: unknown): Result<ChangeOpportunityPicInput> {
  const b = base(raw); if (!("ok" in b)) return b;
  const { input, opportunityId, expectedVersion } = b.value;
  if (!id(input.picAccountId)) return bad({ picAccountId: "Chọn PIC." });
  if (input.responsibleTeamId != null && !id(input.responsibleTeamId)) return bad({ responsibleTeamId: "Chọn team phụ trách." });
  return good({ opportunityId, expectedVersion, picAccountId: input.picAccountId, responsibleTeamId: (input.responsibleTeamId as string | null | undefined) ?? null });
}
