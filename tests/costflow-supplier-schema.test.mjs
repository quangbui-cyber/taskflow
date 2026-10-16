import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  path.join(root, "prisma/migrations/20261016090000_phase14_supplier_master/migration.sql"),
  "utf8",
);

function modelBlock(name) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `missing model ${name}`);
  return match[0];
}

test("supplier master keeps stable roots and immutable versions", () => {
  for (const model of [
    "Supplier",
    "SupplierVersion",
    "SupplierBankAccount",
    "SupplierBankAccountVersion",
    "SupplierEvidence",
    "SupplierVerification",
    "LegacySupplierAlias",
  ]) assert.match(schema, new RegExp(`model ${model}\\s*\\{`));

  assert.match(modelBlock("SupplierVersion"), /@@unique\(\[supplierId, version\]\)/);
  assert.match(modelBlock("SupplierBankAccountVersion"), /@@unique\(\[bankAccountId, version\]\)/);
  assert.match(modelBlock("SupplierVerification"), /supplierVersionId\s+String/);
  assert.match(modelBlock("SupplierVerification"), /bankAccountVersionId\s+String/);
  assert.match(modelBlock("SupplierVerification"), /evidenceId\s+String\?/);
  assert.match(modelBlock("LegacySupplierAlias"), /@@unique\(\[projectId, legacyBeneficiaryId\]\)/);
});

test("supplier migration enforces primary account and audit-safe relations", () => {
  assert.match(migration, /SupplierBankAccount_one_primary_active_per_supplier/);
  assert.match(migration, /CREATE UNIQUE INDEX "LegacySupplierAlias_projectId_legacyBeneficiaryId_key"/);
  assert.match(migration, /SupplierVerification_supplierVersionId_supplierId_fkey[\s\S]*?ON DELETE RESTRICT/);
  assert.match(migration, /SupplierVerification_bankAccountVersionId_bankAccountId_supplierId_fkey[\s\S]*?ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/);
});

test("ordinary payment snapshots remain independent from mutable supplier rows", () => {
  const snapshot = modelBlock("PaymentRecipientSnapshot");
  assert.match(snapshot, /displayName\s+String/);
  assert.match(snapshot, /accountLast4\s+String\?/);
  assert.match(snapshot, /sourceVersion\s+Int\?/);
  assert.doesNotMatch(snapshot, /supplier\s+Supplier/);
});
