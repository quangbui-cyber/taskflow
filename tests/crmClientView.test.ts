import assert from "node:assert/strict";
import { test } from "node:test";
import { clientSummary, buildClientActivity, formatBudgetSpan, compactSeasonMonths, type ClientProfileLike } from "../lib/crm/clientView";
import { formatVND } from "../lib/types";
import { resolveCrmTab, crmTabHref } from "../lib/crm/tabs";

const now = new Date("2026-11-10T09:00:00+07:00");
const d = (value: string) => new Date(`${value}+07:00`);
const opp = (over: Partial<ClientProfileLike["opportunities"][number]>): ClientProfileLike["opportunities"][number] => ({
  id: "o", name: "MICE 2027", stage: "CARE", outcome: null, createdAt: d("2026-10-01T09:00:00"), closedAt: null, wonAt: null,
  contractValue: null, outcomeReason: null, nextStep: null, ...over,
});
const profile = (over: Partial<ClientProfileLike> = {}): ClientProfileLike => ({
  opportunities: [], tasks: [], touchpoints: [], persona: { typicalMonths: [] }, ...over,
});

test("summary without open Opportunity is in care", () => {
  const summary = clientSummary(profile(), now);
  assert.equal(summary.status, "Đang chăm sóc"); assert.equal(summary.openOpportunity, null);
  assert.equal(summary.openOpportunityCount, 0); assert.equal(summary.lastTouch, null);
  assert.equal(summary.peakMonths, null); assert.equal(summary.nextTask, null);
});
test("summary uses the newest open Opportunity stage", () => {
  const summary = clientSummary(profile({ opportunities: [
    opp({ id: "old", stage: "BIDDING", createdAt: d("2026-01-01T09:00:00") }),
    opp({ id: "new", name: "Gala", stage: "BRIEF", createdAt: d("2026-10-20T09:00:00") }),
    opp({ id: "won", stage: "BIDDING", outcome: "WON", createdAt: d("2026-11-01T09:00:00") }),
  ] }), now);
  assert.equal(summary.status, "Brief"); assert.deepEqual(summary.openOpportunity, { id: "new", name: "Gala" });
  assert.equal(summary.openOpportunityCount, 2);
});
test("summary last touch ignores drafts and peak months come from persona", () => {
  const summary = clientSummary(profile({
    persona: { typicalMonths: [10, 2] },
    touchpoints: [
      { id: "draft", occurredAt: d("2026-11-09T09:00:00"), kind: "MEETING", outcomeLevel: 3, notes: null, draft: true, author: null, opportunity: null },
      { id: "t", occurredAt: d("2026-11-03T09:00:00"), kind: "CALL", outcomeLevel: 2, notes: "x", draft: false, author: { name: "NA" }, opportunity: null },
    ],
  }), now);
  assert.deepEqual(summary.lastTouch, { date: d("2026-11-03T09:00:00"), label: "03/11 · có phản hồi thực chất" });
  assert.equal(summary.peakMonths, "T2, T10");
});
test("next task is the earliest open CRM task across client and open Opportunities", () => {
  const summary = clientSummary(profile({
    tasks: [
      { id: "done", title: "Đã xong", status: "DONE", dueDate: d("2026-10-01T09:00:00"), completedAt: d("2026-10-02T09:00:00"), assignee: null },
      { id: "late", title: "Gọi hỏi lịch MICE", status: "TODO", dueDate: d("2026-11-08T09:00:00"), completedAt: null, assignee: { name: "Ngọc Anh" } },
      { id: "none", title: "Không hạn", status: "TODO", dueDate: null, completedAt: null, assignee: null },
    ],
    opportunities: [opp({ id: "o1", name: "Gala", nextStep: { id: "ot", title: "Gửi đề xuất", dueDate: d("2026-11-12T09:00:00") } })],
  }), now);
  assert.deepEqual(summary.nextTask, { id: "late", title: "Gọi hỏi lịch MICE", dueDate: d("2026-11-08T09:00:00"), assigneeName: "Ngọc Anh", opportunity: null, dueLabel: "Trễ 2 ngày", dueTone: "late" });
  const later = clientSummary(profile({ opportunities: [opp({ id: "o1", name: "Gala", nextStep: { id: "ot", title: "Gửi đề xuất", dueDate: d("2026-11-10T22:00:00") } })] }), now);
  assert.deepEqual(later.nextTask, { id: "ot", title: "Gửi đề xuất", dueDate: d("2026-11-10T22:00:00"), assigneeName: null, opportunity: { id: "o1", name: "Gala" }, dueLabel: "Hạn hôm nay", dueTone: "warn" });
  const future = clientSummary(profile({ tasks: [{ id: "f", title: "F", status: "IN_PROGRESS", dueDate: d("2026-11-20T09:00:00"), completedAt: null, assignee: null }] }), now);
  assert.equal(future.nextTask?.dueLabel, "Hạn 20/11"); assert.equal(future.nextTask?.dueTone, null);
  const closedOpp = clientSummary(profile({ opportunities: [opp({ outcome: "CUSTOMER_CANCELLED", nextStep: { id: "x", title: "X", dueDate: d("2026-11-01T09:00:00") } })] }), now);
  assert.equal(closedOpp.nextTask, null);
});
test("activity merges touchpoints, finished tasks and closed Opportunities newest first", () => {
  const items = buildClientActivity(profile({
    touchpoints: [
      { id: "t1", occurredAt: d("2026-11-03T09:00:00"), kind: "CALL", outcomeLevel: 2, notes: "Chờ ngân sách", draft: false, author: { name: "NA" }, opportunity: null },
      { id: "t2", occurredAt: d("2026-11-09T09:00:00"), kind: "MEETING", outcomeLevel: null, notes: null, draft: true, author: null, opportunity: { id: "o1", name: "Gala" } },
    ],
    tasks: [
      { id: "k1", title: "Gửi thiệp 20/10", status: "DONE", dueDate: null, completedAt: d("2026-10-20T09:00:00"), assignee: null },
      { id: "k2", title: "Hủy", status: "CANCELLED", dueDate: null, completedAt: null, assignee: null },
      { id: "k3", title: "Đang làm", status: "TODO", dueDate: null, completedAt: null, assignee: null },
    ],
    opportunities: [
      opp({ id: "w", name: "Teambuilding 2026", outcome: "WON", closedAt: d("2026-09-15T09:00:00"), wonAt: d("2026-09-15T09:00:00"), contractValue: 850_000_000 }),
      opp({ id: "c", name: "Gala hủy", outcome: "CUSTOMER_CANCELLED", closedAt: d("2026-08-01T09:00:00"), outcomeReason: { label: "Đổi kế hoạch" } }),
      opp({ id: "open", name: "Đang mở" }),
    ],
  }), now);
  assert.deepEqual(items.map(item => [item.key, item.kind, item.dateLabel]), [
    ["touchpoint-t2", "TOUCHPOINT", "09/11"], ["touchpoint-t1", "TOUCHPOINT", "03/11"], ["task-k1", "TASK_DONE", "20/10"],
    ["opportunity-w", "OPPORTUNITY_CLOSED", "15/09"], ["opportunity-c", "OPPORTUNITY_CLOSED", "01/08"],
  ]);
  assert.equal(items[0].draft, true); assert.equal(items[1].draft, false);
  assert.equal(items[1].title, "Gọi"); assert.equal(items[1].detail, "Chờ ngân sách"); assert.equal(items[1].actor, "NA");
  assert.equal(items[2].title, "Việc xong"); assert.equal(items[2].detail, "Gửi thiệp 20/10");
  assert.equal(items[3].title, "Thắng thầu"); assert.equal(items[3].detail, "Teambuilding 2026 · 850 triệu");
  assert.equal(items[4].title, "Khách hủy"); assert.equal(items[4].detail, "Gala hủy · Đổi kế hoạch");
});
test("empty profile has empty activity", () => assert.deepEqual(buildClientActivity(profile(), now), []));
test("budget span with equal ends shows one number", () => {
  assert.equal(formatBudgetSpan({ min: 850_000_000, max: 850_000_000 }), formatVND(850_000_000));
  assert.equal(formatBudgetSpan({ min: 500_000_000, max: 850_000_000 }), `${formatVND(500_000_000)} - ${formatVND(850_000_000)}`);
  assert.equal(formatBudgetSpan(null), null);
});
test("compact season months keep full labels and the strongest tone", () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, chips: [] as { key: string; kind: "DONE" | "EVENT"; label: string; sourceLabel: string | null }[] }));
  months[1].chips.push({ key: "a", kind: "EVENT", label: "MICE Q2? 27", sourceLabel: "Khách xác nhận" }, { key: "b", kind: "EVENT", label: "Gala", sourceLabel: "Suy từ lịch sử" });
  months[8].chips.push({ key: "c", kind: "DONE", label: "Teambuilding", sourceLabel: "Đã làm với CS" });
  months[6].chips.push({ key: "d", kind: "EVENT", label: "YEP", sourceLabel: "Mùa vụ ngành" });
  const compact = compactSeasonMonths(months);
  assert.equal(compact.length, 12);
  assert.deepEqual(compact[1], { month: 2, label: "MICE Q2? 27", more: 1, tone: "CLIENT_CONFIRMED", title: "MICE Q2? 27 · Khách xác nhận, Gala · Suy từ lịch sử" });
  assert.equal(compact[8].tone, "DONE"); assert.equal(compact[6].tone, "GUESS"); assert.equal(compact[0].tone, null);
  assert.equal(compact[0].label, null);
});
test("tabs resolve from the query and keep other params", () => {
  assert.equal(resolveCrmTab("season", ["activity", "season"], "activity"), "season");
  assert.equal(resolveCrmTab("bogus", ["activity", "season"], "activity"), "activity");
  assert.equal(resolveCrmTab(["season"], ["activity", "season"], "activity"), "activity");
  assert.equal(resolveCrmTab(undefined, ["activity", "season"], "activity"), "activity");
  assert.equal(crmTabHref("/crm/clients/x", { task: "t1", tab: "season" }, "opportunities", "activity"), "/crm/clients/x?task=t1&tab=opportunities");
  assert.equal(crmTabHref("/crm/clients/x", { tab: "season", touchpoints: ["a", "b"] }, "activity", "activity"), "/crm/clients/x?touchpoints=a&touchpoints=b");
  assert.equal(crmTabHref("/crm/clients/x", {}, "activity", "activity"), "/crm/clients/x");
});
