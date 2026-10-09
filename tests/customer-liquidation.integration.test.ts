import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { ProjectUpload } from "../lib/projectFiles";

function approvedDatabaseUrl() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Phase 8 test requires PostgreSQL");
  assert.equal(url.hostname, "127.0.0.1", "Phase 8 test only uses 127.0.0.1");
  assert.equal(url.port, "55439", "Phase 8 test only uses port 55439");
  assert.equal(url.pathname, "/taskflow", "Phase 8 test only uses database taskflow");
}

test("customer-liquidation integration: immutable liquidation, idempotent AR and isolated net margin", async () => {
  approvedDatabaseUrl();
  const { prisma } = await import("../lib/prisma");
  const { executeFinance, loadFinance } = await import("../lib/costflow/service");
  const { calculateCost } = await import("../lib/costflow/money");
  const { emptyFinance } = await import("../lib/costflow/types");
  const prefix = `phase8-customer-${randomUUID()}`;
  const userIds: string[] = [];
  let projectId = "";
  try {
    const member = await prisma.user.create({ data: { email: `${prefix}-member@example.test`, name: "Customer member", role: "USER", passwordHash: "unused" } });
    const outsider = await prisma.user.create({ data: { email: `${prefix}-outsider@example.test`, name: "Customer outsider", role: "USER", passwordHash: "unused" } });
    userIds.push(member.id, outsider.id);
    const project = await prisma.project.create({ data: { name: prefix, ownerId: member.id, revenue: 777, members: { create: [{ userId: member.id }] } } });
    projectId = project.id;
    const finance = emptyFinance();
    const quoteCost = calculateCost({ quantity: "1", unitPrice: "150000000", basis: "NET", vatPercent: "10" });
    finance.quotations = [{ id: `${prefix}-quote`, number: 1, parentId: null, title: "Final quote", customer: "Customer", notes: "", lines: [{ id: `${prefix}-quote-line`, description: "Service", unit: "gói", quantity: "1", days: "1", unitPrice: "150000000", basis: "NET", vatPercent: "10", cost: quoteCost }], poIds: [], evidenceIds: [], createdBy: member.id, createdAt: "2026-10-09T00:00:00.000Z" }];
    finance.pos = [{ id: `${prefix}-po`, number: "PO-1", net: "140000000", sourceId: `${prefix}-po-evidence` }];
    const normalizedCost = calculateCost({ quantity: "1", unitPrice: "70000000", basis: "NET", vatPercent: "0" });
    finance.expenses = [
      { id: `${prefix}-ac`, revisionId: "legacy", lineId: "legacy", recipientKey: `USER:${member.id}`, description: "Duplicate legacy projection", input: { quantity: "1", unitPrice: "99999999", basis: "NET", vatPercent: "0" }, cost: calculateCost({ quantity: "1", unitPrice: "99999999", basis: "NET", vatPercent: "0" }), invoiceId: "", paymentProofId: "", createdBy: member.id },
      { id: `${prefix}-legacy-only`, revisionId: "legacy", lineId: "legacy-only", recipientKey: `USER:${member.id}`, description: "Legacy compatibility", input: { quantity: "1", unitPrice: "10000000", basis: "NET", vatPercent: "0" }, cost: calculateCost({ quantity: "1", unitPrice: "10000000", basis: "NET", vatPercent: "0" }), invoiceId: "", paymentProofId: "", createdBy: member.id },
    ];
    await prisma.costFlowWorkspace.create({ data: { projectId, data: finance } });
    const acLine = await prisma.actualCostLine.create({ data: { projectId, stableLineId: `${prefix}-ac`, sourceKind: "UNBUDGETED", recipientKey: `USER:${member.id}`, createdById: member.id, currentVersion: 1 } });
    await prisma.actualCostVersion.create({ data: { projectId, lineId: acLine.id, version: 1, state: "SUBMITTED", description: "Normalized incurred", fundingSource: "EMPLOYEE_OUT_OF_POCKET", quantity: "1", days: "1", unitPrice: "70000000", unit: "gói", basis: "NET", vatPercent: "0", amount: normalizedCost.gross, rawAmount: normalizedCost.rawGross, createdById: member.id, submittedAt: new Date() } });

    const fallback = await loadFinance(projectId, member);
    assert.equal(fallback?.customerAccounting.margin.source, "FINALIZED_QUOTATION_NET");
    assert.equal(fallback?.customerAccounting.margin.incurredNet, "80000000");
    assert.equal(fallback?.customerAccounting.margin.netMargin, "70000000");
    assert.equal(fallback?.customerAccounting.margin.legacyCompatibility, true);

    const proof = (name: string, values: number[]): ProjectUpload => { const data = new Uint8Array(values); return { name, mimeType: "application/pdf", size: data.byteLength, data }; };
    const proof1 = proof("tl-1.pdf", [1, 2, 3]);
    const proof2 = proof("tl-2.pdf", [4, 5, 6]);
    const liquidationForm = (number: string, net: string, vat: string, gross: string) => {
      const form = new FormData();
      form.set("command", "SAVE_CUSTOMER_LIQUIDATION"); form.set("documentNumber", number); form.set("signedAt", "2026-10-09");
      form.set("netAmount", net); form.set("vatAmount", vat); form.set("grossAmount", gross);
      return form;
    };
    await assert.rejects(() => executeFinance(projectId, 0, member, liquidationForm("TL-BAD", "100000000", "10000000", "999999999"), proof("bad.pdf", [1, 2, 3])), /net.*VAT|tổng/i);
    await assert.rejects(() => executeFinance(projectId, 0, outsider, liquidationForm("TL-X", "100000000", "10000000", "110000000"), proof("x.pdf", [1, 2, 3])), /quyền|phân công/i);
    await executeFinance(projectId, 0, member, liquidationForm("TL-1", "100000000", "10000000", "110000000"), proof1);
    await executeFinance(projectId, 1, member, liquidationForm("TL-2", "120000000", "12000000", "132000000"), proof2);
    const versions = await prisma.customerLiquidation.findMany({ where: { projectId }, include: { evidence: true }, orderBy: { version: "asc" } });
    assert.equal(versions.length, 2);
    assert.equal(versions[0].documentNumber, "TL-1");
    assert.equal(versions[0].evidence.sha256, createHash("sha256").update(proof1.data).digest("hex"));
    assert.equal(versions[1].evidence.sha256, createHash("sha256").update(proof2.data).digest("hex"));

    const cashForm = (amount = "50000000", key = `${prefix}-ar-key`, reference = `${prefix}-ar-ref`) => {
      const form = new FormData();
      form.set("command", "ADD_CUSTOMER_CASH_IN"); form.set("milestone", "Đợt 2"); form.set("occurredAt", "2026-10-09");
      form.set("amount", amount); form.set("reference", reference); form.set("idempotencyKey", key);
      return form;
    };
    const receiptProof = proof("receipt.pdf", [7, 8, 9]);
    await executeFinance(projectId, 2, member, cashForm(), receiptProof);
    const retry = await executeFinance(projectId, 2, member, cashForm(), receiptProof);
    assert.equal(retry.idempotent, true);
    await assert.rejects(() => executeFinance(projectId, 2, member, cashForm("60000000"), receiptProof), /đã được dùng/i);
    assert.equal(await prisma.customerCashIn.count({ where: { projectId } }), 1);

    const raceKey = `${prefix}-ar-race-key`;
    const raceReference = `${prefix}-ar-race-ref`;
    const concurrentReceipt = await Promise.allSettled([
      executeFinance(projectId, 3, member, cashForm("10000000", raceKey, raceReference), receiptProof),
      executeFinance(projectId, 3, member, cashForm("10000000", raceKey, raceReference), receiptProof),
    ]);
    assert.equal(concurrentReceipt.filter(result => result.status === "fulfilled").length, 1, "concurrent AR receipt has exactly one winner");
    assert.equal(await prisma.customerCashIn.count({ where: { projectId, idempotencyKey: raceKey } }), 1, "concurrent loser writes no duplicate receipt");
    assert.equal(await prisma.costFlowEvidence.count({ where: { projectId, kind: "CUSTOMER_CASH_IN" } }), 2, "rolled-back receipt creates no orphan evidence");

    const current = await loadFinance(projectId, member);
    assert.equal(current?.customerAccounting.currentLiquidation?.version, 2);
    assert.equal(current?.customerAccounting.margin.source, "SIGNED_LIQUIDATION_NET");
    assert.equal(current?.customerAccounting.margin.revenueNet, "120000000");
    assert.equal(current?.customerAccounting.margin.incurredNet, "80000000");
    assert.equal(current?.customerAccounting.margin.netMargin, "40000000");
    assert.equal(current?.customerAccounting.receivable.collectedGross, "60000000");
    assert.equal(current?.customerAccounting.receivable.outstandingGross, "72000000");
    assert.equal(await prisma.costFlowCash.count({ where: { projectId } }), 0);
    assert.equal(await prisma.workflowRequest.count({ where: { projectId } }), 0);
    assert.equal(await prisma.actualCostApplication.count({ where: { projectId } }), 0);
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).revenue, 777);
  } finally {
    if (projectId) {
      await prisma.customerCashIn.deleteMany({ where: { projectId } });
      await prisma.customerLiquidation.deleteMany({ where: { projectId } });
      await prisma.actualCostApplication.deleteMany({ where: { projectId } });
      await prisma.actualCostApproval.deleteMany({ where: { projectId } });
      await prisma.actualCostVersion.deleteMany({ where: { projectId } });
      await prisma.actualCostLine.deleteMany({ where: { projectId } });
      await prisma.costFlowHistory.deleteMany({ where: { projectId } });
      await prisma.costFlowEvidence.deleteMany({ where: { projectId } });
      await prisma.costFlowWorkspace.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId, name: prefix } });
    }
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds }, email: { startsWith: prefix } } });
  }
});
