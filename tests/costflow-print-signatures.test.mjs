import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SETTLEMENT_PRINT_FAMILIES,
  buildSettlementPrintDocument,
} from "../lib/costflow/settlementSecurity.ts";

const roles = ["CREATOR", "MANAGER", "ACCOUNTANT", "CEO"];

function projection(overrides = {}) {
  return {
    projectId: "project-print",
    projectName: "Jabil POSM",
    family: "DNHTU",
    source: {
      dossierId: "dossier-1",
      dossierVersionId: "settlement-version-2",
      dossierVersion: 2,
      documentVersionId: "approved-snapshot-4",
      documentVersion: 4,
      state: "APPROVED",
      supersedesId: "settlement-version-1",
      replacedById: null,
      replacementReason: "B02 reopen",
    },
    title: "Hoàn tạm ứng",
    approvedAt: "2026-10-11T02:00:00.000Z",
    totals: {
      rawNet: "20000001/2",
      rawVat: "1600001/2",
      rawGross: "10800001/1",
      net: "10000001",
      vat: "800000",
      gross: "10800001",
    },
    recipients: [{
      recipientKey: "USER:account-a",
      recipientType: "EMPLOYEE",
      displayName: "Account A",
      actualGross: "10800001",
      advanceGross: "12000000",
      refundDue: "1199999",
      additionalDue: "0",
    }],
    items: [{
      stableLineId: "ac-line-a",
      description: "Thi công POSM",
      recipientKey: "USER:account-a",
      rawNet: "20000001/2",
      rawVat: "1600001/2",
      rawGross: "10800001/1",
      net: "10000001",
      vat: "800000",
      gross: "10800001",
    }],
    obligations: [{ recipientKey: "USER:account-a", direction: "REFUND", amountDue: "1199999" }],
    evidence: [{ id: "invoice-a", kind: "EXPENSE_EVIDENCE", sha256: "a".repeat(64) }],
    signingSnapshot: {
      id: "approved-snapshot-4",
      state: "CHO_KY",
      projectionSha256: "b".repeat(64),
      events: [],
    },
    ...overrides,
  };
}

function signingEvents(count = 4) {
  return roles.slice(0, count).map((role, index) => ({
    role,
    actorId: `actor-${index}`,
    actorName: `Người ký ${index + 1}`,
    signedAt: `2026-10-11T02:0${index}:00.000Z`,
    imageSha256: String(index + 1).repeat(64),
    eventHash: String(index + 5).repeat(64),
    signatureDataUrl: `data:image/png;base64,signature-${index}`,
    confirmed: true,
  }));
}

test("print contract: exposes exactly six immutable PDF/print families", () => {
  assert.deepEqual(SETTLEMENT_PRINT_FAMILIES, [
    "QUOTATION", "CUSTOMER_ACCEPTANCE", "DNTU", "DNTT", "DNHTU", "PROJECT_SETTLEMENT",
  ]);
  for (const family of SETTLEMENT_PRINT_FAMILIES) {
    const doc = buildSettlementPrintDocument({ projection: projection({ family }), signingEvents: [] });
    assert.equal(doc.family, family);
    assert.equal(doc.sourceVersionId, "settlement-version-2");
    assert.equal(doc.documentVersion, 4);
    assert.equal(doc.approvalState, "APPROVED");
  }
});

test("print contract: approval alone never becomes a signature", () => {
  const doc = buildSettlementPrintDocument({ projection: projection(), signingEvents: [] });
  assert.equal(doc.signingState, "UNSIGNED");
  assert.equal(doc.verificationPath, undefined);
  assert.ok(doc.signatureSlots.every(slot => slot.state === "UNSIGNED" && !slot.signatureDataUrl));
});

test("print contract: partial and confirmed states use only confirmed WorkflowSigningEvent evidence", () => {
  const partialEvents = signingEvents(2);
  const partialProjection = projection({
    signingSnapshot: {
      ...projection().signingSnapshot,
      events: partialEvents.map(({ role, actorId, signedAt, eventHash }) => ({ role, actorId, signedAt, eventHash })),
    },
  });
  const partial = buildSettlementPrintDocument({ projection: partialProjection, signingEvents: partialEvents });
  assert.equal(partial.signingState, "PARTIALLY_SIGNED");
  assert.deepEqual(partial.signatureSlots.map(slot => slot.state), ["SIGNED", "SIGNED", "UNSIGNED", "UNSIGNED"]);

  const confirmedEvents = signingEvents();
  const confirmedProjection = projection({
    signingSnapshot: {
      ...projection().signingSnapshot,
      state: "DIGITAL_CONFIRMED",
      events: confirmedEvents.map(({ role, actorId, signedAt, eventHash }) => ({ role, actorId, signedAt, eventHash })),
    },
  });
  const confirmed = buildSettlementPrintDocument({
    projection: confirmedProjection,
    signingEvents: confirmedEvents,
    publicVerificationToken: "x".repeat(43),
  });
  assert.equal(confirmed.signingState, "SIGNED_CONFIRMED");
  assert.equal(confirmed.verificationPath, `/workflow/verify/${"x".repeat(43)}`);
  assert.ok(confirmed.signatureSlots.every(slot => slot.state === "SIGNED" && slot.signatureDataUrl));

  const unconfirmed = buildSettlementPrintDocument({
    projection: confirmedProjection,
    signingEvents: confirmedEvents.map((event, index) => index ? event : { ...event, confirmed: false }),
  });
  assert.equal(unconfirmed.signatureSlots[0].state, "UNSIGNED");
  assert.equal(unconfirmed.signatureSlots[0].signatureDataUrl, undefined);
});

test("print contract: approved Gross and money in words equal the service/XLSX projection exactly", () => {
  const doc = buildSettlementPrintDocument({ projection: projection(), signingEvents: [] });
  assert.equal(doc.totals.net, "10000001");
  assert.equal(doc.totals.vat, "800000");
  assert.equal(doc.approvedGross, "10800001");
  assert.match(doc.moneyInWords, /mười triệu tám trăm nghìn không trăm lẻ một đồng/i);
});

test("print route/layout: server-bound projection, accessible tables, print breaks and four honest slots", async () => {
  const route = await readFile(new URL("../app/projects/[id]/costflow/[type]/[version]/print/page.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../components/costflow/settlement/SettlementPrintLayout.tsx", import.meta.url), "utf8");
  assert.match(route, /await params/);
  assert.match(route, /requireUser|getCurrentUser/);
  assert.match(route, /workflowSigningEvent|signingEvents/);
  assert.match(route, /deriveAuthorizedPublicTokenForSnapshot/);
  assert.match(route, /settlementExportAudit/);
  assert.match(route, /format:\s*"PDF"/);
  assert.doesNotMatch(route, /publicVerificationToken:\s*(?:id|projectId|version|source\.id)/);
  assert.match(layout, /<caption/);
  assert.match(layout, /scope="col"/);
  assert.match(layout, /break-inside|page-break/);
  for (const role of roles) assert.match(layout, new RegExp(role));
});
