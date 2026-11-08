import assert from "node:assert/strict";
import test from "node:test";
import { createCrmTestDb, crmTestDatabaseUrl } from "./helpers/crmTestDb";

test("CRM foundation seeds program types, aliases, reasons and safe unconfigured settings", { skip: !crmTestDatabaseUrl() }, async () => {
  const db = createCrmTestDb();
  try {
    const codes = ["TEAMBUILDING", "MICE", "ACTIVATION", "EVENT", "PUR", "OTHER", "OUTING", "YEP"];
    const types = await db.programType.findMany();
    for (const code of codes) assert.equal(types.find((t) => t.code === code)?.active, true, code);
    const projects = await db.project.findMany({ distinct: ["type"], select: { type: true } });
    for (const p of projects) assert.ok(types.some((t) => t.code === p.type));
    const settings = await db.crmSetting.findMany();
    assert.equal(settings.length, 6);
    assert.deepEqual(settings.find((s) => s.key === "tier.cadenceWeeks")?.value, { S: 2, A: 4, B: 8, C: 13, UNRATED: 4 });
    assert.deepEqual(settings.find((s) => s.key === "tier.potentialScale")?.value, []);
    assert.deepEqual(settings.find((s) => s.key === "tier.matrix")?.value, { revenueBands: [], cells: {} });
    assert.deepEqual(settings.find((s) => s.key === "pipeline.mode")?.value, { mode: "PROJECT_OFFICIAL", pilotTeamIds: [], plannedCutoverDate: null });
    assert.ok(settings.some((s) => s.key === "reminder.offsets"));
    assert.ok(settings.some((s) => s.key === "review.priority"));
    const lost = await db.crmReason.findMany({ where: { group: "LOST" } });
    assert.equal(lost.length, 6);
    assert.equal(lost.find((r) => r.label === "Khác")?.requiresNote, true);
    assert.equal(await db.crmReason.count({ where: { group: "CANCELLED" } }), 4);
    assert.equal(await db.crmReason.count({ where: { group: "DECLINED" } }), 5);
    assert.equal((await db.programTypeAlias.findUnique({ where: { alias: "year end party" } }))?.code, "YEP");
  } finally { await db.$disconnect(); }
});
