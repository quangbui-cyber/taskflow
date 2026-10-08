import test from "node:test";
import assert from "node:assert/strict";
import { normalizePaymentDraft } from "../lib/costflow/paymentPolicy";
import { projectPaymentDossiers } from "../lib/costflow/paymentCompatibility";
import type { PaymentDraftInput } from "../lib/costflow/paymentTypes";
import { derivePaymentProgress } from "../lib/costflow/paymentCash";

const projectId = "project-phase-7";
const revisionId = "ic-effective";

function canonicalDraft(overrides: Partial<PaymentDraftInput> = {}): PaymentDraftInput {
  return {
    projectId,
    kind: "ADVANCE",
    budgetEffectStatus: "EFFECTIVE",
    legacyEffective: false,
    milestone: "Đợt chuẩn bị và đặt cọc trước sự kiện",
    explanation: "Ba khoản tạm ứng theo IC hiệu lực.",
    clientTotal: "999999999",
    lines: [
      {
        stableKey: "vendor-a",
        description: "Đặt cọc Vendor A",
        amount: "25000000",
        source: { projectId, revisionId, lineId: "ic-line-a", budgetGross: "25000000" },
        recipient: { projectId, key: "VENDOR:vendor-a", type: "VENDOR", name: "Vendor A" },
      },
      {
        stableKey: "resort-b",
        description: "Đặt cọc Resort B",
        amount: "40000000",
        source: { projectId, revisionId, lineId: "ic-line-b", budgetGross: "40000000" },
        recipient: { projectId, key: "VENDOR:resort-b", type: "VENDOR", name: "Resort B" },
      },
      {
        stableKey: "employee-c",
        description: "Tạm ứng chi phí vận hành",
        amount: "10000000",
        source: { projectId, revisionId, lineId: "ic-line-c", budgetGross: "10000000" },
        recipient: { projectId, key: "USER:employee-c", type: "EMPLOYEE", name: "Nhân viên C" },
      },
    ],
    ...overrides,
  };
}

test("payment-policy: one 75m multi-recipient ADVANCE derives exact server totals", () => {
  const normalized = normalizePaymentDraft(canonicalDraft());

  assert.equal(normalized.kind, "ADVANCE");
  assert.equal(normalized.milestone, "Đợt chuẩn bị và đặt cọc trước sự kiện");
  assert.equal(normalized.totalAmount, "75000000");
  assert.deepEqual(normalized.recipientTotals, {
    "VENDOR:vendor-a": "25000000",
    "VENDOR:resort-b": "40000000",
    "USER:employee-c": "10000000",
  });
  assert.equal(normalized.lines.length, 3);
  assert.ok(normalized.lines.every(line => line.amount !== "0" && line.source.lineId && line.recipient.key));
  assert.ok(normalized.lines.every(line => !("milestone" in line)));
});

test("payment-policy: direct vendor deposit remains ADVANCE without fixed percentage calculation", () => {
  const draft = canonicalDraft({
    lines: [canonicalDraft().lines[0]],
    clientTotal: "7500000",
  });
  const normalized = normalizePaymentDraft(draft);

  assert.equal(normalized.kind, "ADVANCE");
  assert.equal(normalized.totalAmount, "25000000");
  assert.equal(normalized.lines[0].amount, "25000000");
});

test("payment-policy: server totals ignore forged browser totals and require exact positive VND", () => {
  assert.equal(normalizePaymentDraft(canonicalDraft({ clientTotal: "1" })).totalAmount, "75000000");
  assert.throws(
    () => normalizePaymentDraft(canonicalDraft({ lines: [{ ...canonicalDraft().lines[0], amount: "0" }] })),
    /lớn hơn 0|dương/i,
  );
  assert.throws(
    () => normalizePaymentDraft(canonicalDraft({ lines: [{ ...canonicalDraft().lines[0], amount: "1.5" }] })),
    /VND|nguyên/i,
  );
});

