import { addDaysToKey, weekdayIndexOfKey } from "../meetingCalendar";
import { vnDayStartFromKey } from "./dates";
import { TOUCHPOINT_KINDS } from "./labels";
import type { ClientLifecycle } from "./clientLifecycle";
import type { TierValue } from "./settingsSchema";

/** crm52: pure rules for care campaigns. No database access, no provider calls. */
export const CAMPAIGN_MAX_STEPS = 6;
export const CAMPAIGN_MAX_CLIENTS = 200;
export const CAMPAIGN_MAX_OFFSET = 180;
export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "DONE", "CANCELLED"] as const;
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = { DRAFT: "Bản nháp", ACTIVE: "Đang chạy", PAUSED: "Tạm dừng", DONE: "Đã xong", CANCELLED: "Đã hủy" };
export const CAMPAIGN_STATUS_CLASS: Record<CampaignStatus, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600", ACTIVE: "bg-brand-100 text-brand-800", PAUSED: "bg-amber-100 text-amber-800", DONE: "bg-sky-50 text-sky-700", CANCELLED: "bg-zinc-100 text-zinc-500",
};
export const CAMPAIGN_STOPPED_OPPORTUNITY = "CAMPAIGN_STOPPED_OPPORTUNITY";
export const CAMPAIGN_CANCELLED = "CAMPAIGN_CANCELLED";
export const CAMPAIGN_MERGED_DUPLICATE = "CAMPAIGN_MERGED_DUPLICATE";

export type TouchpointKindKey = typeof TOUCHPOINT_KINDS[number]["key"];
export type CampaignStep = { offsetDays: number; title: string; kind: TouchpointKindKey };
export type CampaignOptions = { stopOnOpportunity: boolean; skipBidding: boolean; pauseCadence: boolean };
export const DEFAULT_CAMPAIGN_OPTIONS: CampaignOptions = { stopOnOpportunity: true, skipBidding: true, pauseCadence: true };
export type CampaignFilter = {
  tiers: TierValue[]; lifecycles: ClientLifecycle[]; tagIds: string[]; industries: string[]; teamIds: string[];
  picAccountIds: string[]; seasonMonths: number[]; include: string[]; exclude: string[];
};
export const EMPTY_CAMPAIGN_FILTER: CampaignFilter = { tiers: [], lifecycles: [], tagIds: [], industries: [], teamIds: [], picAccountIds: [], seasonMonths: [], include: [], exclude: [] };
export type CampaignAssignments = Record<string, string>;

const TIERS: readonly TierValue[] = ["S", "A", "B", "C", "UNRATED"];
const LIFECYCLES: readonly ClientLifecycle[] = ["PROSPECT", "ACTIVE", "DORMANT", "ARCHIVED"];
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const safeId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) && !["__proto__", "constructor", "prototype"].includes(v);
const cleanText = (v: string) => v.normalize("NFKC").trim().replace(/\s+/g, " ");
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));

export function parseCampaignSteps(value: unknown): CampaignStep[] | null {
  if (!Array.isArray(value) || value.length > CAMPAIGN_MAX_STEPS) return null;
  const steps: CampaignStep[] = [];
  for (const raw of value) {
    if (!record(raw) || !exactKeys(raw, ["offsetDays", "title", "kind"])) return null;
    const { offsetDays, title, kind } = raw;
    if (typeof offsetDays !== "number" || !Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > CAMPAIGN_MAX_OFFSET) return null;
    if (typeof title !== "string" || !cleanText(title) || cleanText(title).length > 200) return null;
    if (!TOUCHPOINT_KINDS.some((k) => k.key === kind)) return null;
    steps.push({ offsetDays, title: cleanText(title), kind: kind as TouchpointKindKey });
  }
  return steps;
}

export function parseCampaignOptions(value: unknown): CampaignOptions | null {
  if (!record(value) || !exactKeys(value, ["stopOnOpportunity", "skipBidding", "pauseCadence"])) return null;
  const { stopOnOpportunity, skipBidding, pauseCadence } = value;
  if (![stopOnOpportunity, skipBidding, pauseCadence].every((b) => typeof b === "boolean")) return null;
  return { stopOnOpportunity: stopOnOpportunity as boolean, skipBidding: skipBidding as boolean, pauseCadence: pauseCadence as boolean };
}

