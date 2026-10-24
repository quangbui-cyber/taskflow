import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import {
  buildCustomerAcceptanceProjection,
  customerAcceptanceArtifactRows,
  customerAcceptanceProjectionHash,
  type CustomerAcceptanceAdditionSource,
} from "../lib/costflow/customerAcceptanceProjection";
import { customerAcceptancePdf, customerAcceptancePdfRows } from "../lib/costflow/customerAcceptancePdf";
import { customerAcceptanceXlsx, customerAcceptanceXlsxRows } from "../lib/costflow/customerAcceptanceXlsx";
import type { CustomerQuotation } from "../lib/costflow/quotationProjection";

const quotation: CustomerQuotation = {
  id: "quote-project-a-v3",
  number: 3,
  createdAt: "2026-10-09T01:00:00.000Z",
  title: "Customer launch",
  customer: "Jabil",
  notes: "Customer-visible note",
  rows: [
    {
      id: "sale-line-1",
      name: "Activation day",
      description: "Public scope",
      depth: 0,
      role: "ITEM",
      numberLabel: "1",
      childCount: 0,
      showSubtotal: true,
      unit: "day",
      quantity: "2",
      days: "3",
      unitPrice: "1000000",
      basis: "NET",
      vat: "10%",
      notes: "Public delivery note",
      amount: { rawNet: "6000000/1", rawVat: "600000/1", rawGross: "6600000/1", net: "6000000", vat: "600000", gross: "6600000" },
      summary: false,
    },
  ],
  amount: { rawNet: "6000000/1", rawVat: "600000/1", rawGross: "6600000/1", net: "6000000", vat: "600000", gross: "6600000" },
  amountIncomplete: false,
  incomplete: false,
  issues: [],
};

const additions: CustomerAcceptanceAdditionSource[] = [
  {
    projectId: "project-a",
    versionId: "ac-version-billable",
    stableLineId: "ac-extra-1",
    state: "APPROVED",
    sourceKind: "UNBUDGETED",
    billable: true,
    description: "Extra customer booth",
    unit: "booth",
    saleSnapshot: { quantity: "1", days: "2", unitPrice: "500000" },
    basis: "NET",
    vatPercent: "8",
    vendor: "VENDOR_PRIVATE",
    buyUnitPrice: "COST_PRIVATE",
    recipientKey: "RECIPIENT_PRIVATE",
    evidenceIds: ["EVIDENCE_PRIVATE"],
    internalNotes: "IC_INTERNAL_NOTE",
    ddEvent: "DD_EVENT_PRIVATE",
    margin: "MARGIN_PRIVATE",
  },
  {
    projectId: "project-a",
    versionId: "ac-version-unselected",
    stableLineId: "ac-extra-2",
    state: "APPROVED",
    sourceKind: "UNBUDGETED",
    billable: true,
    description: "Must stay out",
    unit: "item",
    saleSnapshot: { quantity: "1", days: "1", unitPrice: "900000" },
    basis: "NET",
    vatPercent: "10",
  },
];

function projection() {
  return buildCustomerAcceptanceProjection({
    project: { id: "project-a", name: "Jabil POSM" },
    quotation,
    snapshot: { version: 4, createdAt: "2026-10-09T02:00:00.000Z" },
    actualRows: [{ rowId: "sale-line-1", quantity: "3", days: "2" }],
    additions,
    selectedActualCostVersionIds: ["ac-version-billable"],
  });
}

test("customer acceptance uses customer sale quantities and explicit billable additions only", () => {
  const result = projection();
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.selectedActualCostVersionIds, ["ac-version-billable"]);
  assert.deepEqual(result.rows[0], {
    id: "sale-line-1",
    kind: "CONTRACT",
    numberLabel: "1",
    name: "Activation day",
    description: "Public scope",
    unit: "day",
    contractQuantity: "2",
    contractDays: "3",
    actualQuantity: "3",
    actualDays: "2",
    quantityDelta: "1",
    daysDelta: "-1",
    saleUnitPrice: "1000000",
    basis: "NET",
    vatPercent: "10",
    netAmount: "6000000",
    vatAmount: "600000",
    grossAmount: "6600000",
    notes: "Public delivery note",
  });
  assert.equal(result.rows[1].id, "ac-version-billable");
  assert.equal(result.rows[1].grossAmount, "1080000");
  assert.equal(result.totals.gross, "7680000");
  assert.deepEqual(result.signatures, ["Đại diện Khách hàng", "Đại diện Creative Station"]);
  assert.equal(customerAcceptanceProjectionHash(result).length, 64);
});

