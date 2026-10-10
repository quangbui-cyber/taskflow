import { PrismaClient } from "@prisma/client";

const PINNED_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const mode = process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : null;
if (!mode) throw new Error("Use --before or --after.");
if (process.env.DATABASE_URL !== PINNED_URL) throw new Error(`Refusing verification outside ${PINNED_URL}`);

const prisma = new PrismaClient();
try {
  const [database] = await prisma.$queryRawUnsafe("SELECT current_database() AS name");
  if (database?.name !== "taskflow") throw new Error("Unexpected database.");
  const [counts] = await prisma.$queryRawUnsafe(`SELECT (SELECT COUNT(*)::int FROM "User") AS users, (SELECT COUNT(*)::int FROM "WorkflowRequest") AS requests`);
  const duplicateActive = await prisma.$queryRawUnsafe(`SELECT "replacesRequestId", COUNT(*)::int AS count FROM "WorkflowRequest" WHERE "replacesRequestId" IS NOT NULL AND "state" IN ('DRAFT','SUBMITTED','RETURNED') GROUP BY "replacesRequestId" HAVING COUNT(*) > 1`);
  if (duplicateActive.length) throw new Error("Multiple active replacements already exist.");
  if (mode === "after") {
    const [column] = await prisma.$queryRawUnsafe(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='WorkflowTemplate' AND column_name='requiresExecutionTracking') AS present`);
    const [index] = await prisma.$queryRawUnsafe(`SELECT to_regclass('public."WorkflowRequest_one_active_replacement_per_source_key"') IS NOT NULL AS present`);
    if (!column.present || !index.present) throw new Error("Revision guard migration is incomplete.");
  }
  console.log(JSON.stringify({ mode, database: database.name, counts, duplicateActive: duplicateActive.length }));
} finally {
  await prisma.$disconnect();
}
