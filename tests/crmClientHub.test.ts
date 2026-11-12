import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildClientSummary, buildHealthSignals, buildHistoryGrid, collectBidLessons, describeHubFieldChange, expiryInfo,
  formatShortVnd, groupClientDocuments, normalizePlaybookInput, PLAYBOOK_SECTIONS, playbookSectionStatus, renewalPeriodKey,
  renewalReminderDue, summaryText, typicalSeasons, HISTORY_MAX_YEARS,
} from "../lib/crm/clientHub";

const now = new Date("2026-11-11T09:00:00+07:00");
const vn = (key: string) => new Date(`${key}T00:00:00+07:00`);
const labels = { YEP: "YEP", MICE: "MICE", TEAMBUILDING: "Teambuilding" };

test("summary joins only clauses that have data", () => {
  const full = buildClientSummary({ sinceYear: 2021, projectCount: 9, revenue24m: 6_800_000_000, showRevenue: true, seasons: [{ programLabel: "YEP", month: 12 }, { programLabel: "MICE", month: 3 }], vendorSelection: "Thầu", quotesRequired: 3, valuedMost: "concept và an toàn", vendorStatus: "REGISTERED", vendorRegisteredUntil: vn("2027-06-30"), now });
  assert.equal(summaryText(full), "Khách từ 2021, 9 dự án, 6,8 tỷ trong 24 tháng. Thường làm YEP tháng 12 và MICE tháng 3. Chọn nhà cung cấp: Thầu, yêu cầu 3 báo giá, coi trọng concept và an toàn. Đã vào danh sách NCC đến 06/2027.");
  assert.ok(full.flat().some((part) => part.strong && part.text === "2021"));
  const bare = buildClientSummary({ sinceYear: 2026, projectCount: 0, revenue24m: 0, showRevenue: true, seasons: [], vendorSelection: null, quotesRequired: null, valuedMost: null, vendorStatus: null, vendorRegisteredUntil: null, now });
  assert.equal(summaryText(bare), "Khách từ 2026, chưa có dự án ghi nhận.");
  const hidden = buildClientSummary({ sinceYear: 2022, projectCount: 2, revenue24m: 500_000_000, showRevenue: false, seasons: [], vendorSelection: null, quotesRequired: 2, valuedMost: null, vendorStatus: "IN_PROGRESS", vendorRegisteredUntil: null, now });
  assert.equal(summaryText(hidden), "Khách từ 2022, 2 dự án. Yêu cầu 2 báo giá. Đang đăng ký NCC.");
  const expired = buildClientSummary({ sinceYear: 2022, projectCount: 1, revenue24m: 0, showRevenue: true, seasons: [], vendorSelection: null, quotesRequired: null, valuedMost: null, vendorStatus: "REGISTERED", vendorRegisteredUntil: vn("2026-10-01"), now });
  assert.equal(summaryText(expired), "Khách từ 2022, 1 dự án. Đăng ký NCC đã hết hạn 10/2026.");
});

test("typical seasons take at most 2 persona months and the most frequent program in each", () => {
  const projects = [
    { type: "YEP", executionStartAt: vn("2024-12-20") }, { type: "YEP", executionStartAt: vn("2025-12-19") }, { type: "MICE", executionStartAt: vn("2025-12-01") },
    { type: "MICE", executionStartAt: vn("2025-03-10") }, { type: "TEAMBUILDING", executionStartAt: vn("2025-06-10") }, { type: "MICE", executionStartAt: null },
  ];
  assert.deepEqual(typicalSeasons(projects, [12, 3, 6], labels), [{ programLabel: "YEP", month: 12 }, { programLabel: "MICE", month: 3 }]);
  assert.deepEqual(typicalSeasons(projects, [], labels), []);
  // A Project on the last evening of November in Vietnam is still November, not December UTC.
  assert.deepEqual(typicalSeasons([{ type: "OTHER", executionStartAt: new Date("2025-11-30T20:00:00+07:00") }], [11], {}), [{ programLabel: "OTHER", month: 11 }]);
});

