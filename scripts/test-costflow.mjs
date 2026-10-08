import { spawnSync } from "node:child_process";

// An explicit dedicated URL is required for DB tests; DATABASE_URL from a real deployment is never reused.
const integration = process.argv.includes("--integration");
if (integration) {
  const url = new URL(process.env.COSTFLOW_TEST_DATABASE_URL || "http://invalid/");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/costflow_test") {
    console.error("Set COSTFLOW_TEST_DATABASE_URL to the isolated local costflow_test database.");
    process.exit(1);
  }
}
const files = ["tests/costflow.test.ts", "tests/budget.test.ts", "tests/ic-effectiveness.test.ts", "tests/payment-policy.test.ts", "tests/payment-diff.test.ts", "tests/payment-read-model.test.ts", "tests/paired.test.ts", "tests/quotation-parameters.test.ts", "tests/quotation-totals.test.ts", "tests/quotation-template-seed.test.ts", "tests/workspace-flow.test.ts", "tests/workflow-documents.test.ts", "tests/workflow-approval.test.ts", ...(integration ? ["tests/costflow.integration.test.ts", "tests/quotation.integration.test.ts", "tests/quotation-reuse.integration.test.ts", "tests/quotation-parameters.integration.test.ts", "tests/workflow.integration.test.ts", "tests/budget.integration.test.ts", "tests/paired.integration.test.ts", "tests/payment.integration.test.ts", "tests/workflow-documents.integration.test.ts", "tests/workflow-approval.integration.test.ts"] : [])];
const env = { ...process.env };
if (integration) env.DATABASE_URL = env.COSTFLOW_TEST_DATABASE_URL;
else delete env.COSTFLOW_TEST_DATABASE_URL;
const result = spawnSync(process.execPath, ["--conditions=react-server", "--import=tsx", "--test", "--test-concurrency=1", ...files], { stdio: "inherit", env });
process.exit(result.status ?? 1);
