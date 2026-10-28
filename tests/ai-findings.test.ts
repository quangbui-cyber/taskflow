import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDeterministicFindings, AI_FINANCE_RULE_VERSION } from "../lib/ai/risk/rules";
import { canResolveRoute, routeForFinding } from "../lib/ai/risk/findingService";

test("deterministic invoice, money, lineage and evidence findings survive contradictory model flags", () => {
  const findings = evaluateDeterministicFindings({ runId: "run-1", candidates: [
    { id: "tax", rowKey: "document", fieldKey: "sellerTaxCode", aiValue: "0123", provenance: "PARSER", confidence: "1", sourceSpanId: "span-tax" },
    { id: "symbol", rowKey: "document", fieldKey: "symbol", aiValue: "AA", provenance: "PARSER", confidence: "1", sourceSpanId: null },
    { id: "number", rowKey: "document", fieldKey: "invoiceNumber", aiValue: "0001", provenance: "PARSER", confidence: "1", sourceSpanId: "span-number" },
    { id: "date", rowKey: "document", fieldKey: "issuedAt", aiValue: "2026-10-28", provenance: "PARSER", confidence: "1", sourceSpanId: null },
    { id: "missing", rowKey: "document", fieldKey: "grossAmount", aiValue: null, provenance: "MODEL", confidence: "0.2", sourceSpanId: null },
  ], invoices: [{ id: "invoice-1", sellerTaxCode: "0123", symbol: "AA", invoiceNumber: "0001", issuedAt: "2026-10-28" }],
  cash: [{ lineId: "line-1", approvedAmount: "100", paidAmount: "101", requestState: "APPROVED" }],
  lineage: [{ id: "link-1", lineId: "ac-line", versionId: "v1", currentVersionId: "v2", approvalVersionId: "v1", approvalAction: "APPROVED" }],
  evidence: [{ versionId: "v2", evidenceCount: 0, approved: true }],
  modelFlags: [{ candidateId: "missing", code: "MODEL_REASSURES" }] });
  const codes = new Set(findings.map((item) => item.ruleCode));
  for (const code of ["DUPLICATE_INVOICE", "PAID_VS_APPROVED", "AC_LINEAGE", "MISSING_EVIDENCE", "UNREADABLE_FIELD", "MODEL_REASSURES"]) assert.ok(codes.has(code));
  assert.equal(findings.find((item) => item.ruleCode === "DUPLICATE_INVOICE")?.kind, "RULE_ERROR");
  assert.equal(findings.find((item) => item.ruleCode === "MODEL_REASSURES")?.kind, "AI_SUSPICION");
  assert.equal(findings.find((item) => item.ruleCode === "MISSING_EVIDENCE")?.kind, "MISSING_DATA");
  assert.ok(findings.every((item) => item.ruleVersion === AI_FINANCE_RULE_VERSION));
  assert.equal(findings.find((item) => item.ruleCode === "DUPLICATE_INVOICE")?.sourceSpanId, "span-number");
});

test("routing labels remain distinct from user permissions", () => {
  assert.equal(routeForFinding("VENDOR_INVOICE_FILE", "DUPLICATE_INVOICE"), "ACCOUNTANT");
  assert.equal(routeForFinding("COSTFLOW_IC", "AC_LINEAGE"), "ACCOUNT_OWNER");
  assert.equal(routeForFinding("PROJECT_FILE", "PROMPT_INJECTION"), "ADMIN");
  assert.equal(canResolveRoute({ id: "uploader", role: "ACCOUNT" }, "owner",
    { route: "ACCOUNTANT", ownerId: "uploader" }), false);
  assert.equal(canResolveRoute({ id: "accountant", role: "ACCOUNTANT" }, "owner",
    { route: "ACCOUNTANT", ownerId: "uploader" }), true);
  assert.equal(canResolveRoute({ id: "uploader", role: "ACCOUNT" }, "owner",
    { route: "ADMIN", ownerId: "uploader" }), false);
});

test("paid versus approved compares exact decimal amounts", () => {
  const base = { runId: "run", candidates: [], invoices: [], lineage: [], evidence: [] };
  const excess = evaluateDeterministicFindings({ ...base,
    cash: [{ lineId: "line", approvedAmount: "100.25", paidAmount: "100.26", requestState: "APPROVED" }] });
  assert.equal(excess[0]?.ruleCode, "PAID_VS_APPROVED");
  const equal = evaluateDeterministicFindings({ ...base,
    cash: [{ lineId: "line", approvedAmount: "100.25", paidAmount: "401/4", requestState: "APPROVED" }] });
  assert.equal(equal.length, 0);
});
