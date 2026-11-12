import { vietnamYearMonth } from "../kpi";
import { nextCadenceDueDate } from "./cadence";
import { describeClientFieldChange, normalizeWebsite } from "./clientProfile";
import { isRecognizedProject } from "./clientLifecycle";
import { formatCrmDate, vnDateKey, vnDayStart, vnDayStartFromKey } from "./dates";
import { PLAYBOOK_FIELD_LABELS, PLAYBOOK_SECTIONS, PLAYBOOK_TEXT_MAX, QUOTES_MAX, VENDOR_STATUSES, type PlaybookField, type PlaybookSection } from "./clientHubLabels";
export { PLAYBOOK_FIELD_LABELS, PLAYBOOK_SECTIONS, PLAYBOOK_TEXT_MAX, QUOTES_MAX, VENDOR_STATUSES, type PlaybookField, type PlaybookSection, type VendorStatus } from "./clientHubLabels";

/** crm53: pure helpers for the client hub. No AI, no guessing: a clause without data is dropped. */
const DAY = 86400000;
const dayDiff = (from: Date, to: Date) => Math.round((vnDayStart(to).getTime() - vnDayStart(from).getTime()) / DAY);
const monthYear = (date: Date) => { const [y, m] = vnDateKey(date).split("-"); return `${m}/${y}`; };
const dmy = (key: string) => { const [y, m, d] = key.split("-"); return `${d}/${m}/${y}`; };

