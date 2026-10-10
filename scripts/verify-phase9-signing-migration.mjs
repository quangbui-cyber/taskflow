import { PrismaClient } from "@prisma/client";

const PINNED_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const mode = process.argv.includes("--before") ? "before" : process.argv.includes("--after") ? "after" : null;
if (!mode) throw new Error("Use --before or --after.");
if (process.env.DATABASE_URL !== PINNED_URL) throw new Error(`Refusing outside ${PINNED_URL}`);
const prisma = new PrismaClient();
try {
  const counts = await prisma.$queryRawUnsafe(`SELECT (SELECT COUNT(*)::int FROM "User") users, (SELECT COUNT(*)::int FROM "WorkflowRequest") requests, (SELECT COUNT(*)::int FROM "WorkflowFile") files`);
  if (mode === "after") {
    const tables = await prisma.$queryRawUnsafe(`SELECT to_regclass('public."WorkflowApprovedSnapshot"') IS NOT NULL snapshot, to_regclass('public."WorkflowSigningEvent"') IS NOT NULL event, to_regclass('public."WorkflowSigningLifecycle"') IS NOT NULL lifecycle, to_regclass('public."WorkflowSigningCommand"') IS NOT NULL command`);
    if (!Object.values(tables[0]).every(Boolean)) throw new Error("Signing foundation tables missing.");
    const columns = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='WorkflowSigningEvent'`);
    const names = new Set(columns.map((row) => row.column_name));
    for (const name of ["signerIpNormalized","signerIpSource","eventHash","signaturePngData"]) if (!names.has(name)) throw new Error(`Missing ${name}`);
    const constraints = await prisma.$queryRawUnsafe(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid IN ('"WorkflowApprovedSnapshot"'::regclass,'"WorkflowSigningEvent"'::regclass,'"WorkflowSigningLifecycle"'::regclass,'"WorkflowSigningCommand"'::regclass)`);
    if (constraints.some((row) => row.confdeltype === "c")) throw new Error("Signing audit constraints must not cascade-delete.");
  }
  console.log(JSON.stringify({ mode, counts: counts[0] }));
} finally {
  await prisma.$disconnect();
}
