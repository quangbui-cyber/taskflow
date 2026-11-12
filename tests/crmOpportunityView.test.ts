import assert from "node:assert/strict";
import { test } from "node:test";
import { opportunityPrimaryAction, briefChecklist, outcomeBanner, proposalCountdown, opportunityTabs, type OpportunityViewInput } from "../lib/crm/opportunityView";

const d = (value: string) => new Date(`${value}+07:00`);
const now = d("2026-11-10T09:00:00");
const all = { canAdvance: true, canClose: true };
const detail = (over: Partial<OpportunityViewInput> = {}): OpportunityViewInput => ({
  stage: "BIDDING", outcome: null, briefReceivedAt: d("2026-10-21T10:00:00"), briefSummary: "Hội nghị 300 khách",
  proposalDueAt: d("2026-11-18T00:00:00"), winStrategy: null, proposalPlannedAt: null,
  wonAt: null, closedAt: null, contractValue: null, project: null, outcomeReasonLabel: null, outcomeNote: null,
  tasks: [], files: [], meetings: [], ...over,
});

test("primary action follows the stage and rights", () => {
  assert.deepEqual(opportunityPrimaryAction("CARE", null, all), { key: "BRIEF", label: "Nhận Brief" });
  assert.deepEqual(opportunityPrimaryAction("BRIEF", null, all), { key: "BIDDING", label: "Chuyển sang Bidding" });
  assert.deepEqual(opportunityPrimaryAction("BIDDING", null, all), { key: "RESULT", label: "Ghi kết quả thầu" });
  assert.equal(opportunityPrimaryAction("CARE", null, { canAdvance: false, canClose: true }), null);
  assert.equal(opportunityPrimaryAction("BRIEF", null, { canAdvance: false, canClose: true }), null);
  assert.equal(opportunityPrimaryAction("BIDDING", null, { canAdvance: true, canClose: false }), null);
  for (const outcome of ["WON", "LOST_COMPETITIVE", "CUSTOMER_CANCELLED", "CS_DECLINED"]) assert.equal(opportunityPrimaryAction("BIDDING", outcome, all), null);
});
test("brief checklist marks done items and editable missing items per stage", () => {
  const items = briefChecklist(detail(), now);
  assert.deepEqual(items.map(i => [i.key, i.label, i.done, i.value, i.canAdd]), [
    ["briefReceivedAt", "Ngày nhận Brief", true, "21/10", false],
    ["briefSummary", "Đề bài tóm tắt", true, "Có", false],
    ["proposalDueAt", "Hạn nộp đề xuất", true, "18/11", false],
    ["winStrategy", "Chiến lược thắng thầu", false, null, true],
    ["proposalPlannedAt", "Ngày gửi đề xuất dự kiến", false, null, true],
  ]);
  assert.equal(items[1].text, "Hội nghị 300 khách");
  const brief = briefChecklist(detail({ stage: "BRIEF", briefSummary: "  ", proposalDueAt: null }), now);
  assert.deepEqual(brief.map(i => [i.done, i.canAdd]), [[true, false], [false, true], [false, true], [false, false], [false, false]]);
  const care = briefChecklist(detail({ stage: "CARE", briefReceivedAt: null, briefSummary: null, proposalDueAt: null }), now);
  assert.ok(care.every(i => !i.done && !i.canAdd));
  const closed = briefChecklist(detail({ outcome: "LOST_COMPETITIVE" }), now);
  assert.ok(closed.every(i => !i.canAdd));
});
test("won banner links the Project with transferred counts", () => {
  const banner = outcomeBanner(detail({ outcome: "WON", wonAt: d("2026-11-09T10:00:00"), closedAt: d("2026-11-09T10:00:00"), contractValue: 1_320_000_000, project: { id: "p", name: "MICE Đà Nẵng 2027" }, tasks: [{}, {}, {}], files: [{}, {}], meetings: [{}] }), now);
  assert.deepEqual(banner, { tone: "won", title: "Đã thắng 09/11 · Hợp đồng 1,3 tỷ", project: { id: "p", name: "MICE Đà Nẵng 2027" }, transferred: { tasks: 3, files: 2, meetings: 1 }, transferredLabel: "3 việc, 2 file, 1 cuộc họp", reason: null, note: null });
  const noValue = outcomeBanner(detail({ outcome: "WON", wonAt: null, closedAt: d("2026-11-09T10:00:00") }), now);
  assert.equal(noValue?.title, "Đã thắng 09/11");
  assert.equal(noValue?.transferredLabel, "0 việc, 0 file, 0 cuộc họp");
});
test("closed banners show reason and note for each non-win outcome", () => {
  const cases: [string, string][] = [["LOST_COMPETITIVE", "Thua cạnh tranh"], ["CUSTOMER_CANCELLED", "Khách hủy"], ["CS_DECLINED", "CS không tham gia"], ["LEGACY_UNCLASSIFIED", "Chưa rõ kết quả"]];
  for (const [outcome, label] of cases) {
    const banner = outcomeBanner(detail({ outcome, closedAt: d("2026-11-05T10:00:00"), outcomeReasonLabel: "Giá cao", outcomeNote: "Khách chọn đơn vị khác" }), now);
    assert.deepEqual(banner, { tone: "closed", title: `${label} · 05/11`, project: null, transferred: null, transferredLabel: null, reason: "Giá cao", note: "Khách chọn đơn vị khác" });
  }
  assert.equal(outcomeBanner(detail(), now), null);
  assert.equal(outcomeBanner(detail({ outcome: "CS_DECLINED", closedAt: null }), now)?.title, "CS không tham gia");
});
test("proposal countdown uses Vietnam calendar days", () => {
  assert.equal(proposalCountdown(null, now), null);
  assert.deepEqual(proposalCountdown(d("2026-11-18T00:00:00"), now), { days: 8, dateLabel: "18/11", label: "Nộp đề xuất 18/11 · còn 8 ngày", tone: null });
  assert.deepEqual(proposalCountdown(d("2026-11-10T23:59:00"), now), { days: 0, dateLabel: "10/11", label: "Nộp đề xuất 10/11 · hạn hôm nay", tone: "warn" });
  assert.deepEqual(proposalCountdown(d("2026-11-12T08:00:00"), now)?.tone, "warn");
  assert.deepEqual(proposalCountdown(d("2026-11-07T08:00:00"), now), { days: -3, dateLabel: "07/11", label: "Nộp đề xuất 07/11 · quá hạn 3 ngày", tone: "late" });
  assert.equal(proposalCountdown(d("2026-11-11T00:30:00"), d("2026-11-10T23:30:00"))?.days, 1);
  assert.equal(proposalCountdown(d("2026-11-11T00:30:00"), d("2026-11-11T00:10:00"))?.days, 0);
});
test("tabs rename prep work after a win", () => {
  const open = opportunityTabs(detail({ tasks: [{}, {}], files: [{}], meetings: [] }), true);
  assert.deepEqual(open.map(t => [t.key, t.label]), [["tasks", "Việc chuẩn bị thầu (2)"], ["files", "File (1)"], ["meetings", "Cuộc họp (0)"], ["touchpoints", "Điểm chạm"], ["history", "Lịch sử giai đoạn"]]);
  const won = opportunityTabs(detail({ outcome: "WON", tasks: [{}] }), false);
  assert.deepEqual(won.map(t => t.label), ["Việc đã chuyển sang Project (1)", "File (0)", "Điểm chạm", "Lịch sử giai đoạn"]);
});
