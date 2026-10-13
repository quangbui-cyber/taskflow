import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import { PrismaClient, type Prisma } from "@prisma/client";

export const PHASE12_TEST_DATABASE_URL =
  "postgresql://postgres@127.0.0.1:55439/costflow_test";

const PHASE12_SCHEMA_PREFIX = "phase12_";
const taskflowRoot = path.resolve(import.meta.dirname, "../..");

export type Phase12ScenarioKind = "TEAMBUILDING" | "POSM_JABIL";

export type Phase12Scenario = {
  kind: Phase12ScenarioKind;
  projectId: string;
  actorIds: string[];
  sourceDocuments: string[];
  lineage: {
    quotationId: string;
    icRevisionId: string;
    paymentRequestId: string;
    actualCostVersionId: string;
    settlementAttemptId: string;
  };
};

function databaseName(url: URL) {
  return url.pathname.replace(/^\//, "");
}

export function assertPhase12TestDatabaseUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    throw new Error("Phase 12 requires DATABASE_URL for costflow_test.");
  }

  const url = new URL(rawUrl);
  const schema = url.searchParams.get("schema");
  const isPinnedHost = url.hostname === "127.0.0.1" && url.port === "55439";
  const isPinnedDatabase = databaseName(url) === "costflow_test";
  const isAllowedSchema = schema === null || schema.startsWith(PHASE12_SCHEMA_PREFIX);

  if (!isPinnedHost || !isPinnedDatabase || !isAllowedSchema) {
    throw new Error(
      "Phase 12 automation is restricted to postgresql://postgres@127.0.0.1:55439/costflow_test and phase12_* schemas.",
    );
  }
}

function testOnlyPasswordHash(id: string) {
  return createHash("sha256").update(`phase12-disabled-login:${id}`).digest("hex");
}

export async function withPhase12TestSchema<T>(
  run: (context: {
    client: PrismaClient;
    schemaName: string;
    databaseUrl: string;
  }) => Promise<T>,
): Promise<T> {
  const baseUrl = process.env.DATABASE_URL ?? PHASE12_TEST_DATABASE_URL;
  assertPhase12TestDatabaseUrl(baseUrl);

  const schemaName = `${PHASE12_SCHEMA_PREFIX}${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = `${PHASE12_TEST_DATABASE_URL}?schema=${schemaName}`;
  assertPhase12TestDatabaseUrl(databaseUrl);

  const admin = new PrismaClient({
    datasources: { db: { url: PHASE12_TEST_DATABASE_URL } },
  });
  let client: PrismaClient | undefined;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  try {
    execFileSync(
      process.execPath,
      [
        path.join(taskflowRoot, "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
      ],
      {
        cwd: taskflowRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "pipe",
      },
    );
    process.env.DATABASE_URL = databaseUrl;
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    return await run({ client, schemaName, databaseUrl });
  } finally {
    process.env.DATABASE_URL = previousDatabaseUrl;
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    const remaining = await admin.$queryRaw<Array<{ schema_name: string }>>`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = ${schemaName}
    `;
    await admin.$disconnect();
    if (remaining.length !== 0) {
      throw new Error(`Phase 12 disposable schema cleanup failed: ${schemaName}`);
    }
  }
}

export async function createPhase12Scenario(
  client: PrismaClient,
  kind: Phase12ScenarioKind,
): Promise<Phase12Scenario> {
  const suffix = randomUUID();
  const prefix = kind === "TEAMBUILDING" ? "tb" : "posm";
  const actorIds = ["owner", "manager", "accountant", "ceo"].map(
    (role) => `${prefix}-${role}-${suffix}`,
  );
  const [ownerId, managerId, accountantId, ceoId] = actorIds;
  const projectId = `${prefix}-project-${suffix}`;
  const lineage = {
    quotationId: `quotation-${suffix}`,
    icRevisionId: `ic-revision-${suffix}`,
    paymentRequestId: `payment-request-${suffix}`,
    actualCostVersionId: `actual-cost-version-${suffix}`,
    settlementAttemptId: `settlement-attempt-${suffix}`,
  };
  const sourceDocuments =
    kind === "POSM_JABIL"
      ? [
          "PO-C-10003769550_v1_20260914.pdf",
          "PO-C-10003773297_v1_20260916.pdf",
        ]
      : [];

  await client.user.createMany({
    data: [
      {
        id: managerId,
        email: `${managerId}@phase12.invalid`,
        name: "Phase 12 Manager",
        passwordHash: testOnlyPasswordHash(managerId),
        role: "USER",
      },
      {
        id: accountantId,
        email: `${accountantId}@phase12.invalid`,
        name: "Phase 12 Accountant",
        passwordHash: testOnlyPasswordHash(accountantId),
        role: "ACCOUNT",
      },
      {
        id: ceoId,
        email: `${ceoId}@phase12.invalid`,
        name: "Phase 12 CEO",
        passwordHash: testOnlyPasswordHash(ceoId),
        role: "USER",
      },
      {
        id: ownerId,
        email: `${ownerId}@phase12.invalid`,
        name: "Phase 12 Owner",
        passwordHash: testOnlyPasswordHash(ownerId),
        role: "ACCOUNT",
        managerId,
      },
    ],
  });

  const workspaceData: Prisma.InputJsonObject = {
    phase12: {
      scenario: kind,
      provenance: "automated_local",
      schemaName: new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema"),
      releaseStatus: "NOT_READY",
      sourceDocuments,
      lineage,
      primitiveInputs:
        kind === "TEAMBUILDING"
          ? { guests: 120, days: 2, nights: 1, currency: "VND" }
          : { purchaseOrderCount: 2, currency: "VND" },
    },
  };

  await client.project.create({
    data: {
      id: projectId,
      name:
        kind === "TEAMBUILDING"
          ? `Phase 12 Teambuilding ${suffix}`
          : `Phase 12 POSM JABIL ${suffix}`,
      type: kind === "TEAMBUILDING" ? "TEAMBUILDING" : "OTHER",
      purchaseOrderNumber:
        kind === "POSM_JABIL" ? `PHASE12-PO-${suffix}` : null,
      ownerId,
      members: {
        create: actorIds.map((userId) => ({
          userId,
          role: userId === ownerId ? "owner" : "member",
        })),
      },
      costFlow: { create: { data: workspaceData } },
    },
  });

  return { kind, projectId, actorIds, sourceDocuments, lineage };
}
