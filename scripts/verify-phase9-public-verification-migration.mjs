import { PrismaClient } from "@prisma/client";

const PINNED_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const mode = process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : null;
if (!mode) throw new Error("Use --before or --after.");
if (process.env.DATABASE_URL !== PINNED_URL) throw new Error(`Refusing verification outside ${PINNED_URL}`);

const client = new PrismaClient();
try {
  const [database] = await client.$queryRawUnsafe("SELECT current_database() AS name");
  if (database?.name !== "taskflow") throw new Error("Unexpected database.");
  const [counts] = await client.$queryRawUnsafe(`SELECT
    (SELECT COUNT(*)::int FROM "User") AS users,
    (SELECT COUNT(*)::int FROM "WorkflowRequest") AS requests,
    (SELECT COUNT(*)::int FROM "WorkflowApprovedSnapshot") AS snapshots`);
  if (mode === "after") {
    const [tables] = await client.$queryRawUnsafe(`SELECT
      to_regclass('public."WorkflowPublicVerificationCapability"') IS NOT NULL AS capability_table,
      to_regclass('public."WorkflowPublicVerificationRateLimit"') IS NOT NULL AS rate_table`);
    if (!tables.capability_table || !tables.rate_table) throw new Error("Public verification tables are missing.");
    const indexes = await client.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='WorkflowPublicVerificationCapability'`);
    const names = new Set(indexes.map(row => row.indexname));
    for (const expected of [
      "WorkflowPublicVerificationCapability_snapshotId_key",
      "WorkflowPublicVerificationCapability_publicNonce_key",
      "WorkflowPublicVerificationCapability_tokenDigest_key",
    ]) if (!names.has(expected)) throw new Error(`Missing index ${expected}`);
    const columns = await client.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='WorkflowPublicVerificationCapability'`);
    const columnNames = new Set(columns.map(row => row.column_name));
    if (columnNames.has("token") || columnNames.has("plaintextToken")) throw new Error("Plaintext public token column must not exist.");
  }
  console.log(JSON.stringify({ mode, database: database.name, counts }));
} finally {
  await client.$disconnect();
}