test("health signals stay separate and handle new clients without Projects", () => {
  const fresh = buildHealthSignals({ now, cadenceWeeks: 4, clientCreatedAt: vn("2026-11-01"), lastConfirmedTouchAt: null, lastResponseAt: null, projects: [], lastClosed: null });
  assert.deepEqual(fresh.map((s) => [s.key, s.tone, s.label]), [["cadence", "ok", "Đúng chu kỳ"], ["response", "none", "Chưa có phản hồi"], ["revenue", "none", "Chưa có dự án"], ["bid", "none", "Chưa có kết quả thầu"]]);
  assert.equal(fresh.length, 4);
  assert.ok(!("score" in fresh[0]));
  const busy = buildHealthSignals({
    now, cadenceWeeks: 2, clientCreatedAt: vn("2021-01-01"), lastConfirmedTouchAt: vn("2026-10-01"), lastResponseAt: vn("2026-10-01"),
    projects: [{ status: "DONE", onProcessAt: vn("2026-03-01"), revenue: 880 }, { status: "DONE", onProcessAt: vn("2025-03-01"), revenue: 1000 }, { status: "BIDDING", onProcessAt: vn("2026-05-01"), revenue: 99999 }],
    lastClosed: { outcome: "LOST_COMPETITIVE", closedAt: vn("2026-09-01") },
  });
  assert.deepEqual(busy.map((s) => [s.key, s.tone, s.label]), [["cadence", "late", "Trễ chu kỳ 27 ngày"], ["response", "ok", "Có phản hồi 01/10"], ["revenue", "warn", "Doanh thu ↓12%"], ["bid", "late", "Thua gần nhất"]]);
  const old = buildHealthSignals({ now, cadenceWeeks: 4, clientCreatedAt: vn("2020-01-01"), lastConfirmedTouchAt: vn("2026-11-01"), lastResponseAt: vn("2026-05-01"), projects: [{ status: "DONE", onProcessAt: vn("2024-03-01"), revenue: 100 }], lastClosed: { outcome: "WON", closedAt: vn("2024-01-01") } });
  assert.deepEqual(old.map((s) => [s.tone, s.label]), [["ok", "Đúng chu kỳ"], ["warn", "Phản hồi gần nhất 01/05"], ["late", "Không có doanh thu 12 tháng"], ["ok", "Thắng gần nhất"]]);
  const grow = buildHealthSignals({ now, cadenceWeeks: 4, clientCreatedAt: vn("2020-01-01"), lastConfirmedTouchAt: null, lastResponseAt: null, projects: [{ status: "ON_PROCESS", onProcessAt: vn("2026-06-01"), revenue: 100 }], lastClosed: { outcome: "CUSTOMER_CANCELLED", closedAt: vn("2026-01-01") } });
  assert.deepEqual(grow.map((s) => [s.key, s.label]).slice(2), [["revenue", "Doanh thu mới 12 tháng"], ["bid", "Khách hủy gần nhất"]]);
});

test("history grid is year by month, capped at 5 years, with open opportunities", () => {
  const projects = [2019, 2020, 2021, 2022, 2023, 2024, 2025].map((year, i) => ({ id: `p${year}`, name: `P ${year}`, type: "YEP", executionStartAt: vn(`${year}-12-15`) as Date | null, onProcessAt: vn(`${year}-10-01`), revenue: (i + 1) * 100 }));
  projects.push({ id: "pnodate", name: "No date", type: "MICE", executionStartAt: null, onProcessAt: vn("2026-03-02"), revenue: 0 });
  const grid = buildHistoryGrid({ projects, openOpportunities: [
    { id: "o1", name: "YEP 2026", programTypeCode: "YEP", expectedYear: 2026, expectedMonth: 12, expectedQuarter: null },
    { id: "o2", name: "Q2", programTypeCode: "MICE", expectedYear: 2027, expectedMonth: null, expectedQuarter: 2 },
    { id: "o3", name: "No time", programTypeCode: "MICE", expectedYear: 2027, expectedMonth: null, expectedQuarter: null },
  ], now });
  assert.equal(HISTORY_MAX_YEARS, 5);
  assert.deepEqual(grid.years, [2023, 2024, 2025, 2026, 2027]);
  assert.equal(grid.olderCount, 4);
  assert.equal(grid.undatedCount, 1);
  const byId = new Map(grid.points.map((p) => [p.id, p]));
  assert.deepEqual([byId.get("pnodate")!.year, byId.get("pnodate")!.month], [2026, 3]);
  assert.deepEqual([byId.get("o2")!.kind, byId.get("o2")!.month], ["OPPORTUNITY", 5]);
  assert.equal(byId.get("p2025")!.radius, 15);
  assert.ok(byId.get("p2023")!.radius < byId.get("p2025")!.radius && byId.get("pnodate")!.radius === 5);
  const empty = buildHistoryGrid({ projects: [], openOpportunities: [], now });
  assert.deepEqual(empty, { years: [2026], points: [], olderCount: 0, undatedCount: 0 });
});

