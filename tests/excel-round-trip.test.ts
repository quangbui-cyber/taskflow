import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { createRoundTripProjection } from "../lib/costflow/excelRoundTrip";
import { createExcelRoundTripWorkbook } from "../lib/costflow/quotationExcel";
import type { PairedDraft } from "../lib/costflow/types";

const draft: PairedDraft = {
  linePricingSchemaVersion: 2,
  id: "draft-round-trip-1",
  version: 7,
  createdBy: "account-1",
  workspaceMode: "paired",
  title: "Activation tháng 10",
  clientId: "client-1",
  customer: "Khách hàng A",
  notes: "Ghi chú chung",
  globalEvidenceIds: ["evidence-private"],
  rows: [
    {
      itemId: "group-1", parentItemId: null, rowType: "GROUP", name: "A. Chương trình", description: "", pricingMode: "DETAIL", showChildren: true, showGroupSubtotal: true, packageChildDisplay: "CONTENT",
      sell: { unit: "", quantity: "", days: "", unitPrice: "", basis: "NET", vatPercent: "", notes: "" },
      buy: { unit: "", quantity: "", days: "", unitPrice: "", basis: "NET", vatPercent: "", notes: "", vendorId: "", evidenceIds: [], evidenceReason: "" },
    },
    {
      itemId: "item-1", parentItemId: "group-1", rowType: "ITEM", name: "Điều phối", description: "Ca chiều", pricingMode: "DETAIL", showChildren: true, showGroupSubtotal: true, packageChildDisplay: "CONTENT",
      sell: { unit: "người", quantity: "2", days: "1.5", unitPrice: "1500000", basis: "NET", vatPercent: "8", notes: "Khách thấy" },
      buy: { unit: "người", quantity: "2", days: "1", unitPrice: "900000", basis: "NET", vatPercent: "8", notes: "Nội bộ", vendorId: "vendor-1", evidenceIds: ["evidence-private"], evidenceReason: "" },
    },
  ],
};

test("round-trip projection fingerprints editable primitives and ignores formulas/evidence bytes", () => {
  const projection = createRoundTripProjection("project-1", draft);
  assert.equal(projection.projectId, "project-1");
  assert.equal(projection.draftId, draft.id);
  assert.equal(projection.draftVersion, 7);
  assert.equal(projection.rows[1].itemId, "item-1");
  assert.equal(projection.rows[1].parentItemId, "group-1");
  assert.equal(projection.rows[1].order, 1);
  assert.match(projection.fingerprint, /^[a-f0-9]{64}$/);
  const evidenceChanged = structuredClone(draft);
  evidenceChanged.rows[1].buy.evidenceIds = ["other-evidence"];
  assert.equal(createRoundTripProjection("project-1", evidenceChanged).fingerprint, projection.fingerprint);
});

test("round-trip workbook reopens with visible parity and veryHidden stable metadata", async () => {
  const projection = createRoundTripProjection("project-1", draft);
  const bytes = await createExcelRoundTripWorkbook(projection, { projectName: "Project A", generatedAt: "2026-10-10T00:00:00.000Z" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map(sheet => [sheet.name, sheet.state]), [
    ["BAO_GIA_IC", "visible"], ["_IMPORT", "veryHidden"], ["_META", "veryHidden"],
  ]);
  const visible = workbook.getWorksheet("BAO_GIA_IC")!;
  assert.equal(visible.getCell("C7").value, "A. Chương trình");
  assert.equal(visible.getCell("C8").value, "Điều phối");
  assert.equal(visible.getCell("F8").value, 2);
  assert.equal(visible.getCell("G8").value, 1.5);
  assert.equal(visible.getCell("R8").value, 900000);
  const metadata = workbook.getWorksheet("_META")!;
  assert.equal(metadata.getCell("B8").value, "project-1");
  assert.equal(metadata.getCell("B9").value, draft.id);
  assert.equal(metadata.getCell("B10").value, 7);
  assert.equal(metadata.getCell("B11").value, projection.fingerprint);
  const stable = workbook.getWorksheet("_IMPORT")!;
  assert.deepEqual(stable.getRow(3).values?.slice(1, 5), ["item-1", "group-1", 1, 2]);
  const packageText = Buffer.from(bytes).toString("utf8");
  assert.ok(!packageText.includes("evidence-private"));
});

test("round-trip route is exact-draft authorized and private while customer exports stay isolated", async () => {
  const route = await readFile(path.join(process.cwd(), "app/api/projects/[id]/costflow/excel-intake/drafts/[draftId]/route.ts"), "utf8");
  assert.match(route, /getCurrentUser/);
  assert.match(route, /createdBy\s*!==\s*actor\.id/);
  assert.match(route, /workspaceMode\s*!==\s*"paired"/);
  assert.match(route, /closed/);
  assert.match(route, /status:\s*404/);
  assert.match(route, /private, no-store/);
  assert.match(route, /nosniff/);
  assert.match(route, /createRoundTripProjection/);
  const customerExport = await readFile(path.join(process.cwd(), "lib/costflow/quotationExport.ts"), "utf8");
  assert.doesNotMatch(customerExport, /createExcelRoundTripWorkbook|draftVersion|parentItemId/);
});
