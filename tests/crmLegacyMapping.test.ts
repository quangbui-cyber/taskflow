import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { classifyLegacyProject, mapLegacyProjectToOpportunity, legacyDriveKeyPairs, serializeSnapshotRow, deserializeSnapshotRow, LEGACY_BACKFILL_CUTOFF } from "../lib/crm/legacyMapping";

const facts = { id: "p1", category: "CLIENT" as const, status: "BIDDING", onProcessAt: null, completedAt: null, purchaseOrderNumber: null, sourceOpportunityId: null, clientId: "c1", createdAt: new Date("2026-08-01Z"), revenue: 0, financeSheetCount: 0, approvedIcFinanceSheetCount: 0, alreadyMigrated: false };
const project = { ...facts, name: "Legacy", type: "MICE", ownerId: "u1", accountId: "a1", executionStartAt: null, executionEndAt: null };
test("eligible never-won client projects migrate", () => assert.deepEqual(classifyLegacyProject(facts), { classification: "MIGRATE", reasons: [] }));
test("won then cancelled stays a Project", () => assert.equal(classifyLegacyProject({ ...facts, status: "CANCEL", onProcessAt: new Date() }), null));
test("old closed records require review, including precise cutoff", () => {
  assert.deepEqual(classifyLegacyProject({ ...facts, status: "FAIL", createdAt: new Date("2026-07-10Z") }), { classification: "NEEDS_REVIEW", reasons: ["BEFORE_BACKFILL"] });
  assert.equal(classifyLegacyProject({ ...facts, status: "FAIL", createdAt: LEGACY_BACKFILL_CUTOFF })?.classification, "MIGRATE");
});
test("cancelled revenue requires review", () => assert.deepEqual(classifyLegacyProject({ ...facts, status: "CANCEL", revenue: 5_000_000 }), { classification: "NEEDS_REVIEW", reasons: ["CANCEL_WITH_REVENUE"] }));
test("all finance blocks, approved finance also records its reason", () => {
  assert.deepEqual(classifyLegacyProject({ ...facts, financeSheetCount: 1 }), { classification: "BLOCKED", reasons: ["HAS_FINANCE_SHEET"] });
  const result = classifyLegacyProject({ ...facts, financeSheetCount: 1, approvedIcFinanceSheetCount: 1, clientId: null });
  assert.equal(result?.classification, "BLOCKED");
  assert.deepEqual(new Set(result?.reasons), new Set(["HAS_FINANCE_SHEET", "IC_APPROVED", "NO_CLIENT"]));
});
test("missing client and all exclusion rules", () => {
  assert.equal(classifyLegacyProject({ ...facts, clientId: null })?.classification, "MISSING_CLIENT");
  for (const patch of [{ category: "INTERNAL" }, { purchaseOrderNumber: "PO" }, { sourceOpportunityId: "o" }, { alreadyMigrated: true }, { status: "ON_PROCESS" }, { completedAt: new Date() }]) assert.equal(classifyLegacyProject({ ...facts, ...patch }), null);
  assert.equal(classifyLegacyProject({ ...facts, clientId: null, status: "FAIL", createdAt: new Date("2026-07-01Z") })?.classification, "NEEDS_REVIEW");
});
test("mapping preserves unknown closed outcome and projected budget", () => {
  const result = mapLegacyProjectToOpportunity({ ...project, status: "FAIL", revenue: 123 }, { opportunityId: "o1" });
  assert.equal(result.stage, "BIDDING"); assert.equal(result.outcome, "LEGACY_UNCLASSIFIED"); assert.equal(result.legacyStatus, "FAIL");
  assert.equal(result.programTypeCode, "MICE"); assert.equal(result.budgetMax, 123); assert.equal(result.responsibleTeamId, null);
  assert.equal(result.closedAt, facts.createdAt); assert.equal(result.picAccountId, "a1"); assert.equal(result.createdById, "u1");
  const open = mapLegacyProjectToOpportunity(project, { opportunityId: "o2" });
  assert.equal(open.budgetMax, null); assert.equal(open.outcome, null); assert.equal(open.expectedMonth, null);
  assert.equal(mapLegacyProjectToOpportunity({ ...project, status: "CANCEL" }, { opportunityId: "o3" }).legacyStatus, "CANCEL");
  assert.equal(mapLegacyProjectToOpportunity({ ...project, status: "CANCEL", revenue: 123 }, { opportunityId: "o3" }).budgetMax, null);
  assert.throws(() => mapLegacyProjectToOpportunity({ ...project, clientId: null }, { opportunityId: "o" }));
});
test("expected date uses Vietnam calendar across year boundary", () => {
  const mapped = mapLegacyProjectToOpportunity({ ...project, executionStartAt: new Date("2026-12-31T18:00:00Z") }, { opportunityId: "o" });
  assert.equal(mapped.expectedYear, 2027); assert.equal(mapped.expectedMonth, 1);
});
test("drive keys match exact owner boundary", () => assert.deepEqual(legacyDriveKeyPairs("p1", "o1", ["project:p1", "project:p1:docs", "project:p10", "task:t1"]), [{ from: "project:p1", to: "opportunity:o1" }, { from: "project:p1:docs", to: "opportunity:o1:docs" }]));
test("snapshot round-trips nested dates and exact Decimal values through JSON", () => {
  const row = { date: new Date("2026-08-01Z"), amount: new Prisma.Decimal("123456789012345678.1234"), child: [null, { date: new Date("2026-09-01Z"), n: 0 }], text: "hello" };
  assert.deepEqual(deserializeSnapshotRow(JSON.parse(JSON.stringify(serializeSnapshotRow(row)))), row);
});
