import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { applyRoundTripDiff, createRoundTripProjection, diffRoundTripDraft, parseRoundTripWorkbook, type RoundTripImport } from "../lib/costflow/excelRoundTrip";
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
  assert.notEqual(createRoundTripProjection("project-1", evidenceChanged).fingerprint, projection.fingerprint);
});

test("allowlisted no-op preserves rich protected row state byte-for-byte", () => {
  const rich = structuredClone(draft);
  rich.rows[1].pricingMode = "PACKAGE";
  rich.rows[1].showChildren = false;
  rich.rows[1].showGroupSubtotal = false;
  rich.rows[1].packageChildDisplay = "QUANTITY";
  rich.rows[1].saleRemoved = true;
  rich.rows[1].quotationLineId = "quotation-line-private";
  rich.rows[1].icLineId = "ic-line-private";
  rich.rows[1].sell.parameterBinding = { mode: "FORMULA", quantityFormula: { op: "PARAM", key: "participants" }, lastCalculated: { quantity: "2" } };
  rich.rows[1].buy.parameterBinding = { mode: "FORMULA", unitPriceFormula: { op: "CONST", value: "900000" }, lastCalculated: { unitPrice: "900000" } };
  const diff = diffRoundTripDraft(rich, importFromDraftFor(rich), "project-1");
  assert.deepEqual(applyRoundTripDiff(rich, diff, []), rich.rows);
});

test("one formula primitive edit overrides only its side and parent-only deletion is rejected", () => {
  const bound = structuredClone(draft);
  bound.rows[1].sell.parameterBinding = { mode: "FORMULA", unitPriceFormula: { op: "CONST", value: "1500000" }, lastCalculated: { unitPrice: "1500000" } };
  bound.rows[1].buy.parameterBinding = { mode: "FORMULA", unitPriceFormula: { op: "CONST", value: "900000" }, lastCalculated: { unitPrice: "900000" } };
  const imported = importFromDraftFor(bound);
  imported.rows[1].row.sell.unitPrice = "1600000";
  const applied = applyRoundTripDiff(bound, diffRoundTripDraft(bound, imported, "project-1"), []);
  assert.equal(applied[1].sell.parameterBinding?.mode, "OVERRIDDEN");
  assert.deepEqual(applied[1].buy.parameterBinding, bound.rows[1].buy.parameterBinding);

  const tree = structuredClone(draft);
  const missingParent = importFromDraftFor(tree).rows.filter(row => row.itemId !== "group-1");
  missingParent[0].parentItemId = null;
  const deletionDiff = diffRoundTripDraft(tree, { ...importFromDraftFor(tree), rows: missingParent }, "project-1");
  assert.throws(() => applyRoundTripDiff(tree, deletionDiff, ["group-1"]), /dòng con|hậu duệ|cấu trúc/i);
});

test("tampered hidden canonical binding blocks the affected stable row", async () => {
  const projection = createRoundTripProjection("project-1", draft);
  const bytes = await createExcelRoundTripWorkbook(projection);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  workbook.getWorksheet("_IMPORT")!.getCell("I3").value = "999999";
  const imported = await parseRoundTripWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), { filename: "round-trip.xlsx", mimeType: "application/octet-stream" });
  assert.throws(() => diffRoundTripDraft(draft, imported, "project-1"), error => {
    assert.match((error as Error).message, /metadata|canonical|bảo vệ|đã bị sửa/i);
    assert.deepEqual((error as Error & { diagnostic?: unknown }).diagnostic, { itemId: "item-1", field: "sell.unitPrice", sourceCell: "C8" });
    return true;
  });
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
  assert.deepEqual((stable.getRow(3).values as ExcelJS.CellValue[]).slice(1, 5), ["item-1", "group-1", 1, 2]);
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

