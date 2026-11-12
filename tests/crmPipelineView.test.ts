import assert from "node:assert/strict";
import { test } from "node:test";
import { careToBriefTile, outsideWinRateTile } from "../lib/crm/pipelineView";
import { careToBrief, outsideWinRate } from "../lib/crm/metrics";

test("outside win rate counts only closed deals outside the denominator", () => {
  const opps = [{ outcome: "CUSTOMER_CANCELLED" }, { outcome: null }, { outcome: null }, { outcome: "WON" }, { outcome: "LOST_COMPETITIVE" }];
  assert.deepEqual(outsideWinRateTile(outsideWinRate(opps)), { label: "Ngoài win rate", value: 1, caption: "Khách hủy 1 · CS không tham gia 0" });
  assert.deepEqual(outsideWinRateTile({ cancelled: 1, declined: 2, legacyUnclassified: 3 }), { label: "Ngoài win rate", value: 6, caption: "Khách hủy 1 · CS không tham gia 2 · Chưa rõ kết quả 3" });
  assert.ok(!outsideWinRateTile({ cancelled: 0, declined: 0, legacyUnclassified: 0 }).caption.includes("Đang mở"));
});
test("care to brief tile carries the open count", () => {
  const opps = [{ reachedBrief: true, outcome: "WON" }, { reachedBrief: true, outcome: null }, { reachedBrief: true, outcome: "LOST_COMPETITIVE" }, { reachedBrief: false, outcome: null }, { reachedBrief: false, outcome: "CS_DECLINED" }];
  assert.deepEqual(careToBriefTile(careToBrief(opps)), { label: "Đã nhận Brief", value: "3/5", caption: "3 trên 5 Cơ hội đã qua Chăm sóc, 2 còn đang mở" });
  assert.equal(careToBriefTile({ reached: 0, total: 0, open: 0 }).caption, "Chưa có Cơ hội trong kỳ");
});
