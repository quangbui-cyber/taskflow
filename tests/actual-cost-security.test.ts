import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("actual cost evidence routes recheck Project, AC linkage and return non-disclosing 404", () => {
  const download = source("app/api/projects/[id]/costflow/evidence/[evidenceId]/route.ts");
  const preview = source("app/api/projects/[id]/costflow/evidence/[evidenceId]/preview/route.ts");
  const upload = source("app/api/projects/[id]/costflow/evidence/upload/route.ts");
  for (const route of [download, preview]) {
    assert.match(route, /findActualCostEvidenceForActor/);
    assert.match(route, /status: 404/);
    assert.doesNotMatch(route, /loadFinance/);
  }
  assert.match(upload, /readProjectUpload/);
  assert.match(upload, /attachActualCostEvidence/);
  assert.match(upload, /same-origin|origin/i);
  assert.doesNotMatch(`${download}\n${preview}`, /console\.(log|error).*evidence/i);
});

test("actual cost read DTO never returns file bytes", () => {
  const readModel = source("lib/costflow/actualCostReadModel.ts");
  const dto = readModel.slice(readModel.indexOf("export type ActualCostReadLine"), readModel.indexOf("export type ActualCostComparison"));
  assert.doesNotMatch(dto, /\bdata\s*:/);
  assert.doesNotMatch(readModel, /data:\s*link\.evidence\.data/);
});

test("customer acceptance exports authorize the Project and accept snapshot identifiers only", () => {
  const projection = source("lib/costflow/customerAcceptanceProjection.ts");
  const pdf = source("app/api/projects/[id]/costflow/customer-acceptance/pdf/route.ts");
  const xlsx = source("app/api/projects/[id]/costflow/customer-acceptance/xlsx/route.ts");
  for (const route of [pdf, xlsx]) {
    assert.match(route, /getCurrentUser/);
    assert.match(route, /snapshotId/);
    assert.match(route, /getCustomerAcceptanceExport/);
    assert.match(route, /status: 404/);
    assert.match(route, /private, no-store/);
    assert.doesNotMatch(route, /actualRows|selectedActualCostVersionIds|unitPrice/);
  }
  assert.match(projection, /project\.members\.some/);
  assert.match(projection, /line\.currentVersion !== version\.version/);
  assert.match(projection, /state !== "APPROVED"/);
  assert.match(projection, /sourceKind !== "UNBUDGETED"/);
  assert.match(projection, /!addition\.billable/);
});
