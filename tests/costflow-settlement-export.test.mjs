import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalSettlementProjection,
  settlementProjectionHash,
  validateSettlementExportAccess,
} from "../lib/costflow/settlementSecurity.ts";

function projection(overrides = {}) {
  return {
    projectId: "project-a",
    family: "PROJECT_SETTLEMENT",
    source: {
      dossierId: "dossier-a",
      dossierVersionId: "dossier-version-2",
      dossierVersion: 2,
      documentVersionId: "document-version-4",
      documentVersion: 4,
      state: "APPROVED",
      supersedesId: "dossier-version-1",
      replacedById: null,
      replacementReason: "Nguồn mới sau B02 reopen",
    },
    totals: { rawNet: "100/1", rawVat: "8/1", rawGross: "108/1", net: "100", vat: "8", gross: "108" },
    recipients: [
      { recipientKey: "VENDOR:b", recipientType: "VENDOR", displayName: "B", actualGross: "58", advanceGross: "0", refundDue: "0", additionalDue: "58" },
      { recipientKey: "USER:a", recipientType: "EMPLOYEE", displayName: "A", actualGross: "50", advanceGross: "50", refundDue: "0", additionalDue: "0" },
    ],
    items: [
      { stableLineId: "line-b", description: "B", recipientKey: "VENDOR:b", rawNet: "50/1", rawVat: "8/1", rawGross: "58/1", net: "50", vat: "8", gross: "58" },
      { stableLineId: "line-a", description: "A", recipientKey: "USER:a", rawNet: "50/1", rawVat: "0/1", rawGross: "50/1", net: "50", vat: "0", gross: "50" },
    ],
    obligations: [
      { recipientKey: "VENDOR:b", direction: "ADDITIONAL", amountDue: "58" },
      { recipientKey: "USER:a", direction: "BALANCED", amountDue: "0" },
    ],
    evidence: [
      { id: "evidence-b", kind: "EXPENSE_EVIDENCE", sha256: "b".repeat(64) },
      { id: "evidence-a", kind: "DISBURSEMENT_PROOF", sha256: "a".repeat(64) },
    ],
    signingSnapshot: {
      id: "snapshot-4",
      state: "DIGITAL_CONFIRMED",
      projectionSha256: "f".repeat(64),
      events: [
        { role: "MANAGER", actorId: "manager", eventHash: "2".repeat(64), signedAt: "2026-10-11T01:10:00.000Z" },
        { role: "CREATOR", actorId: "creator", eventHash: "1".repeat(64), signedAt: "2026-10-11T01:00:00.000Z" },
      ],
    },
    ...overrides,
  };
}

test("settlement export hash: canonical ordering is deterministic", () => {
  const first = projection();
  const second = projection({
    recipients: [...first.recipients].reverse(),
    items: [...first.items].reverse(),
    obligations: [...first.obligations].reverse(),
    evidence: [...first.evidence].reverse(),
    signingSnapshot: { ...first.signingSnapshot, events: [...first.signingSnapshot.events].reverse() },
  });
  assert.deepEqual(canonicalSettlementProjection(first), canonicalSettlementProjection(second));
  assert.equal(settlementProjectionHash(first), settlementProjectionHash(second));
});

test("settlement export hash: equal totals with different lines or allocations hash differently", () => {
  const base = projection();
  const changedLine = projection({ items: base.items.map((line, index) => index ? line : { ...line, stableLineId: "line-tampered" }) });
  const changedAllocation = projection({ recipients: base.recipients.map((recipient, index) => index ? recipient : { ...recipient, recipientKey: "VENDOR:tampered" }) });
  assert.notEqual(settlementProjectionHash(base), settlementProjectionHash(changedLine));
  assert.notEqual(settlementProjectionHash(base), settlementProjectionHash(changedAllocation));
});

test("settlement export hash: covers voucher, evidence, replacement, version and confirmed signing chain", () => {
  const base = projection();
  const variants = [
    { family: "DNTT" },
    { evidence: [{ ...base.evidence[0], sha256: "9".repeat(64) }, base.evidence[1]] },
    { source: { ...base.source, dossierVersionId: "dossier-version-3", dossierVersion: 3 } },
    { source: { ...base.source, replacedById: "dossier-version-3" } },
    { signingSnapshot: { ...base.signingSnapshot, state: "PHYSICAL_CONFIRMED" } },
    { signingSnapshot: { ...base.signingSnapshot, events: base.signingSnapshot.events.map((event, index) => index ? event : { ...event, eventHash: "8".repeat(64) }) } },
  ];
  for (const change of variants) assert.notEqual(settlementProjectionHash(base), settlementProjectionHash(projection(change)));
});

test("settlement export access: member/admin only and exact project/version ownership", () => {
  assert.doesNotThrow(() => validateSettlementExportAccess({
    actorId: "member", actorRole: "MEMBER", membershipProjectId: "project-a",
    routeProjectId: "project-a", sourceProjectId: "project-a", requestedVersionId: "version-a", sourceVersionId: "version-a", sourceState: "APPROVED",
  }));
  assert.doesNotThrow(() => validateSettlementExportAccess({
    actorId: "admin", actorRole: "ADMIN", membershipProjectId: null,
    routeProjectId: "project-a", sourceProjectId: "project-a", requestedVersionId: "version-a", sourceVersionId: "version-a", sourceState: "APPROVED",
  }));
  assert.throws(() => validateSettlementExportAccess({ actorId: "outsider", actorRole: "MEMBER", membershipProjectId: null, routeProjectId: "project-a", sourceProjectId: "project-a", requestedVersionId: "version-a", sourceVersionId: "version-a", sourceState: "APPROVED" }), /quyền|member|thành viên/i);
  assert.throws(() => validateSettlementExportAccess({ actorId: "member", actorRole: "MEMBER", membershipProjectId: "project-a", routeProjectId: "project-a", sourceProjectId: "project-b", requestedVersionId: "version-a", sourceVersionId: "version-a", sourceState: "APPROVED" }), /project/i);
  assert.throws(() => validateSettlementExportAccess({ actorId: "member", actorRole: "MEMBER", membershipProjectId: "project-a", routeProjectId: "project-a", sourceProjectId: "project-a", requestedVersionId: "version-a", sourceVersionId: "version-b", sourceState: "APPROVED" }), /version|phiên bản/i);
  assert.throws(() => validateSettlementExportAccess({ actorId: "member", actorRole: "MEMBER", membershipProjectId: "project-a", routeProjectId: "project-a", sourceProjectId: "project-a", requestedVersionId: "version-a", sourceVersionId: "version-a", sourceState: "DRAFT" }), /immutable|duyệt|approved/i);
});

test("settlement export route: persists canonical and emitted-file hashes without customer-safe disclosure", async () => {
  const route = await readFile(new URL("../app/api/projects/[id]/costflow/export/[type]/route.ts", import.meta.url), "utf8");
  assert.match(route, /SettlementExportAudit|settlementExportAudit/);
  assert.match(route, /canonicalHash/);
  assert.match(route, /fileHash|fileSha256/);
  assert.match(route, /approvedSnapshotId/);
  assert.match(route, /dossierVersionId/);
  assert.match(route, /getMembership|ADMIN/);
  assert.doesNotMatch(route, /bankAccount|accountNumber|privateNotes/);
});

