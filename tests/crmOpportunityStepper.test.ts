import assert from "node:assert/strict";
import test from "node:test";
import { buildStepperSegments, describeStageEvent } from "../lib/crm/opportunityStepper";

test("open stages distinguish passed, current and future segments", () => {
  const rows = buildStepperSegments({ stage: "BRIEF", outcome: null, events: [] });
  assert.deepEqual(rows.map(r => [r.key, r.label, r.state]), [["CARE", "Chăm sóc", "done"], ["BRIEF", "Brief", "current"], ["BIDDING", "Bidding", "future"], ["RESULT", "Kết quả", "future"]]);
  assert.match(rows[0].className, /bg-brand-50 text-brand-700/);
  assert.match(rows[1].className, /bg-zinc-900 text-white/);
  assert.match(rows[2].className, /bg-zinc-100 text-zinc-500/);
  assert.ok(rows.every(r => r.date === null));
});
test("won and early closed results keep skipped stages in the future", () => {
  const won = buildStepperSegments({ stage: "BIDDING", outcome: "WON", events: [] });
  assert.deepEqual(won.map(r => r.state), ["done", "done", "done", "current"]);
  assert.equal(won[3].label, "Thắng"); assert.match(won[3].className, /emerald/);
  const cancelled = buildStepperSegments({ stage: "CARE", outcome: "CUSTOMER_CANCELLED", events: [] });
  assert.deepEqual(cancelled.map(r => r.state), ["done", "future", "future", "current"]);
  assert.equal(cancelled[3].label, "Khách hủy");
});
test("dates use earliest entry regardless of event order; result uses outcome event", () => {
  const early = new Date("2026-10-01T00:00Z"), late = new Date("2026-10-02T00:00Z");
  const rows = buildStepperSegments({ stage: "BRIEF", outcome: "CS_DECLINED", events: [
    { toStage: "BRIEF", outcome: null, occurredAt: late },
    { toStage: "CS_DECLINED", outcome: "CS_DECLINED", occurredAt: late },
    { toStage: "BRIEF", outcome: null, occurredAt: early },
  ] });
  assert.equal(rows[0].date, null); assert.equal(rows[1].date, early); assert.equal(rows[3].date, late);
});
test("history uses opening, transition and outcome labels including legacy", () => {
  assert.equal(describeStageEvent({ fromStage: null, toStage: "CARE", outcome: null }), "Mở Cơ hội ở Chăm sóc");
  assert.equal(describeStageEvent({ fromStage: "BRIEF", toStage: "BIDDING", outcome: null }), "Brief → Bidding");
  assert.equal(describeStageEvent({ fromStage: "BIDDING", toStage: "WON", outcome: "WON" }), "Bidding → Thắng");
  assert.equal(describeStageEvent({ fromStage: "BIDDING", toStage: "BIDDING", outcome: "WON" }), "Bidding → Thắng");
  assert.equal(describeStageEvent({ fromStage: "BIDDING", toStage: "LEGACY_UNCLASSIFIED", outcome: "LEGACY_UNCLASSIFIED" }), "Bidding → Chưa rõ kết quả");
});
