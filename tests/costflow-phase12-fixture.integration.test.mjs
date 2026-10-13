import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

import {
  PHASE12_TEST_DATABASE_URL,
  assertPhase12TestDatabaseUrl,
  createPhase12Scenario,
  withPhase12TestSchema,
} from "./phase12/pilotFixture.ts";

test("Phase 12 database guard rejects the long-lived application database", () => {
  assert.throws(
    () => assertPhase12TestDatabaseUrl("postgresql://postgres@127.0.0.1:55439/taskflow"),
    /costflow_test/i,
  );
  assert.doesNotThrow(() => assertPhase12TestDatabaseUrl(PHASE12_TEST_DATABASE_URL));
});

test("representative scenarios persist only primitive inputs and exact synthetic lineage", async () => {
  await withPhase12TestSchema(async ({ client, schemaName }) => {
    const teambuilding = await createPhase12Scenario(client, "TEAMBUILDING");
    const posm = await createPhase12Scenario(client, "POSM_JABIL");

    assert.notEqual(teambuilding.projectId, posm.projectId);
    assert.equal(teambuilding.actorIds.length, 4);
    assert.equal(posm.actorIds.length, 4);
    assert.equal(teambuilding.sourceDocuments.length, 0);
    assert.deepEqual(posm.sourceDocuments, [
      "PO-C-10003769550_v1_20260914.pdf",
      "PO-C-10003773297_v1_20260916.pdf",
    ]);

    for (const scenario of [teambuilding, posm]) {
      const project = await client.project.findUniqueOrThrow({
        where: { id: scenario.projectId },
        include: { members: true, costFlow: true },
      });
      assert.equal(project.members.length, 4);
      assert.equal(project.costFlow?.version, 0);
      assert.equal(project.costFlow?.data.phase12.provenance, "automated_local");
      assert.equal(project.costFlow?.data.phase12.schemaName, schemaName);
      assert.equal(project.costFlow?.data.phase12.releaseStatus, "NOT_READY");
      assert.match(scenario.lineage.quotationId, /^quotation-/);
      assert.match(scenario.lineage.icRevisionId, /^ic-revision-/);
      assert.match(scenario.lineage.paymentRequestId, /^payment-request-/);
      assert.match(scenario.lineage.actualCostVersionId, /^actual-cost-version-/);
      assert.match(scenario.lineage.settlementAttemptId, /^settlement-attempt-/);
    }

    const storedUsers = await client.user.findMany({
      where: { id: { in: [...teambuilding.actorIds, ...posm.actorIds] } },
      select: { signaturePinHash: true },
    });
    assert.ok(storedUsers.every((user) => user.signaturePinHash === null));
  });
});

test("disposable schema cleanup runs after a failing scenario", async () => {
  let schemaName = "";
  await assert.rejects(
    withPhase12TestSchema(async (ctx) => {
      schemaName = ctx.schemaName;
      await createPhase12Scenario(ctx.client, "TEAMBUILDING");
      throw new Error("forced-phase12-fixture-failure");
    }),
    /forced-phase12-fixture-failure/,
  );

  const admin = new PrismaClient({
    datasources: { db: { url: PHASE12_TEST_DATABASE_URL } },
  });
  try {
    const rows = await admin.$queryRawUnsafe(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${schemaName}'`,
    );
    assert.equal(rows.length, 0);
  } finally {
    await admin.$disconnect();
  }
});
