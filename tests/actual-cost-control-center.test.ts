import assert from "node:assert/strict";
import test from "node:test";
import { buildActualCostControlCenter, operationAssignmentIds, resolveActualCostCapabilities } from "../lib/costflow/actualCostControlCenter";
import type { CalculatedCost } from "../lib/costflow/money";

const cost = (gross: string): CalculatedCost => ({ rawNet: `${gross}/1`, rawVat: "0/1", rawGross: `${gross}/1`, net: gross, vat: "0", gross });
const occurrence = (id: string, recipientKey: string, fundingSource: string, gross: string, sourceKind: "IC_LINKED" | "UNBUDGETED" = "IC_LINKED") => ({
  id, stableLineId: id, sourceKind, description: id, recipientKey, fundingSource, quantity: "1", days: "1", unitPrice: gross, unit: "gói", cost: cost(gross), reviewState: "approved", missingEvidenceWarnings: [], evidenceKinds: ["VAT_INVOICE"], lockedByApplications: true, applicationRequestIds: [`request-${id}`],
});

test("capabilities keep Project Operations separate from DD and accounting authority", () => {
  const operation = resolveActualCostCapabilities({ actorId: "ops", actorRole: "USER", isProjectMember: true, isDd: false, accountantId: "accountant", operationUserIds: ["ops"] });
  assert.deepEqual(operation.lenses, ["SELF", "VENDORS"]);
  assert.equal(operation.vendorOperations, true);
  assert.equal(operation.audit, false);
  assert.equal(operation.canDecide, false);
  assert.equal(operation.canConfigureOperations, false);
  const foreign = resolveActualCostCapabilities({ actorId: "ops", actorRole: "USER", isProjectMember: false, isDd: false, accountantId: "accountant", operationUserIds: ["ops"] });
  assert.deepEqual(foreign.lenses, []);
});

test("ordinary employee projection is self-scoped and does not accept another employee filter", () => {
  const capabilities = resolveActualCostCapabilities({ actorId: "self", actorRole: "USER", isProjectMember: true, isDd: false, accountantId: "accountant", operationUserIds: [] });
  const center = buildActualCostControlCenter({
    actorId: "self", capabilities,
    occurrences: [occurrence("self-ac", "USER:self", "EMPLOYEE_OUT_OF_POCKET", "800"), occurrence("private-ac", "USER:other", "EMPLOYEE_OUT_OF_POCKET", "900")],
    comparisons: [{ key: "shared-ic", sourceKind: "IC_LINKED", description: "Shared IC", unit: "gói", ic: { quantity: "1", days: "1", unitPrice: "2000", cost: cost("2000") }, actualLineIds: ["self-ac", "private-ac"], actual: cost("1700"), variance: cost("-300"), status: "SAVING" }], payments: [], milestones: [], recipientNames: { "USER:self": "Self", "USER:other": "PRIVATE_SENTINEL" },
  });
  assert.deepEqual(center.staff.map(item => item.recipientLabel), ["Self"]);
  assert.equal(JSON.stringify(center).includes("PRIVATE_SENTINEL"), false);
  assert.equal(JSON.stringify(center).includes("private-ac"), false);
  assert.equal(center.worksheet.groups[0].actual.gross, "800");
});

test("canonical occurrence contributes once while staff and vendor totals use the same identities", () => {
  const capabilities = resolveActualCostCapabilities({ actorId: "admin", actorRole: "ADMIN", isProjectMember: false, isDd: false, accountantId: "accountant", operationUserIds: [] });
  const occurrences = [occurrence("staff-ac", "USER:staff", "EMPLOYEE_OUT_OF_POCKET", "800"), occurrence("vendor-ac", "VENDOR:one", "VENDOR_PAYMENT", "1200")];
  const center = buildActualCostControlCenter({
    actorId: "admin", capabilities, occurrences,
    comparisons: [{ key: "ic", sourceKind: "IC_LINKED", description: "IC", unit: "gói", ic: { quantity: "1", days: "1", unitPrice: "2000", cost: cost("2000") }, actualLineIds: ["staff-ac", "vendor-ac"], actual: cost("2000"), variance: cost("0"), status: "ON_BUDGET" }],
    payments: [{ requestId: "vendor-request", kind: "VENDOR_PAYMENT", title: "Thanh toán NCC", recipientKey: "VENDOR:one", recipientLabel: "NCC One", approvalState: "APPROVED", approvedAmount: "1200", grossStandardOut: "0", grossAdditionalOut: "700", grossRefundedIn: "0", netCash: "700", remainingStandardOut: "500", cashProgress: "PARTIAL" }],
    milestones: [], recipientNames: { "USER:staff": "Staff", "VENDOR:one": "NCC One" },
  });
  assert.equal(center.worksheet.totals.actual.gross, "2000");
  assert.deepEqual(center.staff[0].occurrenceIds, ["staff-ac"]);
  assert.deepEqual(center.vendors[0].occurrenceIds, ["vendor-ac"]);
  assert.equal(center.vendors[0].outstanding, "500");
});

test("Operation assignment normalizes duplicates and rejects inactive or foreign members", () => {
  assert.deepEqual(operationAssignmentIds(["b", "a", "b", "foreign", "inactive"], ["a", "b"]), ["a", "b"]);
});