test("customer acceptance JSON is a strict allowlist with negative sentinel coverage", () => {
  const serialized = JSON.stringify(projection());
  for (const token of [
    "VENDOR_PRIVATE",
    "COST_PRIVATE",
    "RECIPIENT_PRIVATE",
    "EVIDENCE_PRIVATE",
    "IC_INTERNAL_NOTE",
    "DD_EVENT_PRIVATE",
    "MARGIN_PRIVATE",
    "Must stay out",
  ]) assert.ok(!serialized.includes(token), token);
  for (const key of ["vendor", "buyUnitPrice", "recipientKey", "evidenceIds", "internalNotes", "ddEvent", "margin"]) {
    assert.ok(!serialized.includes(`\"${key}\"`), key);
  }
});

test("customer acceptance rejects foreign, stale, unapproved and non-billable selections", () => {
  const build = (addition: CustomerAcceptanceAdditionSource) => () => buildCustomerAcceptanceProjection({
    project: { id: "project-a", name: "Jabil POSM" },
    quotation,
    snapshot: { version: 4, createdAt: "2026-10-09T02:00:00.000Z" },
    actualRows: [{ rowId: "sale-line-1", quantity: "3", days: "2" }],
    additions: [addition],
    selectedActualCostVersionIds: [addition.versionId],
  });
  assert.throws(build({ ...additions[0], projectId: "project-b" }), /Project/);
  assert.throws(build({ ...additions[0], state: "SUBMITTED" }), /duyệt/);
  assert.throws(build({ ...additions[0], billable: false }), /thu thêm/);
  assert.throws(build({ ...additions[0], sourceKind: "IC_LINKED" }), /ngoài IC/);
  assert.throws(() => buildCustomerAcceptanceProjection({
    project: { id: "project-a", name: "Jabil POSM" }, quotation,
    snapshot: { version: 4, createdAt: "2026-10-09T02:00:00.000Z" },
    actualRows: [{ rowId: "sale-line-stale", quantity: "3", days: "2" }],
    additions,
    selectedActualCostVersionIds: [],
  }), /không còn thuộc báo giá/);
});

test("PDF and XLSX render the exact same stored projection rows and remain sentinel-free", async () => {
  const result = projection();
  const canonical = customerAcceptanceArtifactRows(result);
  assert.deepEqual(customerAcceptancePdfRows(result), canonical);
  assert.deepEqual(customerAcceptanceXlsxRows(result), canonical);
  const pdf = customerAcceptancePdf(result);
  const xlsx = customerAcceptanceXlsx(result);
  if (process.env.CUSTOMER_ACCEPTANCE_INSPECT_ARTIFACTS === "1") {
    const inspectDir = join(process.cwd(), ".codex-tmp", "qa", "customer-acceptance-20261024");
    mkdirSync(inspectDir, { recursive: true });
    writeFileSync(join(inspectDir, "customer-acceptance.pdf"), pdf);
    writeFileSync(join(inspectDir, "customer-acceptance.xlsx"), xlsx);
  }
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(xlsx.readUInt32LE(0), 0x04034b50);
  const workbookXml = xlsx.toString("utf8");
  assert.match(workbookXml, /<sheet name="Nghiệm thu khách hàng"/);
  assert.match(workbookXml, /<autoFilter ref="A4:M6"/);
  assert.match(workbookXml, /<c r="M7" s="1"><v>7680000<\/v><\/c>/);
  assert.match(workbookXml, /Extra customer booth/);
  for (const token of ["VENDOR_PRIVATE", "COST_PRIVATE", "RECIPIENT_PRIVATE", "EVIDENCE_PRIVATE", "IC_INTERNAL_NOTE", "DD_EVENT_PRIVATE", "MARGIN_PRIVATE"]) {
    assert.ok(!pdf.includes(Buffer.from(token)), `PDF: ${token}`);
    assert.ok(!xlsx.includes(Buffer.from(token)), `XLSX: ${token}`);
  }
  assert.ok(canonical.flat().includes("Đại diện Khách hàng"));
  assert.ok(canonical.flat().includes("Đại diện Creative Station"));
  const document = await getDocumentProxy(new Uint8Array(pdf));
  try {
    assert.equal(document.numPages, 1);
    const extracted = await extractText(document, { mergePages: true });
    assert.match(extracted.text, /Đại diện Khách hàng/);
    assert.match(extracted.text, /Đại diện Creative Station/);
    assert.match(extracted.text, /Activation day/);
    assert.match(extracted.text, /Extra customer booth/);
    assert.match(extracted.text, /7[.]680[.]000|7680000/);
    for (const token of ["VENDOR_PRIVATE", "COST_PRIVATE", "RECIPIENT_PRIVATE", "EVIDENCE_PRIVATE", "IC_INTERNAL_NOTE", "DD_EVENT_PRIVATE", "MARGIN_PRIVATE"]) {
      assert.ok(!extracted.text.includes(token), `PDF text: ${token}`);
    }
  } finally {
    await document.cleanup();
  }
});
