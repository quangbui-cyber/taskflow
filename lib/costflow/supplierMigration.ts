import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  maskedAccountLast4,
  normalizeAccountNumber,
  normalizeBankName,
  normalizeSupplierName,
  normalizeSupplierTaxCode,
  supplierAccountFingerprint,
  supplierDedupeKey,
} from "./suppliers";

type LegacyBeneficiary = {
  id?: unknown;
  name?: unknown;
  bank?: unknown;
  account?: unknown;
  taxCode?: unknown;
  version?: unknown;
  verifiedVersion?: unknown;
  proofId?: unknown;
};

type InventoryRow = {
  projectId: string;
  actorId: string;
  beneficiary: LegacyBeneficiary;
  id: string;
  name: string;
  bank: string;
  account: string;
  taxCode: string | null;
  dedupeKey: string;
  normalizedName: string;
  fingerprint: string;
};

export type SupplierMigrationReport = {
  scanned: number;
  migrated: number;
  existingAliases: number;
  unresolved: number;
  conflicts: number;
};

function beneficiaries(value: Prisma.JsonValue): LegacyBeneficiary[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rows = (value as Record<string, unknown>).beneficiaries;
  return Array.isArray(rows) ? rows.filter((row): row is LegacyBeneficiary => !!row && typeof row === "object" && !Array.isArray(row)) : [];
}

function inventoryRow(projectId: string, actorId: string, beneficiary: LegacyBeneficiary): InventoryRow | null {
  const id = String(beneficiary.id ?? "").trim();
  const name = String(beneficiary.name ?? "").trim();
  const bank = String(beneficiary.bank ?? "").trim();
  const account = String(beneficiary.account ?? "").trim();
  const taxCode = normalizeSupplierTaxCode(typeof beneficiary.taxCode === "string" ? beneficiary.taxCode : null);
  const normalizedName = normalizeSupplierName(name);
  if (!id || !normalizedName || !normalizeBankName(bank) || !normalizeAccountNumber(account)) return null;
  return {
    projectId,
    actorId,
    beneficiary,
    id,
    name,
    bank,
    account,
    taxCode,
    normalizedName,
    fingerprint: supplierAccountFingerprint(bank, account),
    dedupeKey: supplierDedupeKey({ name, taxCode, bank, account }),
  };
}

function conflictCount(rows: InventoryRow[]) {
  const byName = new Map<string, Set<string>>();
  for (const row of rows.filter(candidate => !candidate.taxCode)) {
    const keys = byName.get(row.normalizedName) ?? new Set<string>();
    keys.add(row.dedupeKey);
    byName.set(row.normalizedName, keys);
  }
  return [...byName.values()].filter(keys => keys.size > 1).length;
}