test("payment-policy: over-reference warning requires explanation but remains submittable", () => {
  const overReference = [{ ...canonicalDraft().lines[0], amount: "30000000" }];
  assert.throws(
    () => normalizePaymentDraft(canonicalDraft({ lines: overReference, explanation: "" })),
    /giải trình/i,
  );

  const normalized = normalizePaymentDraft(canonicalDraft({
    lines: overReference,
    explanation: "Giá thực tế vượt tham chiếu IC nhưng vẫn là tạm ứng trước sự kiện.",
  }));
  assert.equal(normalized.canSubmit, true);
  assert.deepEqual(normalized.warnings.map(warning => warning.code), ["OVER_REFERENCE"]);
  assert.equal(normalized.kind, "ADVANCE");
});

test("payment-policy: effective IC is required with deliberate legacy boolean fallback", () => {
  assert.throws(
    () => normalizePaymentDraft(canonicalDraft({ budgetEffectStatus: "NOT_EFFECTIVE", legacyEffective: false })),
    /IC.*hiệu lực/i,
  );
  assert.equal(
    normalizePaymentDraft(canonicalDraft({ budgetEffectStatus: undefined, legacyEffective: true })).totalAmount,
    "75000000",
  );
});

test("payment-policy: cross-Project sources and recipients are rejected", () => {
  const [line] = canonicalDraft().lines;
  assert.throws(
    () => normalizePaymentDraft(canonicalDraft({ lines: [{ ...line, source: { ...line.source, projectId: "other-project" } }] })),
    /project/i,
  );
  assert.throws(
    () => normalizePaymentDraft(canonicalDraft({ lines: [{ ...line, recipient: { ...line.recipient, projectId: "other-project" } }] })),
    /project/i,
  );
});

test("payment-policy: duplicate stable line keys are rejected", () => {
  const [line] = canonicalDraft().lines;
  assert.throws(
    () => normalizePaymentDraft(canonicalDraft({ lines: [line, { ...line, amount: "1000000" }] })),
    /trùng|duplicate/i,
  );
});

test("payment-read-model: normalized rows win and legacy rows appear once with explicit provenance gap", () => {
  const normalized = [{
    requestId: "request-new",
    projectId,
    kind: "ADVANCE",
    milestone: "Mốc chuẩn hóa",
    totalAmount: "75000000",
    recipientTotals: { "VENDOR:vendor-a": "25000000" },
  }];
  const legacy = [
    { id: "request-new", projectId, kind: "ADVANCE", payload: { amount: "1", recipientKey: "USER:wrong" } },
    { id: "request-legacy", projectId, kind: "ADVANCE", payload: { amount: "1000000", recipientKey: "USER:legacy" } },
  ];
  const projected = projectPaymentDossiers(normalized, legacy);

  assert.equal(projected.length, 2);
  assert.equal(projected.filter(item => item.requestId === "request-new").length, 1);
  assert.deepEqual(projected.find(item => item.requestId === "request-new"), {
    ...normalized[0], provenance: "normalized", needsReview: false,
  });
  assert.deepEqual(projected.find(item => item.requestId === "request-legacy"), {
    requestId: "request-legacy",
    projectId,
    kind: "ADVANCE",
    milestone: null,
    totalAmount: "1000000",
    recipientTotals: { "USER:legacy": "1000000" },
    provenance: "legacy",
    needsReview: true,
  });
});

test("payment-cash: canonical 75m sequence derives cash progress independently", () => {
  assert.deepEqual(derivePaymentProgress("75000000", "0"), {
    progress: "CHUA_CHI", approvedAmount: "75000000", paidOutAmount: "0", remainingAmount: "75000000",
  });
  assert.deepEqual(derivePaymentProgress("75000000", "45000000"), {
    progress: "DANG_CHI_MOT_PHAN", approvedAmount: "75000000", paidOutAmount: "45000000", remainingAmount: "30000000",
  });
  assert.deepEqual(derivePaymentProgress("75000000", "75000000"), {
    progress: "DA_CHI_DU", approvedAmount: "75000000", paidOutAmount: "75000000", remainingAmount: "0",
  });
  assert.throws(() => derivePaymentProgress("75000000", "75000001"), /vượt/i);
});
