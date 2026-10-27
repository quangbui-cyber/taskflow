import { spawnSync } from "node:child_process";

// An explicit dedicated URL is required for legacy integration suites; Phase 10 gap suites create and remove unique schemas on the pinned local taskflow database.
const integration = process.argv.includes("--integration");
const unitOnly = process.argv.includes("--unit");
const checkIntegrationDatabaseUrl = process.argv.includes("--check-integration-database-url");
const listOnly = process.argv.includes("--list");
const phase8 = !process.argv.includes("--without-phase8");
if (integration && unitOnly) {
  console.error("Choose either --unit or --integration, not both.");
  process.exit(1);
}
if (integration) {
  let url;
  try { url = new URL(process.env.COSTFLOW_TEST_DATABASE_URL || ""); } catch { url = null; }
  if (!url || url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55439" || url.username !== "postgres" || url.password !== "" || url.pathname !== "/costflow_test" || url.search !== "" || url.hash !== "") {
    console.error("Set COSTFLOW_TEST_DATABASE_URL to the isolated local costflow_test database.");
    process.exit(1);
  }
  if (checkIntegrationDatabaseUrl) process.exit(0);
}

const phase10GapSuites = [
  "tests/costflow-settlement-schema.test.mjs",
  "tests/costflow-export-sealing.integration.test.mjs",
  "tests/costflow-phase10-runtime.integration.test.mjs",
  "tests/costflow-phase10-http.integration.test.mjs",
];
const phase12DatabaseUrl = "postgresql://postgres@127.0.0.1:55439/costflow_test";
const phase12Suites = [
  "tests/costflow-phase12-fixture.integration.test.mjs",
  "tests/costflow-phase12-pilot.integration.test.mjs",
  "tests/costflow-phase12-negative.integration.test.mjs",
  "tests/costflow-phase12-exports.integration.test.mjs",
  "tests/costflow-phase12-performance.test.mjs",
  "tests/costflow-phase12-ui-contract.test.mjs",
  "tests/costflow-phase12-regression.test.mjs",
  "tests/costflow-phase12-docs.test.mjs",
  "tests/costflow-phase12-release-gate.test.mjs",
];
const unitSuites = [
  "tests/ai-contracts.test.ts", "tests/ai-security.test.ts", "tests/ai-authority-boundary.test.ts", "tests/ai-observability.test.ts",
  "tests/costflow.test.ts", "tests/budget.test.ts", "tests/ic-effectiveness.test.ts", "tests/payment-policy.test.ts",
  "tests/payment-diff.test.ts", "tests/payment-read-model.test.ts", "tests/payment-security.test.ts", "tests/payment-ui-contract.test.ts", "tests/ic-approval-review.test.ts",
  "tests/vendor-payment-flow.test.ts", "tests/vendor-payment-ui-contract.test.ts",
  "tests/paired.test.ts", "tests/paired-ui-contract.test.ts", "tests/paired-performance.test.ts", "tests/excel-intake-contract.test.ts", "tests/excel-intake-template.test.ts",
  "tests/excel-intake-parser.test.ts", "tests/excel-intake-ui-contract.test.ts", "tests/excel-round-trip.test.ts",
  "tests/excel-round-trip-ui-contract.test.ts", "tests/quotation-parameters.test.ts", "tests/quotation-totals.test.ts",
  "tests/quotation-template-seed.test.ts", "tests/workspace-flow.test.ts", "tests/workflow-documents.test.ts",
  "tests/workflow-approval.test.ts", "tests/workflow-routes.test.ts",
  "tests/workflow-print-layout.test.ts",
  "tests/session-secret-build.test.ts",
  "tests/costflow-navigation-ui-contract.test.ts",
  "tests/costflow-release-acceptance-ledger.test.mjs",
  "tests/cloudflare-free-evidence-router.test.ts", "tests/cloudflare-paired-save.test.ts",
  ...(phase8 ? ["tests/actual-cost.test.ts", "tests/actual-cost-control-center.test.ts", "tests/actual-cost-security.test.ts", "tests/actual-cost-ui-contract.test.ts", "tests/customer-liquidation.test.ts", "tests/customer-acceptance-export.test.ts"] : []),
];
const integrationSuites = integration ? [
  "tests/costflow.integration.test.ts", "tests/quotation.integration.test.ts", "tests/quotation-reuse.integration.test.ts",
  "tests/quotation-parameters.integration.test.ts", "tests/workflow.integration.test.ts", "tests/budget.integration.test.ts",
  "tests/paired.integration.test.ts", "tests/payment.integration.test.ts", "tests/workflow-documents.integration.test.ts",
  "tests/workflow-approval.integration.test.ts", "tests/excel-intake.integration.test.ts",
  "tests/excel-intake-authority-schema.integration.test.ts", "tests/excel-intake-authority.integration.test.ts",
  "tests/excel-round-trip.integration.test.ts",
  // The sheet integration runs above through the Phase 12 disposable-schema negative matrix.
  ...(phase8 ? ["tests/actual-cost-control-center.integration.test.ts", "tests/customer-liquidation.integration.test.ts"] : []),
] : [];
const files = unitOnly
  ? unitSuites
  : [...phase10GapSuites, ...unitSuites, ...integrationSuites];
for (const suite of unitSuites) console.log(`UNIT ${suite}`);
for (const suite of integrationSuites) console.log(`INTEGRATION ${suite}`);
if (listOnly) process.exit(0);
const env = { ...process.env };
if (integration) env.DATABASE_URL = env.COSTFLOW_TEST_DATABASE_URL;
else delete env.COSTFLOW_TEST_DATABASE_URL;
if (!unitOnly) {
  const phase12Result = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import=tsx", "--test", "--test-concurrency=1", ...phase12Suites],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: phase12DatabaseUrl },
    },
  );
  if ((phase12Result.status ?? 1) !== 0) process.exit(phase12Result.status ?? 1);
}
const result = spawnSync(process.execPath, ["--conditions=react-server", "--import=tsx", "--test", "--test-concurrency=1", ...files], { stdio: "inherit", env });
process.exit(result.status ?? 1);
