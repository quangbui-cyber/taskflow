import assert from "node:assert/strict";
import { test } from "node:test";
import { competitiveWinRate, outsideWinRate, legacyWinRate, pipelineByStage, nextStepCoverage, careToBrief, touchQuality } from "../lib/crm/metrics";
test("competitive and legacy rates keep distinct denominators", () => {
  const opps = [...Array(5).fill("WON"), ...Array(3).fill("LOST_COMPETITIVE"), "CUSTOMER_CANCELLED", "CS_DECLINED", "CS_DECLINED", ...Array(4).fill(null)].map((outcome) => ({ outcome }));
  assert.deepEqual(competitiveWinRate(opps), { won: 5, lost: 3, rate: 63 });
  assert.deepEqual(outsideWinRate(opps), { cancelled: 1, declined: 2, open: 4, legacyUnclassified: 0 });
  assert.equal(competitiveWinRate([]).rate, null);
  assert.deepEqual(legacyWinRate(["ON_PROCESS", "DONE", "CANCEL", "FAIL", "PENDING", "BIDDING"].map((status) => ({ status }))), { won: 2, lost: 2, rate: 50 });
});
test("pipeline and review quality use one source and highest confirmed outcome per client", () => {
  assert.deepEqual(pipelineByStage([{ stage: "CARE", budgetMin: 10, budgetMax: 20, hasOverdueNextStep: true }])[0], { stage: "CARE", count: 1, budget: 20, overdueNextSteps: 1 });
  assert.deepEqual(nextStepCoverage([{ inCare: true, hasOpenNextStep: true }, { inCare: false, hasOpenNextStep: false }]), { covered: 1, total: 1, percent: 100 });
  assert.deepEqual(careToBrief([{ reachedBrief: true, outcome: "WON" }, { reachedBrief: false, outcome: null }]), { reached: 1, total: 2, open: 1 });
  assert.deepEqual(touchQuality([{ clientId: "c", outcomeLevel: 2, status: "CONFIRMED" }, { clientId: "c", outcomeLevel: 3, status: "CONFIRMED" }, { clientId: "d", outcomeLevel: 4, status: "DRAFT" }]), { 1: 0, 2: 0, 3: 1, 4: 0 });
});