export function formatShortVnd(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "0";
  const fmt = (value: number, digits: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(value);
  if (Math.abs(amount) >= 1e9) return `${fmt(amount / 1e9, 1)} tỷ`;
  if (Math.abs(amount) >= 1e6) return `${fmt(amount / 1e6, 0)} tr`;
  return fmt(amount, 0);
}

// ---- Tóm tắt đầu trang ----
export type SummaryPart = { text: string; strong?: boolean };
export type Season = { programLabel: string; month: number };
export const vendorStatusLabel = (key: string | null) => VENDOR_STATUSES.find((item) => item.key === key)?.label ?? null;

/** Most frequent program for each of the first two persona months (persona already orders months by frequency). */
export function typicalSeasons(projects: { type: string; executionStartAt: Date | null }[], typicalMonths: number[], programLabels: Record<string, string>): Season[] {
  return typicalMonths.slice(0, 2).flatMap((month) => {
    const counts = new Map<string, number>();
    for (const project of projects) if (project.executionStartAt && vietnamYearMonth(project.executionStartAt).month === month) counts.set(project.type, (counts.get(project.type) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return top ? [{ programLabel: programLabels[top[0]] ?? top[0], month }] : [];
  });
}

export type SummaryInput = {
  sinceYear: number; projectCount: number; revenue24m: number; showRevenue: boolean; seasons: Season[];
  vendorSelection: string | null; quotesRequired: number | null; valuedMost: string | null;
  vendorStatus: string | null; vendorRegisteredUntil: Date | null; now: Date;
};
/** Returns sentences of parts; strong parts are the figures the reader scans for. */
export function buildClientSummary(input: SummaryInput): SummaryPart[][] {
  const sentences: SummaryPart[][] = [];
  const first: SummaryPart[] = [{ text: "Khách từ " }, { text: String(input.sinceYear), strong: true }];
  if (input.projectCount > 0) {
    first.push({ text: ", " }, { text: `${input.projectCount} dự án`, strong: true });
    if (input.showRevenue && input.revenue24m > 0) first.push({ text: ", " }, { text: formatShortVnd(input.revenue24m), strong: true }, { text: " trong 24 tháng" });
  } else first.push({ text: ", chưa có dự án ghi nhận" });
  sentences.push([...first, { text: "." }]);
  if (input.seasons.length) {
    const parts: SummaryPart[] = [{ text: "Thường làm " }];
    input.seasons.forEach((season, i) => { if (i) parts.push({ text: " và " }); parts.push({ text: `${season.programLabel} tháng ${season.month}`, strong: true }); });
    sentences.push([...parts, { text: "." }]);
  }
  const buying = [
    input.vendorSelection?.trim() ? `Chọn nhà cung cấp: ${input.vendorSelection.trim()}` : null,
    input.quotesRequired ? `yêu cầu ${input.quotesRequired} báo giá` : null,
    input.valuedMost?.trim() ? `coi trọng ${input.valuedMost.trim()}` : null,
  ].filter((text): text is string => !!text);
  if (buying.length) {
    const text = buying.join(", ");
    sentences.push([{ text: text.charAt(0).toLocaleUpperCase("vi") + text.slice(1) + "." }]);
  }
  const until = input.vendorRegisteredUntil;
  if (input.vendorStatus === "REGISTERED" && until && dayDiff(input.now, until) < 0) sentences.push([{ text: "Đăng ký NCC đã hết hạn " }, { text: monthYear(until), strong: true }, { text: "." }]);
  else if (input.vendorStatus === "REGISTERED" && until) sentences.push([{ text: "Đã vào danh sách NCC đến " }, { text: monthYear(until), strong: true }, { text: "." }]);
  else if (input.vendorStatus === "REGISTERED") sentences.push([{ text: "Đã vào danh sách NCC." }]);
  else if (input.vendorStatus === "IN_PROGRESS") sentences.push([{ text: "Đang đăng ký NCC." }]);
  else if (input.vendorStatus === "NOT_REGISTERED") sentences.push([{ text: "Chưa đăng ký NCC." }]);
  else if (input.vendorStatus === "EXPIRED") sentences.push([{ text: "Đăng ký NCC đã hết hạn." }]);
  return sentences;
}
export const summaryText = (sentences: SummaryPart[][]) => sentences.map((parts) => parts.map((part) => part.text).join("")).join(" ");

// ---- Sức khỏe quan hệ: từng tín hiệu, không gộp điểm ----
export type HealthTone = "ok" | "warn" | "late" | "none";
export type HealthSignal = { key: "cadence" | "response" | "revenue" | "bid"; title: string; label: string; tone: HealthTone };
export const RESPONSE_RECENT_DAYS = 90;
export const REVENUE_DROP_WARN_PERCENT = 10;
const BID_LABELS: Record<string, { label: string; tone: HealthTone }> = {
  WON: { label: "Thắng gần nhất", tone: "ok" }, LOST_COMPETITIVE: { label: "Thua gần nhất", tone: "late" },
  CUSTOMER_CANCELLED: { label: "Khách hủy gần nhất", tone: "none" }, CS_DECLINED: { label: "CS không tham gia gần nhất", tone: "none" },
  LEGACY_UNCLASSIFIED: { label: "Chưa rõ kết quả gần nhất", tone: "none" },
};
export function buildHealthSignals(input: {
  now: Date; cadenceWeeks: number; clientCreatedAt: Date; lastConfirmedTouchAt: Date | null; lastResponseAt: Date | null;
  projects: { status: string; onProcessAt: Date | null; revenue: number }[]; lastClosed: { outcome: string; closedAt: Date | null } | null;
}): HealthSignal[] {
  const today = vnDayStart(input.now);
  const due = nextCadenceDueDate(input.lastConfirmedTouchAt, input.clientCreatedAt, input.cadenceWeeks);
  const lateDays = dayDiff(due, today);
  const cadence: HealthSignal = { key: "cadence", title: "Chu kỳ liên hệ", ...(lateDays > 0 ? { label: `Trễ chu kỳ ${lateDays} ngày`, tone: "late" as const } : { label: "Đúng chu kỳ", tone: "ok" as const }) };
  const response: HealthSignal = { key: "response", title: "Phản hồi gần đây", ...(!input.lastResponseAt ? { label: "Chưa có phản hồi", tone: "none" as const }
    : dayDiff(input.lastResponseAt, today) <= RESPONSE_RECENT_DAYS ? { label: `Có phản hồi ${formatCrmDate(input.lastResponseAt, input.now)}`, tone: "ok" as const }
      : { label: `Phản hồi gần nhất ${formatCrmDate(input.lastResponseAt, input.now)}`, tone: "warn" as const }) };
  const recognized = input.projects.filter(isRecognizedProject);
  const yearAgo = new Date(input.now.getTime() - 365 * DAY);
  const twoYearsAgo = new Date(input.now.getTime() - 730 * DAY);
  const sum = (from: Date, to: Date) => recognized.filter((p) => p.onProcessAt! >= from && p.onProcessAt! < to).reduce((total, p) => total + (Number.isFinite(p.revenue) ? p.revenue : 0), 0);
  const current = sum(yearAgo, new Date(input.now.getTime() + 1));
  const previous = sum(twoYearsAgo, yearAgo);
  let revenue: HealthSignal;
  if (!recognized.length) revenue = { key: "revenue", title: "Xu hướng doanh thu", label: "Chưa có dự án", tone: "none" };
  else if (current <= 0) revenue = { key: "revenue", title: "Xu hướng doanh thu", label: "Không có doanh thu 12 tháng", tone: "late" };
  else if (previous <= 0) revenue = { key: "revenue", title: "Xu hướng doanh thu", label: "Doanh thu mới 12 tháng", tone: "ok" };
  else {
    const pct = Math.round(((current - previous) / previous) * 100);
    revenue = { key: "revenue", title: "Xu hướng doanh thu", label: pct >= 0 ? `Doanh thu ↑${pct}%` : `Doanh thu ↓${-pct}%`, tone: pct <= -REVENUE_DROP_WARN_PERCENT ? "warn" : "ok" };
  }
  const bidState = input.lastClosed ? BID_LABELS[input.lastClosed.outcome] ?? { label: "Chưa rõ kết quả gần nhất", tone: "none" as const } : { label: "Chưa có kết quả thầu", tone: "none" as const };
  return [cadence, response, revenue, { key: "bid", title: "Kết quả thầu gần nhất", ...bidState }];
}

// ---- Lịch sử hợp tác: lưới năm x tháng ----
export const HISTORY_MAX_YEARS = 5;
export type HistoryPoint = { kind: "PROJECT" | "OPPORTUNITY"; id: string; name: string; programCode: string; year: number; month: number; revenue: number | null; radius: number };
export type HistoryGrid = { years: number[]; points: HistoryPoint[]; olderCount: number; undatedCount: number };
export function buildHistoryGrid(input: {
  projects: { id: string; name: string; type: string; executionStartAt: Date | null; onProcessAt: Date | null; revenue: number }[];
  openOpportunities: { id: string; name: string; programTypeCode: string; expectedYear: number; expectedMonth: number | null; expectedQuarter: number | null }[];
  now: Date; maxYears?: number;
}): HistoryGrid {
  const maxYears = input.maxYears ?? HISTORY_MAX_YEARS;
  let undatedCount = 0;
  const all: HistoryPoint[] = [];
  for (const project of input.projects) {
    const date = project.executionStartAt ?? project.onProcessAt;
    if (!date) { undatedCount++; continue; }
    const { year, month } = vietnamYearMonth(date);
    all.push({ kind: "PROJECT", id: project.id, name: project.name, programCode: project.type, year, month, revenue: Number.isFinite(project.revenue) ? project.revenue : 0, radius: 5 });
  }
  for (const opportunity of input.openOpportunities) {
    const month = opportunity.expectedMonth ?? (opportunity.expectedQuarter ? (opportunity.expectedQuarter - 1) * 3 + 2 : null);
    if (!month) { undatedCount++; continue; }
    all.push({ kind: "OPPORTUNITY", id: opportunity.id, name: opportunity.name, programCode: opportunity.programTypeCode, year: opportunity.expectedYear, month, revenue: null, radius: 8 });
  }
  const currentYear = vietnamYearMonth(input.now).year;
  const endYear = Math.max(currentYear, ...all.map((p) => p.year));
  const startYear = Math.max(endYear - maxYears + 1, Math.min(currentYear, ...all.map((p) => p.year)));
  const points = all.filter((p) => p.year >= startYear && p.year <= endYear);
  const olderCount = all.length - points.length;
  const maxRevenue = Math.max(0, ...points.map((p) => p.revenue ?? 0));
  for (const point of points) if (point.kind === "PROJECT") point.radius = maxRevenue > 0 ? Math.round((5 + 10 * Math.sqrt((point.revenue ?? 0) / maxRevenue)) * 10) / 10 : 5;
  points.sort((a, b) => a.year - b.year || a.month - b.month || a.id.localeCompare(b.id));
  return { years: Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i), points, olderCount, undatedCount };
}

// ---- Thầu và bài học ----
export type BidSource = { id: string; name: string; outcome: string | null; closedAt: Date | null; createdAt: Date; briefSummary: string | null; winStrategy: string | null; outcomeNote: string | null; lessons: string | null; outcomeReasonLabel: string | null; competitors: string[] };
export function collectBidLessons(opportunities: BidSource[]) {
  const has = (value: string | null) => !!value?.trim();
  const items = opportunities
    .filter((o) => [o.briefSummary, o.winStrategy, o.outcomeNote, o.lessons, o.outcomeReasonLabel].some(has))
    .sort((a, b) => (b.closedAt ?? b.createdAt).getTime() - (a.closedAt ?? a.createdAt).getTime() || a.id.localeCompare(b.id));
  const counts = { won: 0, lost: 0, cancelled: 0, declined: 0 };
  for (const o of opportunities) {
    if (o.outcome === "WON") counts.won++;
    else if (o.outcome === "LOST_COMPETITIVE") counts.lost++;
    else if (o.outcome === "CUSTOMER_CANCELLED") counts.cancelled++;
    else if (o.outcome === "CS_DECLINED") counts.declined++;
  }
  const competitorCounts = new Map<string, number>();
  for (const o of opportunities) for (const name of new Set(o.competitors)) competitorCounts.set(name, (competitorCounts.get(name) ?? 0) + 1);
  const frequentCompetitors = [...competitorCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi")).slice(0, 3).map(([name]) => name);
  return { items, counts, frequentCompetitors };
}

// ---- Hạn NCC và hợp đồng nguyên tắc ----
export const RENEWAL_LEAD_DAYS = 30;
export function expiryInfo(until: Date | null, now: Date) {
  if (!until) return null;
  const dateKey = vnDateKey(until);
  const daysLeft = dayDiff(now, until);
  return { dateKey, label: dmy(dateKey), daysLeft, tone: daysLeft < 0 ? "late" as const : daysLeft <= RENEWAL_LEAD_DAYS ? "warn" as const : "ok" as const };
}
export function renewalReminderDue(until: Date | null, now: Date): boolean {
  if (!until) return false;
  const days = dayDiff(now, until);
  return days >= 0 && days <= RENEWAL_LEAD_DAYS;
}
export type RenewalKind = "VENDOR" | "FRAMEWORK";
export const renewalPeriodKey = (kind: RenewalKind, until: Date) => `renewal:${kind.toLowerCase()}:${vnDateKey(until)}`;
export function renewalTaskTitle(kind: RenewalKind, clientName: string, until: Date) {
  return `${kind === "VENDOR" ? "Gia hạn đăng ký NCC" : "Gia hạn hợp đồng nguyên tắc"} với ${clientName} trước ${dmy(vnDateKey(until))}`;
}

// ---- Sổ tay làm việc ----
export const PLAYBOOK_FIELDS = Object.values(PLAYBOOK_SECTIONS).flatMap((section) => section.fields) as PlaybookField[];
export type PlaybookValues = { vendorStatus: string | null; vendorRegisteredUntil: Date | null; frameworkContractUntil: Date | null; quotesRequired: number | null; approvalFlow: string | null; paymentTermsText: string | null; paymentPractice: string | null; invoiceNotes: string | null; brandGuidelineUrl: string | null; brandDos: string | null; brandDonts: string | null; executionNotes: string | null };
export type PlaybookData = Partial<PlaybookValues>;
const DATE_FIELDS = new Set<string>(["vendorRegisteredUntil", "frameworkContractUntil"]);

/** Only fields of the given section are accepted; a missing field is left untouched, an empty one is cleared. */
export function normalizePlaybookInput(section: PlaybookSection, raw: Record<string, unknown>): { ok: true; data: PlaybookData } | { error: string } {
  if (!Object.hasOwn(PLAYBOOK_SECTIONS, section) || !raw || typeof raw !== "object") return { error: "Mục sổ tay không hợp lệ." };
  const allowed = new Set<string>(PLAYBOOK_SECTIONS[section].fields);
  const keys = Object.keys(raw).filter((key) => raw[key] !== undefined);
  if (!keys.length || keys.some((key) => !allowed.has(key))) return { error: "Mục sổ tay không hợp lệ." };
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const value = raw[key];
    if (key === "vendorStatus") {
      if (value !== null && value !== "" && !VENDOR_STATUSES.some((item) => item.key === value)) return { error: "Tình trạng NCC không hợp lệ." };
      data[key] = value || null;
    } else if (key === "quotesRequired") {
      if (value === null || value === "") { data[key] = null; continue; }
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > QUOTES_MAX) return { error: `Số báo giá từ 1 đến ${QUOTES_MAX}.` };
      data[key] = value;
    } else if (DATE_FIELDS.has(key)) {
      if (value === null || value === "") { data[key] = null; continue; }
      if (typeof value !== "string") return { error: "Ngày không hợp lệ." };
      try { data[key] = vnDayStartFromKey(value); } catch { return { error: "Ngày không hợp lệ." }; }
    } else if (key === "brandGuidelineUrl") {
      if (value !== null && typeof value !== "string") return { error: "Link brand guideline không hợp lệ." };
      const site = normalizeWebsite(value);
      if ("error" in site) return { error: "Link brand guideline không hợp lệ." };
      data[key] = site.value;
    } else {
      if (value !== null && typeof value !== "string") return { error: "Nội dung sổ tay không hợp lệ." };
      const text = value?.trim() ?? "";
      if (text.length > PLAYBOOK_TEXT_MAX) return { error: `Mỗi ô tối đa ${PLAYBOOK_TEXT_MAX} ký tự.` };
      data[key] = text || null;
    }
  }
  return { ok: true, data: data as PlaybookData };
}
const filled = (value: unknown) => value !== null && value !== undefined && !(typeof value === "string" && !value.trim());
/** true means the section is empty and should be flagged for completion. */
export function playbookSectionStatus(values: PlaybookValues): Record<PlaybookSection, boolean> {
  return Object.fromEntries((Object.keys(PLAYBOOK_SECTIONS) as PlaybookSection[]).map((key) => [key, !PLAYBOOK_SECTIONS[key].fields.some((field) => filled(values[field]))])) as Record<PlaybookSection, boolean>;
}
/** History stores dates as VN date keys so the log reads the same in every time zone. */
export function playbookHistoryValue(field: string, value: unknown): unknown {
  return DATE_FIELDS.has(field) && value instanceof Date ? vnDateKey(value) : value ?? null;
}
export function describeHubFieldChange(change: { field: string; oldValue: unknown; newValue: unknown }, potentialLabels: Record<string, string> = {}) {
  if (!Object.hasOwn(PLAYBOOK_FIELD_LABELS, change.field)) return describeClientFieldChange(change, potentialLabels);
  const show = (value: unknown) => {
    if (value === null || value === undefined || value === "") return "Chưa có";
    if (change.field === "vendorStatus") return vendorStatusLabel(String(value)) ?? String(value);
    if (DATE_FIELDS.has(change.field) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return dmy(value.slice(0, 10));
    return String(value);
  };
  return { label: PLAYBOOK_FIELD_LABELS[change.field as PlaybookField], text: `${show(change.oldValue)} → ${show(change.newValue)}` };
}

// ---- Tài liệu ----
export const DOCUMENT_GROUP_LABELS = { CLIENT: "Tệp của khách", OPPORTUNITY: "Tệp của Cơ hội", PROJECT: "Tệp của dự án" } as const;
export type DocumentSource = keyof typeof DOCUMENT_GROUP_LABELS;
export function groupClientDocuments<T extends { source: DocumentSource }>(items: T[]) {
  return (Object.keys(DOCUMENT_GROUP_LABELS) as DocumentSource[]).map((key) => ({ key, label: DOCUMENT_GROUP_LABELS[key], items: items.filter((item) => item.source === key) })).filter((group) => group.items.length);
}
