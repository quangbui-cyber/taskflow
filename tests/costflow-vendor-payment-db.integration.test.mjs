import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const PINNED = "postgresql://postgres@127.0.0.1:55439/costflow_test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("post-AC DNTT persists one invoice, exact AC lineage and idempotent applications", async () => {
  assert.equal(process.env.DATABASE_URL, PINNED);
  const schema = `phase14_vendor_payment_${process.pid}_${Date.now()}`;
  const url = `${PINNED}?schema=${schema}`;
  const admin = new PrismaClient({ datasources: { db: { url: PINNED } } });
  let client;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    const supplierService = await import(`../lib/costflow/supplierService.ts?vp=${schema}`);
    const supplierRead = await import(`../lib/costflow/supplierReadModel.ts?vp=${schema}`);
    const paymentService = await import(`../lib/costflow/vendorPaymentService.ts?vp=${schema}`);
    const financeService = await import(`../lib/costflow/service.ts?vp=${schema}`);
    client = new PrismaClient({ datasources: { db: { url } } });
    const pinHash = await bcrypt.hash("123456", 4);
    const manager = await client.user.create({ data: { email: `${schema}-manager@test`, name: "Manager", passwordHash: "x" } });
    const accountant = await client.user.create({ data: { email: `${schema}-accountant@test`, name: "Accountant", passwordHash: "x" } });
    const ceo = await client.user.create({ data: { email: `${schema}-ceo@test`, name: "CEO", passwordHash: "x" } });
    const account = await client.user.create({ data: { email: `${schema}-account@test`, name: "Account", passwordHash: "x", role: "ACCOUNT", managerId: manager.id, signaturePinHash: pinHash } });
    const project = await client.project.create({ data: { name: "VAT Project", ownerId: account.id, members: { create: { userId: account.id, role: "owner" } } } });
    const icLineId = "ic-line-1";
    const revisionId = "ic-revision-1";
    await client.costFlowWorkspace.create({ data: { projectId: project.id, data: { config: { accountantId: accountant.id, ceoId: ceo.id, managerId: manager.id, operationUserIds: [] }, closed: false, beneficiaries: [], expenses: [], pos: [], revisions: [{ id: revisionId, number: 1, requestId: "ic-request", effective: true, lines: [{ id: icLineId, description: "NCC", quantity: "1", days: "1", unitPrice: "1100", unit: "gói", basis: "GROSS", vatPercent: "10", evidenceIds: ["ic-proof-history"] }] }] } } });
    const supplier = await supplierService.createSupplier({ id: account.id, role: "ACCOUNT" }, { legalName: "Công ty VAT", taxCode: "0312345678", bankName: "BIDV", accountHolder: "CONG TY VAT", accountNumber: "123456789" });
    await supplierService.verifySupplierTuple({ id: accountant.id, role: accountant.role }, { projectId: project.id, supplierId: supplier.supplierId, supplierVersionId: supplier.supplierVersionId, bankAccountId: supplier.bankAccountId, bankAccountVersionId: supplier.bankAccountVersionId, decision: "VERIFIED", reason: "Khớp" });
    const recipientKey = supplierRead.supplierRecipientKey(supplier.supplierId, supplier.bankAccountId);
    const line = await client.actualCostLine.create({ data: { projectId: project.id, stableLineId: "ac-stable-1", sourceKind: "IC_LINKED", icRevisionId: revisionId, icLineId, recipientKey, createdById: account.id, currentVersion: 1 } });
    const version = await client.actualCostVersion.create({ data: { projectId: project.id, lineId: line.id, version: 1, state: "APPROVED", description: "Thanh toán NCC", fundingSource: "VENDOR_PAYMENT", quantity: "1", days: "1", unitPrice: "1100", unit: "gói", basis: "GROSS", vatPercent: "10", amount: "1100", rawAmount: "1100/1", createdById: account.id } });
    const approval = await client.actualCostApproval.create({ data: { projectId: project.id, lineId: line.id, versionId: version.id, attemptId: "dd-attempt-1", retryKey: "dd-retry-1", action: "APPROVED", actorId: accountant.id } });
    const input = { projectId: project.id, title: "ĐNTT VAT", recipientKey, invoice: { invoiceNumber: "0001", symbol: "1C26TAA", issuedAt: "2026-10-16", sellerTaxCode: "0312345678", netAmount: "1000", vatAmount: "100", grossAmount: "1100" }, files: [{ name: "invoice.pdf", mimeType: "application/pdf", size: 8, data: new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x37]) }], selections: [{ stableLineId: line.stableLineId, versionId: version.id, approvalId: approval.id, approvalAttemptId: approval.attemptId, amount: "1100" }], idempotencyKey: "invoice-command-1", signatureData: PNG, signaturePin: "123456" };
    const created = await paymentService.createVendorPaymentDossier({ id: account.id, role: "ACCOUNT" }, input);
    assert.equal(created.idempotent, false);
    assert.equal(await client.vendorInvoice.count(), 1);
    assert.equal(await client.vendorInvoiceFile.count(), 1);
    assert.equal(await client.vendorInvoiceActualCost.count(), 1);
    assert.equal(await client.vendorInvoiceApplication.count(), 1);
    const request = await client.workflowRequest.findUniqueOrThrow({ where: { id: created.requestId }, include: { paymentLines: true } });
    assert.equal(request.kind, "VENDOR_PAYMENT");
    assert.equal(request.paymentLines[0].evidenceManifest.some(item => item?.name === "ic-proof-history"), false, "IC evidence stays history-only");
    const retried = await paymentService.createVendorPaymentDossier({ id: account.id, role: "ACCOUNT" }, input);
    assert.deepEqual(retried, { requestId: created.requestId, idempotent: true });
    await assert.rejects(paymentService.createVendorPaymentDossier({ id: account.id, role: "ACCOUNT" }, { ...input, idempotencyKey: "invoice-command-2" }), /vượt phần AC|Unique constraint|đã tồn tại|businessKey/i);

    const returnForm = new FormData();
    returnForm.set("command", "DECIDE");
    returnForm.set("requestId", created.requestId);
    returnForm.set("module", "COSTFLOW");
    returnForm.set("attemptId", request.currentAttemptId);
    returnForm.set("stepIndex", "0");
    returnForm.set("submittedVersion", String(request.version));
    returnForm.set("decision", "RETURN");
    returnForm.set("reason", "Cần lập lại hồ sơ VAT");
    returnForm.append("correctionItems", "Đổi hóa đơn");
    await financeService.executeFinance(project.id, 0, { id: manager.id, role: manager.role }, returnForm, null);
    assert.equal((await client.vendorInvoiceApplication.findFirstOrThrow({ where: { requestId: created.requestId } })).state, "RELEASED");

    const replacement = await paymentService.createVendorPaymentDossier({ id: account.id, role: "ACCOUNT" }, {
      ...input,
      invoice: { ...input.invoice, invoiceNumber: "0002" },
      idempotencyKey: "invoice-command-replacement",
    });
    assert.equal(replacement.idempotent, false, "released allocation does not double count or block the replacement dossier");
    assert.equal(await client.vendorInvoiceApplication.count({ where: { state: "ACTIVE" } }), 1);
    assert.equal(await client.vendorInvoiceApplication.count({ where: { state: "RELEASED" } }), 1);
  } finally {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
    process.env.DATABASE_URL = PINNED;
  }
});
