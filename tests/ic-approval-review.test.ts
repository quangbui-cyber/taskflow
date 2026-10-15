import test from "node:test";
import assert from "node:assert/strict";

import { buildIcApprovalReview } from "../lib/costflow/icApprovalReview";
import { calculateLineCost } from "../lib/costflow/money";
import type { IcLine, Quotation } from "../lib/costflow/types";

function line(id: string, grossBase: string, extra: Partial<IcLine> = {}): IcLine {
  const input = { quantity: "1", days: "1", unitPrice: grossBase, basis: "NET" as const, vatPercent: "0" };
  return { id, description: `Dòng ${id}`, unit: "gói", ...input, cost: calculateLineCost(input), ...extra };
}

const quotation: Quotation = {
  id: "quotation-1",
  number: 3,
  parentId: null,
  title: "Báo giá chương trình",
  customer: "Khách hàng",
  notes: "",
  lines: [],
  poIds: [],
  evidenceIds: [],
  createdBy: "account",
  createdAt: "2026-10-15T00:00:00.000Z",
};
quotation.lines = [
  { id: "quote-a", description: "Bán A", unit: "gói", quantity: "1", days: "1", unitPrice: "150", basis: "NET", vatPercent: "0", cost: calculateLineCost({ quantity: "1", days: "1", unitPrice: "150", basis: "NET", vatPercent: "0" }) },
  { id: "quote-b", description: "Bán B", unit: "gói", quantity: "1", days: "1", unitPrice: "250", basis: "NET", vatPercent: "0", cost: calculateLineCost({ quantity: "1", days: "1", unitPrice: "250", basis: "NET", vatPercent: "0" }) },
];

test("IC approval review derives exact totals, planned margin and value-weighted coverage", () => {
  const review = buildIcApprovalReview({
    lines: [
      line("a", "100", { quotationId: quotation.id, quotationLineId: "quote-a", vendorId: "vendor-1", evidenceIds: ["evidence-1"] }),
      line("b", "200", { quotationId: quotation.id, quotationLineId: "quote-b", evidenceReason: "Chưa nhận báo giá NCC" }),
    ],
    quotation,
    beneficiaries: [{ id: "vendor-1", name: "NCC Một", bank: "", account: "", version: 1, verifiedVersion: 1, proofId: "proof" }],
    evidence: [{ id: "evidence-1", name: "bao-gia-ncc.pdf" }],
  });

  assert.equal(review.totals.quotation?.net, "400");
  assert.equal(review.totals.ic.net, "300");
  assert.equal(review.totals.margin?.marginNet, "100");
  assert.equal(review.totals.margin?.percentDisplay, "+25%");
  assert.deepEqual(review.coverage, {
    totalLines: 2,
    evidenceFileLines: 1,
    evidenceReasonLines: 1,
    missingEvidenceLines: 0,
    evidenceGross: "100",
    evidencePercent: "33,3%",
    vendorLines: 1,
    missingVendorLines: 1,
    vendorGross: "100",
    vendorPercent: "33,3%",
  });
});

test("IC approval review counts supplemental files and surfaces missing data without inventing approval blockers", () => {
  const review = buildIcApprovalReview({
    lines: [
      line("a", "100", { evidenceIds: ["shared"] }),
      line("b", "200", { vendorId: "removed-vendor", evidenceIds: ["shared"] }),
      line("c", "300"),
    ],
    beneficiaries: [],
    evidence: [{ id: "shared", name: "ho-so-chung.pdf" }, { id: "added", name: "bo-sung.pdf" }],
    supplements: [{ operationId: "op", requestId: "request", requestVersion: 2, lineId: "c", evidenceIds: ["added"], reason: "Bổ sung sau khi nộp", actorId: "account", createdAt: "2026-10-15T00:00:00.000Z" }],
  });

  assert.equal(review.coverage.evidenceFileLines, 3);
  assert.equal(review.coverage.missingEvidenceLines, 0);
  assert.equal(review.coverage.missingVendorLines, 3);
  assert.equal(review.rows[2].hasSupplement, true);
  assert.equal(review.sharedEvidence[0].lineCount, 2);
  assert.ok(review.warnings.some(warning => warning.code === "SHARED_EVIDENCE"));
  assert.ok(review.warnings.some(warning => warning.code === "MISSING_VENDOR"));
  assert.ok(!review.warnings.some(warning => warning.title.toLowerCase().includes("chặn duyệt")));
});

test("IC approval review distinguishes missing evidence from an explicit reason and flags line variance", () => {
  const review = buildIcApprovalReview({
    lines: [line("a", "200", { quotationId: quotation.id, quotationLineId: "quote-a", vendorId: "vendor-1" })],
    quotation,
    beneficiaries: [{ id: "vendor-1", name: "NCC Một", bank: "", account: "", version: 1, verifiedVersion: null, proofId: "" }],
    evidence: [],
  });

  assert.deepEqual(review.rows[0].issues, ["MISSING_EVIDENCE", "IC_ABOVE_QUOTATION"]);
  assert.equal(review.coverage.missingEvidenceLines, 1);
  assert.ok(review.warnings.some(warning => warning.code === "MISSING_EVIDENCE"));
});
