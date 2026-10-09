import { PrismaClient } from "@prisma/client";

function approvedDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/taskflow") {
    throw new Error("Phase 8 migration verification only permits postgresql://postgres@127.0.0.1:55439/taskflow.");
  }
  return url;
}

approvedDatabaseUrl();
const mode = process.argv[2];
if (!['--before', '--after'].includes(mode)) throw new Error("Use --before or --after.");

const prisma = new PrismaClient();
const tables = [
  "ActualCostLine",
  "ActualCostVersion",
  "ActualCostApproval",
  "ActualCostEvidenceLink",
  "ActualCostApplication",
  "CustomerLiquidation",
  "CustomerCashIn",
  "CustomerAcceptanceSnapshot",
  "CustomerAcceptanceExport",
];

try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${tables.map((_, index) => `$${index + 1}`).join(", ")})
    ORDER BY table_name
  `, ...tables);
  const found = rows.map(row => row.tableName);
  if (mode === "--after") {
    const missing = tables.filter(table => !found.includes(table));
    if (missing.length) throw new Error(`Phase 8 tables missing after migration: ${missing.join(", ")}`);
    const indexes = await prisma.$queryRawUnsafe(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'WorkflowRoleGrant_one_active_ac_dd_key'
    `);
    if (indexes.length !== 1) throw new Error("Active AC_DD partial unique index is missing.");
  }
  console.log(JSON.stringify({ mode, database: "127.0.0.1:55439/taskflow", phase8Tables: found, expectedCount: tables.length }, null, 2));
} finally {
  await prisma.$disconnect();
}
