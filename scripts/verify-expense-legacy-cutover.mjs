import { PrismaClient } from "@prisma/client";

function assertPinnedLocalDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/taskflow") {
    throw new Error("Legacy expense verification only permits postgresql://postgres@127.0.0.1:55439/taskflow.");
  }
}

assertPinnedLocalDatabase();
const prisma = new PrismaClient();

try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      "projectId",
      "version",
      jsonb_array_length(CASE
        WHEN jsonb_typeof("data"::jsonb -> 'expenses') = 'array' THEN "data"::jsonb -> 'expenses'
        ELSE '[]'::jsonb
      END)::int AS "expenseCount"
    FROM "CostFlowWorkspace"
    WHERE jsonb_array_length(CASE
      WHEN jsonb_typeof("data"::jsonb -> 'expenses') = 'array' THEN "data"::jsonb -> 'expenses'
      ELSE '[]'::jsonb
    END) > 0
    ORDER BY "projectId"
  `);
  const projects = rows.map(row => ({
    projectId: row.projectId,
    workspaceVersion: row.version,
    expenseCount: row.expenseCount,
  }));
  console.log(JSON.stringify({
    database: "127.0.0.1:55439/taskflow",
    mode: "read-only",
    projectsWithHistoricalExpenses: projects.length,
    historicalExpenseRows: projects.reduce((sum, row) => sum + row.expenseCount, 0),
    projects,
    cleanupPerformed: false,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
