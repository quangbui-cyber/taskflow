import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/costflow_test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("company supplier lifecycle keeps exact versions and reuses verification across projects", async () => {
  assert.equal(process.env.DATABASE_URL, PINNED_DATABASE_URL);
  const schemaName = `phase14_supplier_service_${process.pid}_${Date.now()}`;
  const url = `${PINNED_DATABASE_URL}?schema=${schemaName}`;
  const adminDb = new PrismaClient({ datasources: { db: { url: PINNED_DATABASE_URL } } });
  let client;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    const service = await import(`../lib/costflow/supplierService.ts?schema=${schemaName}`);
    const readModel = await import(`../lib/costflow/supplierReadModel.ts?schema=${schemaName}`);
    client = new PrismaClient({ datasources: { db: { url } } });
    const [account, accountant, outsider] = await Promise.all([
      client.user.create({ data: { email: `${schemaName}-account@test.local`, name: "Account", passwordHash: "test", role: "ACCOUNT" } }),
      client.user.create({ data: { email: `${schemaName}-kt@test.local`, name: "Kế toán", passwordHash: "test" } }),
      client.user.create({ data: { email: `${schemaName}-other@test.local`, name: "Other", passwordHash: "test" } }),
    ]);
    const projectA = await client.project.create({ data: { name: "A", ownerId: account.id, members: { create: { userId: account.id, role: "owner" } } } });
    const projectB = await client.project.create({ data: { name: "B", ownerId: account.id, members: { create: { userId: account.id, role: "owner" } } } });
    const financeData = { config: { accountantId: accountant.id, ceoId: "", managerId: "", operationUserIds: [] }, closed: false, revisions: [], beneficiaries: [], expenses: [], pos: [] };
    await client.costFlowWorkspace.createMany({ data: [{ projectId: projectA.id, data: financeData }, { projectId: projectB.id, data: financeData }] });

    await assert.rejects(
      service.createSupplier({ id: outsider.id, role: outsider.role }, { legalName: "Không hợp lệ", taxCode: "", address: "", bankName: "VCB", bankCode: "", accountHolder: "X", accountNumber: "1" }),
      /Account hoặc Admin/,
    );
    const created = await service.createSupplier({ id: account.id, role: account.role }, {
      legalName: "Công ty TNHH Ánh Dương",
      taxCode: "0312-345-678",
      address: "TP.HCM",
      bankName: "BIDV",
      bankCode: "BIDV",
      accountHolder: "CONG TY TNHH ANH DUONG",
      accountNumber: "0012 3456 789",
    });
    const recipientKey = readModel.supplierRecipientKey(created.supplierId, created.bankAccountId);
    const fromA = await readModel.resolveSupplierRecipient(client, projectA.id, recipientKey);
    const fromB = await readModel.resolveSupplierRecipient(client, projectB.id, recipientKey);
    assert.equal(fromA?.supplierId, created.supplierId);
    assert.deepEqual(fromB, fromA, "the same current tuple is selectable across projects");
    assert.equal(fromA?.verificationStatus, "UNVERIFIED");

    const verified = await service.verifySupplierTuple({ id: accountant.id, role: accountant.role }, {
      projectId: projectA.id,
      supplierId: created.supplierId,
      supplierVersionId: created.supplierVersionId,
      bankAccountId: created.bankAccountId,
      bankAccountVersionId: created.bankAccountVersionId,
      decision: "VERIFIED",
      reason: "Đối chiếu thủ công",
    });
    assert.equal(verified.evidenceId, null, "proof is optional");
    assert.equal((await readModel.resolveSupplierRecipient(client, projectB.id, recipientKey))?.verificationStatus, "VERIFIED");

    const changed = await service.publishSupplierBankVersion({ id: account.id, role: account.role }, {
      supplierId: created.supplierId,
      bankAccountId: created.bankAccountId,
      expectedVersion: 1,
      bankName: "BIDV",
      bankCode: "BIDV",
      accountHolder: "CONG TY TNHH ANH DUONG",
      accountNumber: "999900001111",
      reason: "Đổi tài khoản nhận tiền",
    });
    assert.equal(changed.version, 2);
    const current = await readModel.resolveSupplierRecipient(client, projectA.id, recipientKey);
    assert.equal(current?.verificationStatus, "UNVERIFIED", "a changed current bank tuple needs re-verification");
    assert.equal(current?.frozenBankVersionId, changed.bankAccountVersionId);
    await assert.rejects(
      service.verifySupplierTuple({ id: accountant.id, role: accountant.role }, { projectId: projectA.id, supplierId: created.supplierId, supplierVersionId: created.supplierVersionId, bankAccountId: created.bankAccountId, bankAccountVersionId: created.bankAccountVersionId, decision: "VERIFIED", reason: "stale" }),
      /phiên bản hiện hành/,
    );
    await service.verifySupplierTuple({ id: accountant.id, role: accountant.role }, {
      projectId: projectB.id,
      supplierId: created.supplierId,
      supplierVersionId: created.supplierVersionId,
      bankAccountId: created.bankAccountId,
      bankAccountVersionId: changed.bankAccountVersionId,
      decision: "REJECTED",
      reason: "Tên tài khoản chưa khớp",
      proof: { name: "proof.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.7 proof") },
    });
    const rejected = await readModel.resolveSupplierRecipient(client, projectA.id, recipientKey);
    assert.equal(rejected?.verificationStatus, "REJECTED");
    assert.equal(rejected?.latestVerification?.reason, "Tên tài khoản chưa khớp");
    assert.equal(await client.supplierEvidence.count(), 1);
  } finally {
    await client?.$disconnect();
    await adminDb.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminDb.$disconnect();
    process.env.DATABASE_URL = PINNED_DATABASE_URL;
  }
});
