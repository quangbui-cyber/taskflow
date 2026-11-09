import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadSeasonGridInput } from "../lib/crm/seasonData";
import { buildSeasonGrid } from "../lib/crm/seasonGrid";
import { createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture, cleanupCrmFixture } from "./helpers/crmTestDb";

test("season input uses exact Client, recognition, effective date window and active event history", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb(); const prefix = `season-${randomUUID()}`;
  const now = new Date("2026-11-09T00:00:00+07:00");
  try {
    const f = await seedCrmFixture(db, prefix);
    const base = { clientId: f.client.id, ownerId: f.pic.id, type: "MICE", status: "DONE", onProcessAt: new Date("2026-01-01T00:00:00+07:00") };
    for (const [name, patch] of [
      ["execution", { executionStartAt: new Date("2025-11-30T17:30:00Z") }],
      ["fallback", { executionStartAt: null }],
      ["start", { executionStartAt: new Date("2024-11-09T00:00:00+07:00") }],
      ["too-old", { executionStartAt: new Date("2024-11-08T00:00:00+07:00") }],
      ["at-end", { executionStartAt: now }],
      ["future", { executionStartAt: new Date("2027-01-01T00:00:00+07:00") }],
      ["bid", { status: "BIDDING" }],
      ["internal", { category: "INTERNAL" as const }],
      ["other-client", { clientId: null }],
    ] as const) await db.project.create({ data: { ...base, name: `${prefix} ${name}`, ...patch } });
    const unit = await db.buyingUnit.create({ data: { clientId: f.client.id, name: "HR" } });
    for (const [name, patch] of [ ["active", {}], ["brief", { status: "BRIEF_RECEIVED" }], ["cancel", { status: "CANCELLED" }], ["passed", { status: "PASSED" }], ["old", { year: 2024 }], ["previous", { year: 2025 }] ] as const) {
      await db.expectedEvent.create({ data: { clientId: f.client.id, createdById: f.pic.id, buyingUnitId: unit.id, programTypeCode: "MICE", precision: "MONTH", year: 2026, month: 7, source: "HISTORY", status: "ACTIVE", note: name, revision: 1, ...patch,
        expectedEventSteps: { create: [ { kind: "OFFSET", offsetDays: 30, revision: 1, status: "OPEN", dueDate: new Date("2026-06-01") }, { kind: "OFFSET", offsetDays: 60, revision: 0, status: "SUPERSEDED", dueDate: new Date("2026-05-01") } ] } } });
    }
    const loaded = await loadSeasonGridInput(db, f.client.id, now);
    assert.deepEqual(loaded.projects.map(p => p.name.replace(`${prefix} `, "")).sort(), ["execution", "fallback", "start"]);
    assert.deepEqual(loaded.events.map(e => e.note).sort(), ["active", "brief", "previous"]);
    assert.ok(loaded.events.every(e => e.buyingUnitId === unit.id && e.buyingUnitName === "HR"));
    assert.ok(loaded.events.every(e => e.steps[0].dueDate < e.steps[1].dueDate));
    const grid = buildSeasonGrid({ ...loaded, now, programTypes: [] });
    assert.ok(grid[11].chips.some(c => c.projectName === `${prefix} execution`));
    assert.ok(grid[6].chips.every(c => c.steps.length === 1 && c.steps[0].statusLabel === "Sắp tới"));
    assert.deepEqual(await loadSeasonGridInput(db, "missing-client", now), { projects: [], events: [] });
  } finally { try { await cleanupCrmFixture(db, prefix); } finally { await db.$disconnect(); } }
});