const idList = (v: unknown, max: number): string[] | null => Array.isArray(v) && v.length <= max && v.every(safeId) ? [...new Set(v as string[])] : null;
export function parseCampaignFilter(value: unknown): CampaignFilter | null {
  if (!record(value)) return null;
  const tiers = value.tiers, lifecycles = value.lifecycles, months = value.seasonMonths, industries = value.industries;
  if (!Array.isArray(tiers) || !tiers.every((t) => TIERS.includes(t as TierValue))) return null;
  if (!Array.isArray(lifecycles) || !lifecycles.every((l) => LIFECYCLES.includes(l as ClientLifecycle))) return null;
  if (!Array.isArray(months) || !months.every((m) => Number.isInteger(m) && (m as number) >= 1 && (m as number) <= 12)) return null;
  if (!Array.isArray(industries) || industries.length > 50 || !industries.every((i) => typeof i === "string" && !!i.trim() && i.length <= 120)) return null;
  const tagIds = idList(value.tagIds, 50), teamIds = idList(value.teamIds, 50), picAccountIds = idList(value.picAccountIds, 100);
  const include = idList(value.include, 2 * CAMPAIGN_MAX_CLIENTS), exclude = idList(value.exclude, 2 * CAMPAIGN_MAX_CLIENTS);
  if (!tagIds || !teamIds || !picAccountIds || !include || !exclude) return null;
  return { tiers: [...new Set(tiers as TierValue[])], lifecycles: [...new Set(lifecycles as ClientLifecycle[])], tagIds, industries: [...new Set(industries as string[])], teamIds, picAccountIds, seasonMonths: [...new Set(months as number[])].sort((a, b) => a - b), include, exclude };
}

export function parseCampaignAssignments(value: unknown): CampaignAssignments | null {
  if (!record(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > CAMPAIGN_MAX_CLIENTS * 2 || !entries.every(([k, v]) => safeId(k) && safeId(v))) return null;
  return Object.fromEntries(entries) as CampaignAssignments;
}

/** CrmSetting `campaign.weeklyLoadWarn`: unset (null) means no warning; no number is assumed. */
export function parseWeeklyLoadWarn(value: unknown): { perWeek: number | null } | null {
  if (!record(value) || !exactKeys(value, ["perWeek"])) return null;
  const n = value.perWeek;
  if (n === null) return { perWeek: null };
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 200 ? { perWeek: n } : null;
}

export type CampaignCandidate = {
  id: string; name: string; tier: TierValue; lifecycle: ClientLifecycle; archived: boolean; tagIds: string[]; industry: string | null;
  teamId: string | null; picAccountId: string | null; seasonMonths: number[]; bidding: boolean;
};
/** allowed: active user who may use CRM now (crm54). */
export type CampaignPic = { accountId: string; userId: string | null; name: string; teamId: string | null; allowed: boolean };
export type ExcludeReason = "ARCHIVED" | "OTHER_TEAM" | "BIDDING" | "NO_PIC" | "PIC_NOT_ALLOWED";
export const EXCLUDE_REASON_LABELS: Record<ExcludeReason, string> = { ARCHIVED: "Đang lưu trữ", OTHER_TEAM: "Khách team khác", BIDDING: "Đang Bidding", NO_PIC: "Chưa có PIC", PIC_NOT_ALLOWED: "PIC chưa được mở CRM" };
export type CampaignTarget = { clientId: string; name: string; picAccountId: string; picUserId: string; picName: string; reassigned: boolean };
export type CampaignSelection = { matched: number; removed: number; added: number; targets: CampaignTarget[]; excluded: { clientId: string; name: string; reason: ExcludeReason }[]; overLimit: boolean };

function matches(c: CampaignCandidate, f: CampaignFilter): boolean {
  const criteria = [f.tiers, f.lifecycles, f.tagIds, f.industries, f.teamIds, f.picAccountIds, f.seasonMonths];
  if (criteria.every((list) => !list.length)) return false;
  if (f.tiers.length && !f.tiers.includes(c.tier)) return false;
  if (f.lifecycles.length && !f.lifecycles.includes(c.lifecycle)) return false;
  if (f.tagIds.length && !f.tagIds.some((t) => c.tagIds.includes(t))) return false;
  if (f.industries.length && !(c.industry && f.industries.includes(c.industry))) return false;
  if (f.teamIds.length && !(c.teamId && f.teamIds.includes(c.teamId))) return false;
  if (f.picAccountIds.length && !(c.picAccountId && f.picAccountIds.includes(c.picAccountId))) return false;
  if (f.seasonMonths.length && !f.seasonMonths.some((m) => c.seasonMonths.includes(m))) return false;
  return true;
}

export function selectCampaignClients(candidates: CampaignCandidate[], filter: CampaignFilter, ctx: { teamId: string | null; skipBidding: boolean; pics: CampaignPic[]; assignments: CampaignAssignments }): CampaignSelection {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const pics = new Map(ctx.pics.map((p) => [p.accountId, p]));
  const matchedIds = candidates.filter((c) => !c.archived && matches(c, filter)).map((c) => c.id);
  const matchedSet = new Set(matchedIds);
  const exclude = new Set(filter.exclude);
  const removed = matchedIds.filter((id) => exclude.has(id)).length;
  const addedIds = filter.include.filter((id) => byId.has(id) && !matchedSet.has(id) && !exclude.has(id));
  const pool = [...matchedIds.filter((id) => !exclude.has(id)), ...addedIds].map((id) => byId.get(id)!)
    .sort((a, b) => a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id));
  const targets: CampaignTarget[] = [];
  const excluded: CampaignSelection["excluded"] = [];
  for (const c of pool) {
    const reject = (reason: ExcludeReason) => excluded.push({ clientId: c.id, name: c.name, reason });
    if (c.archived) { reject("ARCHIVED"); continue; }
    if (ctx.teamId && c.teamId !== ctx.teamId) { reject("OTHER_TEAM"); continue; }
    if (ctx.skipBidding && c.bidding) { reject("BIDDING"); continue; }
    const override = ctx.assignments[c.id];
    const overridePic = override ? pics.get(override) : undefined;
    const useOverride = !!overridePic?.allowed && !!overridePic.userId && overridePic.accountId !== c.picAccountId;
    const pic = useOverride ? overridePic : c.picAccountId ? pics.get(c.picAccountId) : undefined;
    if (!pic) { reject(c.picAccountId ? "PIC_NOT_ALLOWED" : "NO_PIC"); continue; }
    if (!pic.allowed || !pic.userId) { reject("PIC_NOT_ALLOWED"); continue; }
    targets.push({ clientId: c.id, name: c.name, picAccountId: pic.accountId, picUserId: pic.userId, picName: pic.name, reassigned: useOverride });
  }
  return { matched: matchedIds.length, removed, added: addedIds.length, targets, excluded, overLimit: targets.length > CAMPAIGN_MAX_CLIENTS };
}

