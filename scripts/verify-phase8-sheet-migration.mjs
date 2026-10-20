import { PrismaClient } from "@prisma/client";

function approvedDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/taskflow") {
    throw new Error("Bảng AC migration verification only permits postgresql://postgres@127.0.0.1:55439/taskflow.");
  }
}

approvedDatabaseUrl();
const mode = process.argv[2];
if (!["--before", "--after"].includes(mode)) throw new Error("Use --before or --after.");

const tables = [
  "ActualCostSheet",
  "ActualCostSheetRevision",
  "ActualCostSheetRevisionLine",
  "ActualCostFundingAllocation",
  "ActualCostSheetEvent",
];
const indexes = [
  "ActualCostSheet_projectId_key",
  "ActualCostSheetRevision_sheetId_revision_key",
  "ActualCostSheetRevision_one_open_key",
  "ActualCostSheetRevision_manifest_key",
  "ActualCostSheetRevisionLine_revisionId_lineId_key",
  "ActualCostFundingAllocation_versionId_position_key",
];

const prisma = new PrismaClient();
try {
  const tableRows = await prisma.$queryRawUnsafe(`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (${tables.map((_, index) => `$${index + 1}`).join(", ")})
    ORDER BY table_name
  `, ...tables);
  const foundTables = tableRows.map(row => row.tableName);
  if (mode === "--before" && foundTables.length) {
    throw new Error(`New Bảng AC tables already exist before migration: ${foundTables.join(", ")}`);
  }
  if (mode === "--after") {
    const missing = tables.filter(table => !foundTables.includes(table));
    if (missing.length) throw new Error(`Bảng AC tables missing after migration: ${missing.join(", ")}`);
    const indexRows = await prisma.$queryRawUnsafe(`
      SELECT indexname AS "indexName" FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN (${indexes.map((_, index) => `$${index + 1}`).join(", ")})
      ORDER BY indexname
    `, ...indexes);
    const foundIndexes = indexRows.map(row => row.indexName);
    const missingIndexes = indexes.filter(index => !foundIndexes.includes(index));
    if (missingIndexes.length) throw new Error(`Bảng AC indexes missing after migration: ${missingIndexes.join(", ")}`);
  }
  console.log(JSON.stringify({ mode, database: "127.0.0.1:55439/taskflow", foundTables, expectedTables: tables.length }, null, 2));
} finally {
  await prisma.$disconnect();
}