test("bid lessons are gathered newest first from existing Opportunity fields", () => {
  const result = collectBidLessons([
    { id: "a", name: "YEP 2024", outcome: "WON", closedAt: vn("2024-12-01"), createdAt: vn("2024-08-01"), briefSummary: null, winStrategy: "Concept", outcomeNote: null, lessons: "Giữ venue sớm", outcomeReasonLabel: null, competitors: ["Agency X"] },
    { id: "b", name: "Tết 2025", outcome: "LOST_COMPETITIVE", closedAt: vn("2025-01-10"), createdAt: vn("2024-11-01"), briefSummary: "Activation", winStrategy: null, outcomeNote: "Giá cao hơn 18%", lessons: null, outcomeReasonLabel: "Giá", competitors: ["Agency X", "Agency Y"] },
    { id: "c", name: "Empty", outcome: "CS_DECLINED", closedAt: vn("2025-02-10"), createdAt: vn("2025-01-01"), briefSummary: null, winStrategy: null, outcomeNote: null, lessons: null, outcomeReasonLabel: null, competitors: [] },
    { id: "d", name: "Open", outcome: null, closedAt: null, createdAt: vn("2026-09-01"), briefSummary: "Brief", winStrategy: "Plan", outcomeNote: null, lessons: null, outcomeReasonLabel: null, competitors: [] },
    { id: "e", name: "Cancel", outcome: "CUSTOMER_CANCELLED", closedAt: vn("2025-03-01"), createdAt: vn("2025-01-01"), briefSummary: null, winStrategy: null, outcomeNote: null, lessons: null, outcomeReasonLabel: "Hết ngân sách", competitors: [] },
  ]);
  assert.deepEqual(result.items.map((i) => i.id), ["d", "e", "b", "a"]);
  assert.deepEqual(result.counts, { won: 1, lost: 1, cancelled: 1, declined: 1 });
  assert.deepEqual(result.frequentCompetitors, ["Agency X", "Agency Y"]);
});

test("vendor expiry uses Vietnam days and reminds 30 days ahead once per expiry date", () => {
  // 23:30 in Vietnam on 11/11 is still 11/11 even though UTC already says 11/11 16:30.
  const late = new Date("2026-11-11T23:30:00+07:00");
  assert.deepEqual(expiryInfo(vn("2026-12-11"), late), { dateKey: "2026-12-11", label: "11/12/2026", daysLeft: 30, tone: "warn" });
  assert.equal(expiryInfo(vn("2026-12-12"), now)!.tone, "ok");
  assert.equal(expiryInfo(vn("2026-11-10"), now)!.tone, "late");
  assert.equal(expiryInfo(null, now), null);
  assert.equal(renewalReminderDue(vn("2026-12-11"), now), true);
  assert.equal(renewalReminderDue(vn("2026-12-12"), now), false);
  assert.equal(renewalReminderDue(vn("2026-11-11"), now), true);
  assert.equal(renewalReminderDue(vn("2026-11-10"), now), false);
  assert.equal(renewalPeriodKey("VENDOR", vn("2026-12-11")), "renewal:vendor:2026-12-11");
  assert.equal(renewalPeriodKey("FRAMEWORK", new Date("2026-12-10T17:00:00Z")), "renewal:framework:2026-12-11");
});