export function launchBlockers(input: { steps: CampaignStep[]; targets: number }): string[] {
  const out: string[] = [];
  if (!input.steps.length) out.push("Thêm ít nhất một bước chăm sóc.");
  if (!input.targets) out.push("Chọn ít nhất một khách có PIC được mở CRM.");
  if (input.targets > CAMPAIGN_MAX_CLIENTS) out.push(`Mỗi chiến dịch tối đa ${CAMPAIGN_MAX_CLIENTS} khách.`);
  return out;
}

export function scheduleCampaign(startKey: string, steps: CampaignStep[]): (CampaignStep & { stepIndex: number; dueKey: string; dueDate: Date })[] {
  return steps.map((step, stepIndex) => {
    const dueKey = addDaysToKey(startKey, step.offsetDays);
    return { ...step, stepIndex, dueKey, dueDate: vnDayStartFromKey(dueKey) };
  });
}
export function campaignEndKey(startKey: string, steps: CampaignStep[]): string {
  return addDaysToKey(startKey, Math.max(0, ...steps.map((s) => s.offsetDays)));
}

export function isoWeekKey(dateKey: string): string {
  const thursdayKey = addDaysToKey(dateKey, 3 - weekdayIndexOfKey(dateKey));
  const thursday = new Date(`${thursdayKey}T00:00:00Z`);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / 86400000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

type LoadItem = { userId: string; dateKey: string };
export type LoadCell = { week: string; existing: number; planned: number; total: number; over: boolean };
export type WeeklyLoad = { weeks: string[]; rows: { userId: string; cells: LoadCell[] }[]; warnings: { userId: string; week: string; total: number }[] };
/** Weeks are the ISO weeks the campaign touches; existing open CRM work counts only in those weeks. */
export function weeklyLoad(input: { planned: LoadItem[]; existing: LoadItem[]; threshold: number | null; userIds?: string[] }): WeeklyLoad {
  const weeks = [...new Set(input.planned.map((p) => isoWeekKey(p.dateKey)))].sort();
  const users = [...new Set([...input.planned.map((p) => p.userId), ...(input.userIds ?? [])])].sort();
  const count = (items: LoadItem[], userId: string, week: string) => items.filter((i) => i.userId === userId && isoWeekKey(i.dateKey) === week).length;
  const rows = users.map((userId) => ({ userId, cells: weeks.map((week) => {
    const existing = count(input.existing, userId, week), planned = count(input.planned, userId, week);
    const total = existing + planned;
    return { week, existing, planned, total, over: input.threshold !== null && total > input.threshold };
  }) }));
  const warnings = rows.flatMap((r) => r.cells.filter((c) => c.over).map((c) => ({ userId: r.userId, week: c.week, total: c.total })));
  return { weeks, rows, warnings };
}

export type LoadSuggestion =
  | { kind: "MOVE"; fromAccountId: string; toAccountId: string; toName: string; week: string; clientIds: string[] }
  | { kind: "STRETCH"; stepIndex: number; addDays: number; week: string };
/** Suggestions only; the user chooses whether to apply them. */
export function suggestLoadFixes(input: { warnings: WeeklyLoad["warnings"]; rows: WeeklyLoad["rows"]; threshold: number | null; targets: CampaignTarget[]; steps: CampaignStep[]; startKey: string; allowedPics: CampaignPic[] }): LoadSuggestion[] {
  if (input.threshold === null || !input.warnings.length) return [];
  const threshold = input.threshold;
  const scheduled = scheduleCampaign(input.startKey, input.steps);
  const out: LoadSuggestion[] = [];
  const seen = new Set<string>();
  const totalFor = (userId: string, week: string) => input.rows.find((r) => r.userId === userId)?.cells.find((c) => c.week === week)?.total ?? 0;
  for (const warning of input.warnings) {
    const inWeek = scheduled.filter((s) => isoWeekKey(s.dueKey) === warning.week);
    if (!inWeek.length) continue;
    const overflow = warning.total - threshold;
    const mine = input.targets.filter((t) => t.picUserId === warning.userId);
    if (!mine.length) continue;
    const moveCount = Math.ceil(overflow / inWeek.length);
    const destination = input.allowedPics.filter((p) => p.allowed && p.userId && p.userId !== warning.userId)
      .map((p) => ({ pic: p, total: totalFor(p.userId!, warning.week) }))
      .filter((d) => d.total + moveCount * inWeek.length <= threshold)
      .sort((a, b) => a.total - b.total || a.pic.name.localeCompare(b.pic.name, "vi"))[0];
    if (destination && mine.length && moveCount <= mine.length) {
      const key = `MOVE:${warning.userId}:${warning.week}`;
      if (!seen.has(key)) { seen.add(key); out.push({ kind: "MOVE", fromAccountId: mine[0].picAccountId, toAccountId: destination.pic.accountId, toName: destination.pic.name, week: warning.week, clientIds: mine.slice(-moveCount).map((t) => t.clientId) }); }
    }
    const step = inWeek[inWeek.length - 1];
    const addDays = 7 - weekdayIndexOfKey(step.dueKey);
    const key = `STRETCH:${step.stepIndex}`;
    if (step.offsetDays + addDays <= CAMPAIGN_MAX_OFFSET && !seen.has(key)) { seen.add(key); out.push({ kind: "STRETCH", stepIndex: step.stepIndex, addDays, week: warning.week }); }
  }
  return out;
}

export type CampaignPlanResult = {
  tasks: { clientId: string; stepIndex: number; userId: string; dueKey: string; dueDate: Date; title: string }[];
  load: WeeklyLoad; suggestions: LoadSuggestion[];
};
export function planCampaign(input: { startKey: string; steps: CampaignStep[]; targets: CampaignTarget[]; existing: LoadItem[]; threshold: number | null; allowedPics: CampaignPic[] }): CampaignPlanResult {
  const scheduled = scheduleCampaign(input.startKey, input.steps);
  const tasks = input.targets.flatMap((t) => scheduled.map((s) => ({ clientId: t.clientId, stepIndex: s.stepIndex, userId: t.picUserId, dueKey: s.dueKey, dueDate: s.dueDate, title: s.title })));
  const load = weeklyLoad({ planned: tasks.map((t) => ({ userId: t.userId, dateKey: t.dueKey })), existing: input.existing, threshold: input.threshold,
    userIds: input.allowedPics.flatMap((p) => p.allowed && p.userId ? [p.userId] : []) });
  const suggestions = suggestLoadFixes({ warnings: load.warnings, rows: load.rows, threshold: input.threshold, targets: input.targets, steps: input.steps, startKey: input.startKey, allowedPics: input.allowedPics });
  return { tasks, load, suggestions };
}

export type CampaignDraft = {
  name: string; goal: string | null; targetOpportunities: number | null; startKey: string; endKey: string | null;
  steps: CampaignStep[]; options: CampaignOptions; filter: CampaignFilter; assignments: CampaignAssignments; teamId: string | null;
};
const validKey = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try { vnDayStartFromKey(v); return true; } catch { return false; }
};
export function validateCampaignDraft(raw: unknown): { ok: true; value: CampaignDraft } | { errors: Record<string, string> } {
  const input = record(raw) ? raw : {};
  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? cleanText(input.name) : "";
  if (!name || name.length > 120) errors.name = "Nhập tên chiến dịch (tối đa 120 ký tự).";
  const goal = input.goal == null ? null : typeof input.goal === "string" ? cleanText(input.goal) || null : undefined;
  if (goal === undefined || (goal && goal.length > 500)) errors.goal = "Mục tiêu tối đa 500 ký tự.";
  const target = input.targetOpportunities;
  if (target !== null && target !== undefined && !(typeof target === "number" && Number.isInteger(target) && target >= 0 && target <= 500)) errors.targetOpportunities = "Số Cơ hội mục tiêu không hợp lệ.";
  if (!validKey(input.startKey)) errors.startKey = "Chọn ngày bắt đầu.";
  const steps = parseCampaignSteps(input.steps);
  if (!steps) errors.steps = `Tối đa ${CAMPAIGN_MAX_STEPS} bước, mỗi bước N+0 đến N+${CAMPAIGN_MAX_OFFSET} ngày, có nội dung và loại điểm chạm.`;
  const endKey = input.endKey == null || input.endKey === "" ? null : input.endKey;
  if (endKey !== null && !validKey(endKey)) errors.endKey = "Ngày kết thúc không hợp lệ.";
  else if (endKey && validKey(input.startKey) && steps && endKey < campaignEndKey(input.startKey, steps)) errors.endKey = "Ngày kết thúc phải sau bước cuối.";
  const options = parseCampaignOptions(input.options);
  if (!options) errors.options = "Tùy chọn không hợp lệ.";
  const filter = parseCampaignFilter(input.filter);
  if (!filter) errors.filter = "Bộ lọc khách không hợp lệ.";
  const assignments = parseCampaignAssignments(input.assignments ?? {});
  if (!assignments) errors.assignments = "Phân công không hợp lệ.";
  const teamId = input.teamId ?? null;
  if (teamId !== null && !safeId(teamId)) errors.teamId = "Team không hợp lệ.";
  if (Object.keys(errors).length) return { errors };
  return { ok: true, value: { name, goal: goal ?? null, targetOpportunities: (target as number | null | undefined) ?? null, startKey: input.startKey as string, endKey: endKey as string | null, steps: steps!, options: options!, filter: filter!, assignments: assignments!, teamId: teamId as string | null } };
}