export async function migrateLegacySuppliers(client: PrismaClient): Promise<SupplierMigrationReport> {
  return client.$transaction(async tx => {
    const workspaces = await tx.costFlowWorkspace.findMany({
      orderBy: { projectId: "asc" },
      select: { projectId: true, data: true, project: { select: { ownerId: true } } },
    });
    const parsed = workspaces.flatMap(workspace => beneficiaries(workspace.data).map(beneficiary => ({ workspace, beneficiary })));
    const rows = parsed
      .map(({ workspace, beneficiary }) => inventoryRow(workspace.projectId, workspace.project.ownerId, beneficiary))
      .filter((row): row is InventoryRow => row !== null);
    const report: SupplierMigrationReport = {
      scanned: parsed.length,
      migrated: 0,
      existingAliases: 0,
      unresolved: parsed.length - rows.length,
      conflicts: conflictCount(rows),
    };

    const existingAliases = await tx.legacySupplierAlias.findMany({
      where: { OR: rows.map(row => ({ projectId: row.projectId, legacyBeneficiaryId: row.id })) },
      select: { projectId: true, legacyBeneficiaryId: true },
    });
    const existingAliasKeys = new Set(existingAliases.map(alias => `${alias.projectId}\u0000${alias.legacyBeneficiaryId}`));

    for (const row of rows) {
      const aliasKey = `${row.projectId}\u0000${row.id}`;
      if (existingAliasKeys.has(aliasKey)) {
        report.existingAliases += 1;
        continue;
      }

      let supplier = await tx.supplier.findFirst({
        where: row.taxCode ? { taxCodeKey: row.taxCode } : { dedupeKey: row.dedupeKey, status: "ACTIVE" },
        include: {
          versions: { orderBy: { version: "desc" }, take: 1 },
          bankAccounts: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
        },
      });
      if (!supplier) {
        const supplierId = randomUUID();
        const supplierVersionId = randomUUID();
        const bankAccountId = randomUUID();
        await tx.supplier.create({
          data: {
            id: supplierId,
            taxCodeKey: row.taxCode,
            dedupeKey: row.dedupeKey,
          },
        });
        await tx.supplierVersion.create({
          data: {
            id: supplierVersionId,
            supplierId,
            version: 1,
            legalName: row.name,
            normalizedName: row.normalizedName,
            taxCode: row.taxCode,
            normalizedTaxCode: row.taxCode,
            changeReason: "Legacy project beneficiary backfill",
            createdById: row.actorId,
          },
        });
        await tx.supplierBankAccount.create({ data: { id: bankAccountId, supplierId, isPrimary: true } });
        await tx.supplierBankAccountVersion.create({
          data: {
            supplierId,
            bankAccountId,
            version: 1,
            bankName: row.bank,
            accountHolder: row.name,
            accountNumber: normalizeAccountNumber(row.account),
            accountLast4: maskedAccountLast4(row.account),
            accountFingerprint: row.fingerprint,
            changeReason: "Legacy project beneficiary backfill",
            createdById: row.actorId,
          },
        });
        supplier = await tx.supplier.findUniqueOrThrow({
          where: { id: supplierId },
          include: {
            versions: { orderBy: { version: "desc" }, take: 1 },
            bankAccounts: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
          },
        });
      }
      const supplierVersion = supplier.versions[0];
      let bankAccount = supplier.bankAccounts.find(account => account.versions[0]?.accountFingerprint === row.fingerprint);
      if (!bankAccount) {
        const bankAccountId = randomUUID();
        await tx.supplierBankAccount.create({
          data: { id: bankAccountId, supplierId: supplier.id, isPrimary: supplier.bankAccounts.length === 0 },
        });
        await tx.supplierBankAccountVersion.create({
          data: {
            supplierId: supplier.id,
            bankAccountId,
            version: 1,
            bankName: row.bank,
            accountHolder: row.name,
            accountNumber: normalizeAccountNumber(row.account),
            accountLast4: maskedAccountLast4(row.account),
            accountFingerprint: row.fingerprint,
            changeReason: "Legacy project beneficiary backfill",
            createdById: row.actorId,
          },
        });
        bankAccount = await tx.supplierBankAccount.findUniqueOrThrow({
          where: { id: bankAccountId },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        });
      }
      const bankVersion = bankAccount.versions[0];
      if (!supplierVersion || !bankVersion) throw new Error("Supplier backfill failed to create immutable versions.");
      await tx.legacySupplierAlias.create({
        data: {
          projectId: row.projectId,
          legacyBeneficiaryId: row.id,
          legacyRecipientKey: `VENDOR:${row.id}`,
          supplierId: supplier.id,
          supplierVersionId: supplierVersion.id,
          bankAccountId: bankAccount.id,
          bankAccountVersionId: bankVersion.id,
          sourceProofId: typeof row.beneficiary.proofId === "string" && row.beneficiary.proofId ? row.beneficiary.proofId : null,
          sourceSnapshot: JSON.parse(JSON.stringify(row.beneficiary)) as Prisma.InputJsonValue,
        },
      });
      report.migrated += 1;
    }
    return report;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
