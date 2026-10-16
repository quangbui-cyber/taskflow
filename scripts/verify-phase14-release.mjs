import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE = "postgresql://postgres@127.0.0.1:55439/costflow_test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = path.join(root, ".codex-tmp", "phase14-release-evidence.json");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const database = argument("--database");
const port = Number(argument("--port"));
if (database !== PINNED_DATABASE) throw new Error(`Phase 14 verifier refuses database other than ${PINNED_DATABASE}`);
if (port !== 3017) throw new Error("Phase 14 browser verification refuses any port other than 3017.");
process.env.DATABASE_URL = PINNED_DATABASE;

function run(label, executable, args, env = process.env) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd: root, env: { ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if ((result.status ?? 1) !== 0) throw new Error(`${label} failed\n${output}`);
  return { label, command: [executable, ...args].join(" "), startedAt, finishedAt: new Date().toISOString(), outputHash: createHash("sha256").update(output).digest("hex") };
}

async function publicFingerprint(client) {
  const tables = await client.$queryRawUnsafe(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  const rows = [];
  for (const { name } of tables) {
    assert.match(name, /^[A-Za-z0-9_]+$/);
    const [value] = await client.$queryRawUnsafe(`SELECT COUNT(*)::text AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS hash FROM "public"."${name}" t`);
    rows.push({ name, count: value.count, hash: value.hash });
  }
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function browserResult() {
  try {
    const response = await fetch(`http://localhost:${port}/login`, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    return { provenance: "browser_local", status: response.ok || response.status === 307 ? "PARTIAL" : "FAILED", url: `http://localhost:${port}/login`, httpStatus: response.status, screenshots: [], limitation: "Phase 14 authenticated screens require an explicitly migrated long-lived local DB." };
  } catch (error) {
    return { provenance: "browser_local", status: "BLOCKED", url: `http://localhost:${port}`, screenshots: [], limitation: `Local server unavailable or long-lived DB not migrated: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const client = new PrismaClient({ datasources: { db: { url: PINNED_DATABASE } } });
const commands = [];
try {
  const before = await publicFingerprint(client);
  commands.push(run("phase14-static-and-ui", process.execPath, ["--conditions=react-server", "--import=tsx", "--test", "--test-concurrency=1",
    "tests/costflow-supplier-schema.test.mjs",
    "tests/costflow-supplier-ui.test.mjs",
    "tests/costflow-vendor-invoice.test.mjs",
    "tests/costflow-vendor-payment.integration.test.mjs",
    "tests/costflow-vendor-payment-ui.test.mjs",
    "tests/costflow-phase14-legacy-cutover.test.mjs",
    "tests/costflow-phase14-full.integration.test.mjs",
    "tests/costflow-phase14-regression.test.mjs",
    "tests/costflow-phase14-ui-contract.test.mjs",
    "tests/vendor-payment-flow.test.ts",
    "tests/vendor-payment-ui-contract.test.ts",
    "tests/costflow-settlement-engine.test.mjs",
    "tests/costflow-settlement-export.test.mjs",
    "tests/costflow-settlement-cancel.test.mjs",
  ]));
  commands.push(run("phase14-database", process.execPath, ["--conditions=react-server", "--import=tsx", "--test", "--test-concurrency=1",
    "tests/costflow-supplier-migration.integration.test.mjs",
    "tests/costflow-supplier-service.integration.test.mjs",
    "tests/costflow-vendor-payment-db.integration.test.mjs",
    "tests/costflow-phase12-pilot.integration.test.mjs",
    "tests/costflow-phase12-regression.test.mjs",
  ], { ...process.env, DATABASE_URL: PINNED_DATABASE }));
  commands.push(run("typecheck", "npx.cmd", ["tsc", "--noEmit"]));
  commands.push(run("scoped-lint", "npx.cmd", ["eslint",
    "app/suppliers", "components/costflow/suppliers", "components/costflow/payments",
    "components/ExpenseDetailDrawer.tsx", "components/ExpenseRequestModal.tsx", "components/ExpenseUploadModal.tsx",
    "lib/costflow/supplierService.ts", "lib/costflow/supplierReadModel.ts", "lib/costflow/vendorInvoice.ts",
    "lib/costflow/vendorPaymentService.ts", "lib/costflow/actualCostReadModel.ts", "lib/costflow/settlementService.ts",
  ]));
  commands.push(run("build", "npm.cmd", ["run", "build:app"], { ...process.env, DATABASE_URL: PINNED_DATABASE, NODE_ENV: "production" }));
  const after = await publicFingerprint(client);
  assert.equal(after, before, "Phase 14 verifier changed the public costflow_test schema/data; only disposable schemas are allowed.");

  const browser = await browserResult();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const files = ["prisma/schema.prisma", "lib/costflow/vendorPaymentService.ts", "lib/costflow/service.ts", "docs/COSTFLOW_SUPPLIER_PAYMENT.md"];
  const hashes = Object.fromEntries(files.map(file => [file, createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex")]));
  const manifest = {
    phase: 14,
    generatedAt: new Date().toISOString(),
    commit,
    database: PINNED_DATABASE,
    databasePublicFingerprint: before,
    port,
    commands,
    hashes,
    counts: { commands: commands.length, phase14Requirements: 8, supplierAndVatMigrations: 2 },
    browser,
    knownLimitations: ["Bank API pending", "Tax-authority XML parsing pending", "Authenticated Phase 14 browser smoke blocked until intentional local taskflow migration", "Native human, company pilot and production acceptance pending"],
    release: { RELEASE_VERDICT: "NOT_READY", phaseStatus: "human_needed", automatedTechnicalVerification: "PASSED", companyAcceptance: "PENDING", productionDeployment: "NOT_EXECUTED" },
  };
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, evidencePath, release: manifest.release, browser }, null, 2));
} finally {
  await client.$disconnect();
}
