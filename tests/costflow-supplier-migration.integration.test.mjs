import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { migrateLegacySuppliers } from "../lib/costflow/supplierMigration.ts";

const PINNED_DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/costflow_test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("legacy beneficiaries are normalized once without rewriting their JSON", async () => {
  assert.equal(process.env.DATABASE_URL, PINNED_DATABASE_URL);
  const schemaName = `phase14_supplier_${process.pid}_${Date.now()}`;
  const url = `${PINNED_DATABASE_URL}?schema=${schemaName}`;
  const admin = new PrismaClient({ datasources: { db: { url: PINNED_DATABASE_URL } } });
  let client;
  try {
    execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
    client = new PrismaClient({ datasources: { db: { url } } });
    const actor = await client.user.create({ data: { email: `${schemaName}@test.local`, name: "Migration Actor", passwordHash: "test" } });
    const projectA = await client.project.create({ data: { name: "Supplier A", ownerId: actor.id } });
    const projectB = await client.project.create({ data: { name: "Supplier B", ownerId: actor.id } });
    const projectC = await client.project.create({ data: { name: "Supplier C", ownerId: actor.id } });
    const base = { config: { accountantId: "", ceoId: "", managerId: "", operationUserIds: [] }, closed: false, revisions: [], expenses: [], pos: [] };
    await client.costFlowWorkspace.createMany({ data: [
      { projectId: projectA.id, data: { ...base, beneficiaries: [
        { id: "hotel-a", name: "Khách sạn Ánh Dương", bank: "BIDV", account: "0012 3456", version: 2, verifiedVersion: 2 },
        { id: "same-name-other-account", name: "Khach san Anh Duong", bank: "BIDV", account: "99990000", version: 1, verifiedVersion: null, proofId: "missing-proof-is-allowed" },
      ] } },
      { projectId: projectB.id, data: { ...base, beneficiaries: [
        { id: "hotel-b", name: "KHACH SAN ANH DUONG", bank: "bidv", account: "00123456", version: 1, verifiedVersion: null },
      ] } },
      { projectId: projectC.id, data: { ...base, beneficiaries: [
        { id: "second-account", name: "Khách sạn Ánh Dương", bank: "VCB", account: "77889900", version: 1, verifiedVersion: null },
        { id: "invalid", name: "", bank: "", account: "", version: 1, verifiedVersion: null },
      ] } },
    ] });
    const before = await client.costFlowWorkspace.findMany({ orderBy: { projectId: "asc" }, select: { projectId: true, data: true } });

    const first = await migrateLegacySuppliers(client);
    const second = await migrateLegacySuppliers(client);

    assert.deepEqual(first, { scanned: 5, migrated: 4, existingAliases: 0, unresolved: 1, conflicts: 1 });
    assert.deepEqual(second, { scanned: 5, migrated: 0, existingAliases: 4, unresolved: 1, conflicts: 1 });
    assert.equal(await client.supplier.count(), 3, "exact name + account dedupes across projects but differing accounts do not merge");
    assert.equal(await client.supplierBankAccount.count(), 3);
    assert.equal(await client.legacySupplierAlias.count(), 4);
    assert.equal(await client.supplierVerification.count(), 0, "legacy verified flags are not promoted to trusted accountant verification");
    const aliases = await client.legacySupplierAlias.findMany({ orderBy: [{ projectId: "asc" }, { legacyBeneficiaryId: "asc" }] });
    assert.ok(aliases.every(alias => alias.legacyRecipientKey === `VENDOR:${alias.legacyBeneficiaryId}`));
    assert.equal(aliases.find(alias => alias.legacyBeneficiaryId === "same-name-other-account")?.sourceProofId, "missing-proof-is-allowed");
    assert.deepEqual(await client.costFlowWorkspace.findMany({ orderBy: { projectId: "asc" }, select: { projectId: true, data: true } }), before);
  } finally {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
});
