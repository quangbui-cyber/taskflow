import assert from "node:assert/strict";
import { test } from "node:test";
import { computeClientLifecycle, computeClientMetrics, CLIENT_LIFECYCLE_LABELS } from "../lib/crm/clientLifecycle";
import { revenue24mWindow } from "../lib/crm/tier";

const now = new Date("2026-11-10T09:00:00+07:00");
const window = revenue24mWindow(now);
const project = (over: Partial<{ status: string; onProcessAt: Date | null; revenue: number }> = {}) => ({ status: "DONE", onProcessAt: new Date("2026-01-15T00:00:00Z"), revenue: 100, ...over });

test("lifecycle labels are Vietnamese and fixed", () => {
  assert.deepEqual(CLIENT_LIFECYCLE_LABELS, { PROSPECT: "Tiềm năng", ACTIVE: "Đang phục vụ", DORMANT: "Ngủ đông", ARCHIVED: "Lưu trữ" });
});

test("client without recognized Project is a prospect", () => {
  assert.equal(computeClientLifecycle({ archivedAt: null, projects: [], now }), "PROSPECT");
  assert.equal(computeClientLifecycle({ archivedAt: null, projects: [project({ status: "BIDDING" }), project({ status: "CANCEL" }), project({ onProcessAt: null })], now }), "PROSPECT");
});

test("recognized Project inside the 24-month window or still running means active", () => {
  assert.equal(computeClientLifecycle({ archivedAt: null, projects: [project()], now }), "ACTIVE");
  assert.equal(computeClientLifecycle({ archivedAt: null, projects: [project({ onProcessAt: window.start })], now }), "ACTIVE");
  assert.equal(computeClientLifecycle({ archivedAt: null, projects: [project({ status: "ON_PROCESS", onProcessAt: new Date("2020-01-01T00:00:00Z") })], now }), "ACTIVE");
});

test("recognized Project only before the window means dormant", () => {
  const justBefore = new Date(window.start.getTime() - 1);
  assert.equal(computeClientLifecycle({ archivedAt: null, projects: [project({ onProcessAt: justBefore })], now }), "DORMANT");
});

test("archive wins over every computed state", () => {
  assert.equal(computeClientLifecycle({ archivedAt: new Date("2026-11-01T00:00:00Z"), projects: [project()], now }), "ARCHIVED");
  assert.equal(computeClientLifecycle({ archivedAt: new Date("2026-11-01T00:00:00Z"), projects: [], now }), "ARCHIVED");
});

test("metrics with no data are empty, not zero rates", () => {
  assert.deepEqual(computeClientMetrics({ projects: [], opportunities: [], lastConfirmedTouchAt: null }), { lifetimeRevenue: 0, winRate: null, won: 0, lost: 0, averageWonValue: null, lastConfirmedTouchAt: null });
});

test("win rate ignores customer cancelled, CS declined, legacy and open Opportunities", () => {
  const metrics = computeClientMetrics({ projects: [], opportunities: [{ outcome: "CUSTOMER_CANCELLED", contractValue: null }, { outcome: "CS_DECLINED", contractValue: null }, { outcome: "LEGACY_UNCLASSIFIED", contractValue: null }, { outcome: null, contractValue: null }], lastConfirmedTouchAt: null });
  assert.equal(metrics.winRate, null);
  const mixed = computeClientMetrics({ projects: [], opportunities: [{ outcome: "WON", contractValue: 300 }, { outcome: "WON", contractValue: null }, { outcome: "LOST_COMPETITIVE", contractValue: 999 }, { outcome: "CUSTOMER_CANCELLED", contractValue: 50 }], lastConfirmedTouchAt: null });
  assert.equal(mixed.winRate, 67); assert.equal(mixed.won, 2); assert.equal(mixed.lost, 1);
  // Average contract value counts only won Opportunities with a recorded value.
  assert.equal(mixed.averageWonValue, 300);
});

test("lifetime revenue follows the recognized revenue rule across all years", () => {
  const touch = new Date("2026-11-01T03:00:00Z");
  const metrics = computeClientMetrics({ projects: [project({ revenue: 100, onProcessAt: new Date("2019-05-01T00:00:00Z") }), project({ status: "ON_PROCESS", revenue: 50 }), project({ status: "CANCEL", revenue: 1000 }), project({ status: "BIDDING", revenue: 7 }), project({ onProcessAt: null, revenue: 9 })], opportunities: [], lastConfirmedTouchAt: touch });
  assert.equal(metrics.lifetimeRevenue, 150);
  assert.equal(metrics.lastConfirmedTouchAt, touch);
});
