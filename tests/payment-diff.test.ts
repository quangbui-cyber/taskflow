import test from "node:test";
import assert from "node:assert/strict";
import { diffPaymentDossiers, type PaymentDossierSnapshot } from "../lib/costflow/paymentDiff";

function original(): PaymentDossierSnapshot {
  return {
    title: "ĐNTU sự kiện",
    milestone: "Đợt chuẩn bị",
    explanation: "Bản đầu",
    lines: [
      { stableKey: "vendor-a", position: 0, description: "Đặt cọc A", amount: "25000000", icRevisionId: "ic-r1", icLineId: "ic-a", recipientKey: "VENDOR:a", documents: [{ id: "doc-a", name: "bao-gia-a.pdf", sha256: "hash-a" }] },
      { stableKey: "employee-c", position: 1, description: "Vận hành", amount: "10000000", icRevisionId: "ic-r1", icLineId: "ic-c", recipientKey: "USER:c", documents: [] },
      { stableKey: "removed", position: 2, description: "Bỏ", amount: "5000000", icRevisionId: "ic-r1", icLineId: "ic-x", recipientKey: "VENDOR:x", documents: [] },
    ],
  };
}

test("payment-diff: stable logical keys expose header, line, order, source, recipient, amount and document changes", () => {
  const before = original();
  const after: PaymentDossierSnapshot = {
    title: "ĐNTU sự kiện bản sửa",
    milestone: "Đợt đặt cọc",
    explanation: "Đã sửa theo yêu cầu",
    lines: [
      { stableKey: "employee-c", position: 0, description: "Vận hành hiện trường", amount: "12000000", icRevisionId: "ic-r2", icLineId: "ic-c2", recipientKey: "USER:d", documents: [{ id: "doc-c", name: "ke-hoach.pdf", sha256: "hash-c" }] },
      { stableKey: "vendor-a", position: 1, description: "Đặt cọc A", amount: "25000000", icRevisionId: "ic-r1", icLineId: "ic-a", recipientKey: "VENDOR:a", documents: [{ id: "doc-a2", name: "bao-gia-a.pdf", sha256: "hash-a" }] },
      { stableKey: "added", position: 2, description: "Đặt cọc B", amount: "40000000", icRevisionId: "ic-r2", icLineId: "ic-b", recipientKey: "VENDOR:b", documents: [{ id: "doc-b", name: "bao-gia-b.pdf", sha256: "hash-b" }] },
    ],
  };

  const diff = diffPaymentDossiers(before, after);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.headerChanges.map(change => change.field), ["title", "milestone", "explanation"]);
  assert.equal(diff.lineChanges.find(change => change.stableKey === "removed")?.kind, "REMOVED");
  assert.equal(diff.lineChanges.find(change => change.stableKey === "added")?.kind, "ADDED");
  assert.deepEqual(diff.lineChanges.find(change => change.stableKey === "employee-c")?.changes.map(change => change.field), ["position", "description", "amount", "icRevisionId", "icLineId", "recipientKey", "documents"]);
  assert.equal(diff.lineChanges.find(change => change.stableKey === "vendor-a")?.changes[0]?.field, "position");
  assert.deepEqual(diff.documents.added.map(document => document.sha256).sort(), ["hash-b", "hash-c"]);
  assert.deepEqual(diff.documents.removed.map(document => document.sha256), []);
  assert.deepEqual(diff.totals, { before: "40000000", after: "77000000" });
  assert.deepEqual(diff.recipientTotals.before, { "USER:c": "10000000", "VENDOR:a": "25000000", "VENDOR:x": "5000000" });
  assert.deepEqual(diff.recipientTotals.after, { "USER:d": "12000000", "VENDOR:a": "25000000", "VENDOR:b": "40000000" });
});

test("payment-diff: database ids do not affect logical identity and unchanged sha256 does not fabricate a document diff", () => {
  const before = original();
  const after = structuredClone(before);
  after.lines[0].documents[0].id = "different-database-id";

  assert.deepEqual(diffPaymentDossiers(before, after), {
    changed: false,
    headerChanges: [],
    lineChanges: [],
    documents: { added: [], removed: [] },
    totals: { before: "40000000", after: "40000000" },
    recipientTotals: {
      before: { "USER:c": "10000000", "VENDOR:a": "25000000", "VENDOR:x": "5000000" },
      after: { "USER:c": "10000000", "VENDOR:a": "25000000", "VENDOR:x": "5000000" },
    },
  });
});

test("payment-diff: duplicate stable keys are rejected instead of pairing by database id", () => {
  const invalid = original();
  invalid.lines.push({ ...invalid.lines[0], position: 4 });
  assert.throws(() => diffPaymentDossiers(invalid, original()), /stableKey.*duy nhất/i);
});
