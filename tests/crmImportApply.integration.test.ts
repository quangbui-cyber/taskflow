import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { applyImportRun, resolveImportRow } from "../lib/crm/trackerApply";
import { cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl, seedCrmFixture } from "./helpers/crmTestDb";

test("tracker review preserves evidence and applies atomically once", { skip: !crmTestDatabaseUrl() }, async (t) => {
  const db = createCrmTestDb();
  const prefix = randomUUID();
  let runId: string | undefined;
  try {
    const f = await seedCrmFixture(db, prefix);
    const manager = { id: f.manager.id, name: f.manager.name, role: "ACCOUNT", accountId: f.otherAccount.id, managedTeamIds: [f.team.id], isDataSteward: false };
    const steward = { ...manager, isDataSteward: true };
    const run = await db.trackerImportRun.create({ data: { mode: "DRY_RUN", fileName: "synthetic.xlsx", actorId: steward.id, actorName: steward.name } });
    runId = run.id;
    const proposed = { clientName: `${prefix} Imported`, matchedClientId: null, picAccountId: f.picAccount.id, programTypeCode: "MICE", period: { kind: "MONTH", year: 2027, month: 3 }, outcome: null, legacyOutcome: null, reasonId: null, opportunityKey: "deliberately stale", touch: null };
    const row = (sheet: string, n: number, status: string, patch = {}, raw = {}) => db.trackerImportRow.create({ data: { runId: run.id, sheet, rowNumber: n, status, raw, proposed: { ...proposed, ...patch } as Prisma.InputJsonValue } });
    const brief = await row("Brief", 2, "OK", {}, { "Ngày nhận brief": "01/03/2027" });
    const lost = await row("Lost Log", 2, "UNCLEAR", { outcome: "LEGACY_UNCLASSIFIED", legacyOutcome: "  FAIL <script>  " }, { "Kết quả": "  FAIL <script>  " });
    const duplicate = await row("Prospect", 3, "DUPLICATE", { clientName: f.client.name, matchedClientId: f.client.id });
    const touch = await row("CSKH", 4, "OK", { touch: { date: "2027-03-01T03:00:00Z", level: 2 } });
    const draft = await row("Prospect", 5, "OK", {}, { "Ngày thực tế": "02/03/2027", "Kết quả tiếp cận": "Chưa biết" });

    await t.test("manager denied for resolve and apply; non-admin steward allowed", async () => {
      assert.ok("error" in await resolveImportRow(db, manager, { rowId: lost.id, action: "EDIT", proposedPatch: { period: proposed.period } }));
      assert.ok("error" in await applyImportRun(db, manager, run.id));
      assert.equal((await db.trackerImportRow.findUniqueOrThrow({ where: { id: lost.id } })).status, "UNCLEAR");
    });
    await t.test("EDIT whitelist preserves raw byte-for-byte and records resolver", async () => {
      const before = JSON.stringify(lost.raw);
      assert.ok("ok" in await resolveImportRow(db, steward, { rowId: lost.id, action: "EDIT", proposedPatch: { period: proposed.period, raw: "tamper", applied: { clientId: f.client.id }, outcome: "LOST_COMPETITIVE" } }));
      const saved = await db.trackerImportRow.findUniqueOrThrow({ where: { id: lost.id } });
      assert.equal(JSON.stringify(saved.raw), before);
      assert.equal(saved.status, "CONFIRMED");
      assert.equal(saved.resolvedById, steward.id);
      assert.ok(saved.resolvedAt);
      const p = saved.proposed as Record<string, unknown>;
      assert.equal(p.outcome, "LEGACY_UNCLASSIFIED");
      assert.equal(p.applied, undefined);
    });
    await t.test("Brief and Lost merge regardless of stale key; legacy outcome stays verbatim", async () => {
      assert.ok("ok" in await applyImportRun(db, steward, run.id));
      const imported = await db.opportunity.findMany({ where: { client: { name: proposed.clientName } } });
      assert.equal(imported.length, 1);
      assert.equal(imported[0].stage, "BIDDING");
      assert.equal(imported[0].outcome, "LEGACY_UNCLASSIFIED");
      assert.equal(imported[0].legacyStatus, "  FAIL <script>  ");
      assert.equal(imported[0].briefReceivedAt?.toISOString(), "2027-02-28T17:00:00.000Z");
      assert.equal(await db.opportunityStageEvent.count({ where: { opportunityId: imported[0].id, note: "Nhập từ tracker" } }), 1);
      assert.ok((await db.trackerImportRow.findUniqueOrThrow({ where: { id: brief.id } })).proposed);
    });
    await t.test("new client pending PIC; known touch confirmed and unknown level draft", async () => {
      const client = await db.client.findUniqueOrThrow({ where: { name: proposed.clientName } });
      assert.equal(client.importStatus, "PENDING_PIC_CONFIRM");
      assert.equal(client.picAccountId, f.picAccount.id);
      const known = await db.touchpoint.findFirstOrThrow({ where: { sourceId: touch.id } });
      assert.equal(known.sourceType, "IMPORT"); assert.equal(known.status, "CONFIRMED"); assert.equal(known.outcomeLevel, 2);
      assert.equal((await db.touchpoint.findFirstOrThrow({ where: { sourceId: draft.id } })).status, "DRAFT");
      assert.equal((await db.trackerImportRow.findUniqueOrThrow({ where: { id: duplicate.id } })).status, "DUPLICATE");
      assert.equal(await db.touchpoint.count({ where: { sourceId: duplicate.id } }), 0);
    });
    await t.test("repeat and concurrent apply produce no duplicate records", async () => {
      const count = async () => [await db.client.count({ where: { name: { startsWith: prefix } } }), await db.opportunity.count({ where: { client: { name: { startsWith: prefix } } } }), await db.touchpoint.count({ where: { sourceId: { in: [touch.id, draft.id] } } })];
      const before = await count();
      const results = await Promise.all([applyImportRun(db, steward, run.id), applyImportRun(db, steward, run.id)]);
      assert.ok(results.every((r) => "ok" in r));
      assert.deepEqual(await count(), before);
      assert.equal((await db.trackerImportRun.findUniqueOrThrow({ where: { id: run.id } })).mode, "APPLIED");
      assert.ok("error" in await resolveImportRow(db, steward, { rowId: touch.id, action: "SKIP" }));
    });
    await t.test("MATCH applies selected client; SKIP never writes a client", async () => {
      assert.ok("ok" in await resolveImportRow(db, steward, { rowId: duplicate.id, action: "MATCH", matchedClientId: f.client.id }));
      const skipped = await row("Prospect", 9, "UNCLEAR", { clientName: `${prefix} Skipped` });
      assert.ok("ok" in await resolveImportRow(db, steward, { rowId: skipped.id, action: "SKIP" }));
      assert.ok("ok" in await applyImportRun(db, steward, run.id));
      const saved = await db.trackerImportRow.findUniqueOrThrow({ where: { id: duplicate.id } });
      assert.equal((saved.proposed as { applied: { clientId: string } }).applied.clientId, f.client.id);
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: f.client.id } })).importStatus, "PENDING_PIC_CONFIRM");
      assert.equal(await db.client.count({ where: { name: `${prefix} Skipped` } }), 0);
    });
    await t.test("invalid PIC and unresolved date roll back row without marking applied", async () => {
      const invalid = await row("Brief", 12, "OK", { clientName: `${prefix} Invalid`, picAccountId: "missing" });
      const result = await applyImportRun(db, steward, run.id);
      assert.ok(result.errors?.some((e) => e.rowId === invalid.id));
      assert.equal(await db.client.count({ where: { name: `${prefix} Invalid` } }), 0);
      assert.equal((await db.trackerImportRow.findUniqueOrThrow({ where: { id: invalid.id } })).proposed && ((await db.trackerImportRow.findUniqueOrThrow({ where: { id: invalid.id } })).proposed as Record<string, unknown>).applied, undefined);
      assert.ok("error" in await resolveImportRow(db, steward, { rowId: invalid.id, action: "EDIT", proposedPatch: { period: { kind: "TEXT", raw: "sau Tết" } } }));
    });
    await t.test("CREATE_NEW requires a distinct reviewed name; textual dates can be corrected beside original", async () => {
      const fresh = await row("CSKH", 15, "DUPLICATE", { clientName: f.client.name, matchedClientId: f.client.id }, { "Ngày thực tế": "sau Tết" });
      assert.ok("ok" in await resolveImportRow(db, steward, { rowId: fresh.id, action: "CREATE_NEW" }));
      const collision = await applyImportRun(db, steward, run.id);
      assert.ok(collision.errors?.some((e) => e.rowId === fresh.id));
      assert.ok("ok" in await resolveImportRow(db, steward, { rowId: fresh.id, action: "EDIT", proposedPatch: { clientName: `${prefix} Distinct`, occurredAt: "2027-02-15T17:00:00Z" } }));
      await Promise.all([applyImportRun(db, steward, run.id), applyImportRun(db, steward, run.id)]);
      assert.equal(await db.client.count({ where: { name: `${prefix} Distinct` } }), 1);
      assert.equal(await db.touchpoint.count({ where: { sourceId: fresh.id } }), 1);
      assert.deepEqual((await db.trackerImportRow.findUniqueOrThrow({ where: { id: fresh.id } })).raw, { "Ngày thực tế": "sau Tết" });
    });
  } finally {
    if (runId) await db.trackerImportRun.delete({ where: { id: runId } });
    await cleanupCrmFixture(db, prefix);
    await db.$disconnect();
  }
});