function importFromDraft(): RoundTripImport {
  const projection = createRoundTripProjection("project-1", draft);
  return {
    schemaVersion: projection.schemaVersion,
    projectId: projection.projectId,
    draftId: projection.draftId,
    draftVersion: projection.draftVersion,
    fingerprint: projection.fingerprint,
    rows: projection.rows.map(entry => ({ ...structuredClone(entry), source: { sheet: "BAO_GIA_IC", row: 7 + entry.order, cell: `C${7 + entry.order}` } })),
  };
}

function importFromDraftFor(value: PairedDraft): RoundTripImport {
  const projection = createRoundTripProjection("project-1", value);
  return {
    schemaVersion: projection.schemaVersion,
    projectId: projection.projectId,
    draftId: projection.draftId,
    draftVersion: projection.draftVersion,
    fingerprint: projection.fingerprint,
    rows: projection.rows.map(entry => ({ ...structuredClone(entry), source: { sheet: "BAO_GIA_IC", row: 7 + entry.order, cell: `C${7 + entry.order}` } })),
  };
}

test("deterministic diff separates add, field change, deletion candidate and move", () => {
  const noOp = diffRoundTripDraft(draft, importFromDraft(), "project-1");
  assert.deepEqual([noOp.adds, noOp.changes, noOp.deletionCandidates, noOp.moves].map(group => group.length), [0, 0, 0, 0]);

  const edited = importFromDraft();
  edited.rows[1].row.sell.quantity = "0";
  edited.rows[1].parentItemId = null;
  edited.rows[1].order = 0;
  edited.rows = edited.rows.filter(row => row.itemId !== "group-1");
  edited.rows.push({
    itemId: null, parentItemId: null, order: 2, level: 1,
    row: { ...structuredClone(draft.rows[1]), itemId: "temporary-client-value", parentItemId: null, name: "Dòng mới", sell: { ...draft.rows[1].sell, quantity: "1" } },
    source: { sheet: "BAO_GIA_IC", row: 9, cell: "C9" },
  });
  const diff = diffRoundTripDraft(draft, edited, "project-1");
  assert.equal(diff.adds.length, 1);
  assert.ok(diff.changes.some(change => change.itemId === "item-1" && change.field === "sell.quantity" && change.oldValue === "2" && change.newValue === "0"));
  assert.deepEqual(diff.deletionCandidates.map(row => row.itemId), ["group-1"]);
  assert.ok(diff.moves.some(move => move.itemId === "item-1" && move.oldParentItemId === "group-1" && move.newParentItemId === null));
  assert.equal(diff.adds[0].source.cell, "C9");
});

test("diff rejects stale, duplicate, unknown, cross-draft and invalid hierarchy metadata", () => {
  const stale = importFromDraft(); stale.draftVersion -= 1;
  assert.throws(() => diffRoundTripDraft(draft, stale, "project-1"), /phiên bản|thay đổi/i);
  const duplicate = importFromDraft(); duplicate.rows.push(structuredClone(duplicate.rows[1]));
  assert.throws(() => diffRoundTripDraft(draft, duplicate, "project-1"), /trùng/i);
  const unknown = importFromDraft(); unknown.rows[1].itemId = "foreign-stable-id";
  assert.throws(() => diffRoundTripDraft(draft, unknown, "project-1"), /không thuộc|không hợp lệ/i);
  const foreign = importFromDraft(); foreign.projectId = "project-2";
  assert.throws(() => diffRoundTripDraft(draft, foreign, "project-1"), /Project/i);
  const cycle = importFromDraft(); cycle.rows[0].parentItemId = "item-1";
  assert.throws(() => diffRoundTripDraft(draft, cycle, "project-1"), /vòng|cấu trúc|cấp gốc/i);
});

test("round-trip parser rejects formulas in primitive cells before diffing", async () => {
  const projection = createRoundTripProjection("project-1", draft);
  const bytes = await createExcelRoundTripWorkbook(projection);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  workbook.getWorksheet("BAO_GIA_IC")!.getCell("F8").value = { formula: "1+1", result: 2 };
  const forged = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(() => parseRoundTripWorkbook(forged, { filename: "round-trip.xlsx", mimeType: "application/octet-stream" }), /công thức/i);
});