test("playbook input is validated per section and empty sections are flagged", () => {
  assert.deepEqual(Object.keys(PLAYBOOK_SECTIONS), ["PROCUREMENT", "PAYMENT", "BRAND", "EXECUTION"]);
  const ok = normalizePlaybookInput("PROCUREMENT", { vendorStatus: "REGISTERED", vendorRegisteredUntil: "2027-06-30", quotesRequired: 3, approvalFlow: "  Marketing + Mua hàng " });
  assert.ok("ok" in ok);
  assert.deepEqual(ok.data, { vendorStatus: "REGISTERED", vendorRegisteredUntil: vn("2027-06-30"), quotesRequired: 3, approvalFlow: "Marketing + Mua hàng" });
  assert.ok("ok" in normalizePlaybookInput("PAYMENT", { paymentTermsText: "" }) && (normalizePlaybookInput("PAYMENT", { paymentTermsText: "" }) as { data: object }).data);
  assert.deepEqual((normalizePlaybookInput("PAYMENT", { paymentTermsText: " " }) as { data: object }).data, { paymentTermsText: null });
  for (const bad of [
    normalizePlaybookInput("PAYMENT", { brandDos: "x" }), normalizePlaybookInput("PROCUREMENT", { vendorStatus: "MAYBE" }),
    normalizePlaybookInput("PROCUREMENT", { vendorRegisteredUntil: "2027-02-30" }), normalizePlaybookInput("PROCUREMENT", { quotesRequired: 0 }),
    normalizePlaybookInput("EXECUTION", { executionNotes: "x".repeat(1001) }), normalizePlaybookInput("BRAND", { brandGuidelineUrl: "javascript:alert(1)" }),
    normalizePlaybookInput("BRAND", {}), normalizePlaybookInput("OTHER" as never, { executionNotes: "x" }),
  ]) assert.ok("error" in bad);
  assert.equal((normalizePlaybookInput("BRAND", { brandGuidelineUrl: "brand.example.vn/guide" }) as { data: { brandGuidelineUrl: string } }).data.brandGuidelineUrl, "https://brand.example.vn/guide");
  const status = playbookSectionStatus({ vendorStatus: null, vendorRegisteredUntil: null, frameworkContractUntil: null, quotesRequired: 3, approvalFlow: null, paymentTermsText: null, paymentPractice: null, invoiceNotes: null, brandGuidelineUrl: null, brandDos: null, brandDonts: null, executionNotes: "  " });
  assert.deepEqual(status, { PROCUREMENT: false, PAYMENT: true, BRAND: true, EXECUTION: true });
});

test("helpers: short money, history labels and document groups", () => {
  assert.equal(formatShortVnd(6_800_000_000), "6,8 tỷ");
  assert.equal(formatShortVnd(320_000_000), "320 tr");
  assert.equal(formatShortVnd(0), "0");
  assert.deepEqual(describeHubFieldChange({ field: "vendorStatus", oldValue: null, newValue: "REGISTERED" }), { label: "Tình trạng NCC", text: "Chưa có → Đã đăng ký" });
  assert.deepEqual(describeHubFieldChange({ field: "vendorRegisteredUntil", oldValue: null, newValue: "2027-06-30" }), { label: "Đăng ký NCC đến", text: "Chưa có → 30/06/2027" });
  assert.deepEqual(describeHubFieldChange({ field: "industry", oldValue: null, newValue: "Ngân hàng" }), { label: "Ngành", text: "Chưa có → Ngân hàng" });
  const groups = groupClientDocuments([
    { id: "1", source: "CLIENT" }, { id: "2", source: "OPPORTUNITY" }, { id: "3", source: "PROJECT" }, { id: "4", source: "PROJECT" },
  ]);
  assert.deepEqual(groups.map((g) => [g.key, g.items.map((i) => i.id)]), [["CLIENT", ["1"]], ["OPPORTUNITY", ["2"]], ["PROJECT", ["3", "4"]]]);
});
