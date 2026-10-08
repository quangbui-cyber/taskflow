import { PrismaClient } from "@prisma/client";

const mode = process.argv[2];
if (!['--before', '--after'].includes(mode)) {
  console.error("Usage: node scripts/verify-phase7-migration.mjs --before|--after");
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (
  !["postgres:", "postgresql:"].includes(url.protocol)
  || url.hostname !== "127.0.0.1"
  || url.port !== "55439"
  || url.pathname !== "/taskflow"
) {
  throw new Error("Phase 7 migration verification only permits postgresql://postgres@127.0.0.1:55439/taskflow");
}

const prisma = new PrismaClient();
const requiredTables = [
  "PaymentRequestLine",
  "PaymentRecipientSnapshot",
  "CostFlowCashAllocation",
  "PaymentLineDiscussion",
  "AdvanceApplication",
];
const requiredCashColumns = ["idempotencyKey", "commandFingerprint", "channel"];
const requiredIndexes = [
  "CostFlowCash_projectId_reference_key",
  "CostFlowCash_projectId_idempotencyKey_key",
  "CostFlowCash_projectId_requestId_recipientKey_direction_idx",
  // PostgreSQL truncates identifiers to 63 bytes; Prisma resolves this same physical index.
  "CostFlowCashAllocation_projectId_requestId_recipientKey_directi",
  "PaymentRequestLine_requestId_stableKey_key",
  "PaymentRecipientSnapshot_requestId_recipientKey_key",
];

try {
  const tables = await prisma.$queryRaw`
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `;
  const tableNames = new Set(tables.map(row => row.name));
  const columns = await prisma.$queryRaw`
    SELECT column_name AS name, is_nullable AS nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CostFlowCash'
  `;
  const indexes = await prisma.$queryRaw`
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = 'public'
  `;
  const indexNames = new Set(indexes.map(row => row.name));

  if (!tableNames.has("CostFlowCash")) throw new Error("CostFlowCash base table is missing.");
  const inventory = {
    mode,
    database: `${url.hostname}:${url.port}${url.pathname}`,
    tables: Object.fromEntries(requiredTables.map(name => [name, tableNames.has(name)])),
    cashColumns: Object.fromEntries(requiredCashColumns.map(name => [name, columns.find(column => column.name === name) ?? null])),
    indexes: Object.fromEntries(requiredIndexes.map(name => [name, indexNames.has(name)])),
  };

  if (mode === "--after") {
    for (const name of requiredTables) if (!tableNames.has(name)) throw new Error(`Missing table ${name}`);
    for (const name of requiredCashColumns) {
      const column = columns.find(item => item.name === name);
      if (!column || column.nullable !== "NO") throw new Error(`Missing required CostFlowCash.${name}`);
    }
    for (const name of requiredIndexes) if (!indexNames.has(name)) throw new Error(`Missing index ${name}`);
    const [legacyCash] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM "CostFlowCash"
      WHERE "idempotencyKey" LIKE 'legacy:%'
    `;
    const [normalizedRows] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count FROM "PaymentRequestLine"
    `;
    inventory.representativeRows = { legacyCash: legacyCash.count, normalizedLines: normalizedRows.count };
  }

  console.log(JSON.stringify(inventory));
} finally {
  await prisma.$disconnect();
}
