import process from "node:process";

const usage = `Usage:
  node --conditions=react-server --import=tsx scripts/seal-phase10-export-projections.mjs --project <project-id>

Reads only immutable CostFlowHistory.exportSourceSeal snapshots for the named Project.
It never creates approvals, signatures, cash, settlement locks, or financial-close events.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}

const projectIndex = process.argv.indexOf("--project");
const projectId = projectIndex >= 0 ? String(process.argv[projectIndex + 1] ?? "").trim() : "";
if (!projectId) {
  process.stderr.write(`${usage}\n`);
  process.exit(1);
}

const { Prisma } = await import("@prisma/client");
const { prisma } = await import("../lib/prisma.ts");
const { sealLegacyExportSourceProjection } = await import("../lib/costflow/exportSourceProjection.ts");

function tupleFromHistory(row) {
  const snapshot = row.snapshot && typeof row.snapshot === "object" && !Array.isArray(row.snapshot) ? row.snapshot : null;
  const seal = snapshot?.exportSourceSeal;
  if (!seal || typeof seal !== "object" || Array.isArray(seal)) return null;
  const tuple = {
    projectId,
    family: String(seal.family ?? ""),
    sourceKind: String(seal.sourceKind ?? ""),
    sourceId: String(seal.sourceId ?? ""),
    sourceVersion: Number(seal.sourceVersion),
  };
  return tuple.family && tuple.sourceKind && tuple.sourceId && Number.isSafeInteger(tuple.sourceVersion) ? tuple : null;
}

try {
  const histories = await prisma.costFlowHistory.findMany({ where: { projectId }, select: { version: true, snapshot: true }, orderBy: { version: "asc" } });
  const tuples = histories.map(tupleFromHistory).filter(Boolean);
  const unique = [...new Map(tuples.map(tuple => [`${tuple.family}:${tuple.sourceKind}:${tuple.sourceId}:${tuple.sourceVersion}`, tuple])).values()];
  const results = [];
  for (const tuple of unique) {
    const result = await prisma.$transaction(
      tx => sealLegacyExportSourceProjection(tx, tuple),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    );
    results.push({ tuple, status: result.status, ...(result.status === "BLOCKED" ? { reason: result.reason } : { projectionId: result.projection.id }) });
  }
  process.stdout.write(`${JSON.stringify({ projectId, discovered: unique.length, results }, null, 2)}\n`);
  if (results.some(result => result.status === "BLOCKED")) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