/** Suggested plans, created in the database only when an Admin adds them. Gift steps record the task only, never a value (G-LEGAL). */
export const SUGGESTED_CAMPAIGN_TEMPLATES: { name: string; description: string; steps: CampaignStep[] }[] = [
  { name: "Mùa YEP", description: "Đón ngân sách tiệc cuối năm", steps: [
    { offsetDays: 0, title: "Gửi email gợi ý concept YEP kèm 2 case study", kind: "MESSAGE" },
    { offsetDays: 5, title: "Gọi hỏi kế hoạch YEP, ngân sách, thời điểm chốt", kind: "CALL" },
    { offsetDays: 12, title: "Hẹn gặp trình bày nếu có nhu cầu", kind: "MEETING" },
  ] },
  { name: "Chúc Tết", description: "Thiệp, gọi chúc", steps: [
    { offsetDays: 0, title: "Gửi thiệp chúc Tết", kind: "GIFT" },
    { offsetDays: 3, title: "Gọi chúc Tết và hỏi kế hoạch năm mới", kind: "CALL" },
  ] },
  { name: "Gửi hồ sơ năng lực", description: "Profile và case study mới", steps: [
    { offsetDays: 0, title: "Gửi hồ sơ năng lực và case study mới", kind: "CASE" },
    { offsetDays: 7, title: "Gọi hỏi phản hồi về hồ sơ", kind: "CALL" },
  ] },
  { name: "Sau sự kiện", description: "Nghiệm thu, feedback, xin case study", steps: [
    { offsetDays: 0, title: "Gửi biên bản nghiệm thu và hình ảnh", kind: "MESSAGE" },
    { offsetDays: 3, title: "Gọi lấy feedback sau sự kiện", kind: "CALL" },
    { offsetDays: 10, title: "Xin phép dùng làm case study", kind: "MESSAGE" },
  ] },
];
