import { PrismaClient } from "@prisma/client";

const PINNED_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const mode = process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : null;
if (!mode) throw new Error("Use --before or --after.");
if (process.env.DATABASE_URL !== PINNED_URL) {
  throw new Error(`Refusing Phase 9 migration verification outside ${PINNED_URL}`);
}

const client = new PrismaClient();
try {
  const database = await client.$queryRawUnsafe("SELECT current_database() AS name");
  if (database[0]?.name !== "taskflow") throw new Error("Unexpected database.");
  const counts = await client.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM "User") AS users,
      (SELECT COUNT(*)::int FROM "WorkflowRequest") AS requests,
      (SELECT COUNT(*)::int FROM "WorkflowFile") AS files
  `);
  if (mode === "after") {
    const schema = await client.$queryRawUnsafe(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'signaturePinHash'
        ) AS pin_column,
        to_regclass('public."WorkflowSignatureAsset"') IS NOT NULL AS asset_table,
        to_regclass('public."WorkflowSignatureAssetAudit"') IS NOT NULL AS audit_table
    `);
    const indexes = await client.$queryRawUnsafe(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('WorkflowSignatureAsset', 'WorkflowSignatureAssetAudit')
    `);
    const foreignKeys = await client.$queryRawUnsafe(`
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid IN (
          '"WorkflowSignatureAsset"'::regclass,
          '"WorkflowSignatureAssetAudit"'::regclass
        )
    `);
    const row = schema[0];
    if (!row.pin_column || !row.asset_table || !row.audit_table) {
      throw new Error("Phase 9 signature schema readback failed.");
    }
    const names = new Set(indexes.map((entry) => entry.indexname));
    for (const expected of [
      "WorkflowSignatureAsset_ownerId_key",
      "WorkflowSignatureAsset_sha256_idx",
      "WorkflowSignatureAssetAudit_ownerId_createdAt_idx",
      "WorkflowSignatureAssetAudit_actorId_createdAt_idx",
    ]) {
      if (!names.has(expected)) throw new Error(`Missing index ${expected}`);
    }
    const fkNames = new Set(foreignKeys.map((entry) => entry.conname));
    for (const expected of [
      "WorkflowSignatureAsset_ownerId_fkey",
      "WorkflowSignatureAssetAudit_assetId_fkey",
      "WorkflowSignatureAssetAudit_ownerId_fkey",
      "WorkflowSignatureAssetAudit_actorId_fkey",
    ]) {
      if (!fkNames.has(expected)) throw new Error(`Missing foreign key ${expected}`);
    }
  }
  console.log(JSON.stringify({ mode, database: database[0].name, counts: counts[0] }));
} finally {
  await client.$disconnect();
}
