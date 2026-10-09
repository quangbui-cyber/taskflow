import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerAcceptanceProjection,
  customerAcceptanceProjectionHash,
  type CustomerAcceptanceAdditionSource,
} from "../lib/costflow/customerAcceptanceProjection";
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
