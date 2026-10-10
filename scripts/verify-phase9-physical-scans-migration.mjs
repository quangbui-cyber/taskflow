import { PrismaClient } from "@prisma/client";
const PINNED_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const mode = process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : null;
if (!mode) throw new Error("Use --before or --after.");
if (process.env.DATABASE_URL !== PINNED_URL) throw new Error(`Refusing verification outside ${PINNED_URL}`);
const client = new PrismaClient();
try {
  const [database] = await client.$queryRawUnsafe("SELECT current_database() AS name");
  if (database?.name !== "taskflow") throw new Error("Unexpected database.");
  const [counts] = await client.$queryRawUnsafe(`SELECT (SELECT COUNT(*)::int FROM "User") AS users, (SELECT COUNT(*)::int FROM "WorkflowRequest") AS requests`);
  if (mode === "after") {
    const [tables] = await client.$queryRawUnsafe(`SELECT to_regclass('public."WorkflowPhysicalScanBatch"') IS NOT NULL AS batch_table, to_regclass('public."WorkflowPhysicalScanFile"') IS NOT NULL AS file_table, to_regclass('public."WorkflowPhysicalSigningTransition"') IS NOT NULL AS transition_table`);
    if (!tables.batch_table || !tables.file_table || !tables.transition_table) throw new Error("Physical scan tables are missing.");
    const indexes = await client.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('WorkflowPhysicalScanBatch','WorkflowPhysicalScanFile','WorkflowPhysicalSigningTransition')`);
    const names = new Set(indexes.map(row => row.indexname));
    for (const expected of ["WorkflowPhysicalScanBatch_requestId_version_key", "WorkflowPhysicalScanFile_sha256_idx", "WorkflowPhysicalSigningTransition_requestId_createdAt_idx"]) if (!names.has(expected)) throw new Error(`Missing index ${expected}`);
  }
  console.log(JSON.stringify({ mode, database: database.name, counts }));
} finally { await client.$disconnect(); }
