import type { Prisma } from "@prisma/client";

export type SupplierVerificationStatus = "UNVERIFIED" | "VERIFIED" | "REJECTED";

export function supplierRecipientKey(supplierId: string, bankAccountId: string) {
  return `SUPPLIER:${supplierId}:${bankAccountId}`;
}

export function parseSupplierRecipientKey(value: string) {
  const match = /^SUPPLIER:([^:]+):([^:]+)$/.exec(value);
  return match ? { supplierId: match[1], bankAccountId: match[2] } : null;
}

export async function resolveSupplierId(client: SupplierReadClient, projectId: string, supplierOrLegacyId: string) {
  const current = await client.supplier.findFirst({ where: { id: supplierOrLegacyId, status: "ACTIVE" }, select: { id: true } });
  if (current) return current.id;
  const alias = await client.legacySupplierAlias.findUnique({ where: { projectId_legacyBeneficiaryId: { projectId, legacyBeneficiaryId: supplierOrLegacyId } }, select: { supplierId: true } });
  return alias?.supplierId ?? null;
}

type SupplierReadClient = Pick<Prisma.TransactionClient, "supplier" | "legacySupplierAlias">;

export async function resolveSupplierRecipient(client: SupplierReadClient, projectId: string, recipientKey: string) {
  const normalized = parseSupplierRecipientKey(recipientKey);
  const alias = normalized ? null : recipientKey.startsWith("VENDOR:") ? await client.legacySupplierAlias.findUnique({
    where: { projectId_legacyRecipientKey: { projectId, legacyRecipientKey: recipientKey } },
    select: { supplierId: true, bankAccountId: true, supplierVersionId: true, bankAccountVersionId: true },
  }) : null;
  if (!normalized && !alias) return null;
  const supplierId = normalized?.supplierId ?? alias!.supplierId;
  const bankAccountId = normalized?.bankAccountId ?? alias!.bankAccountId;
  const supplier = await client.supplier.findFirst({
    where: { id: supplierId, status: "ACTIVE", bankAccounts: { some: { id: bankAccountId, status: "ACTIVE" } } },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
      bankAccounts: { where: { id: bankAccountId, status: "ACTIVE" }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
      verifications: { where: { bankAccountId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, supplierVersionId: true, bankAccountVersionId: true, decision: true, reason: true, evidenceId: true, actorId: true, createdAt: true } },
    },
  });
  const supplierVersion = supplier?.versions[0];
  const bank = supplier?.bankAccounts[0];
  const bankVersion = bank?.versions[0];
  if (!supplier || !supplierVersion || !bank || !bankVersion) return null;
  const latestVerification = supplier.verifications.find(item => item.supplierVersionId === supplierVersion.id && item.bankAccountVersionId === bankVersion.id) ?? null;
  const verificationStatus: SupplierVerificationStatus = latestVerification?.decision === "VERIFIED" ? "VERIFIED" : latestVerification?.decision === "REJECTED" ? "REJECTED" : "UNVERIFIED";
  return {
    recipientKey: supplierRecipientKey(supplier.id, bank.id),
    requestedRecipientKey: recipientKey,
    legacyAlias: alias ? recipientKey : null,
    supplierId: supplier.id,
    bankAccountId: bank.id,
    displayName: supplierVersion.legalName,
    taxCode: supplierVersion.taxCode,
    bankName: bankVersion.bankName,
    bankCode: bankVersion.bankCode,
    accountHolder: bankVersion.accountHolder,
    accountNumber: bankVersion.accountNumber,
    accountLast4: bankVersion.accountLast4,
    accountFingerprint: bankVersion.accountFingerprint,
    frozenSupplierVersionId: supplierVersion.id,
    frozenSupplierVersion: supplierVersion.version,
    frozenBankVersionId: bankVersion.id,
    frozenBankVersion: bankVersion.version,
    verificationStatus,
    latestVerification,
    bankLookupStatus: "PENDING_INTEGRATION" as const,
  };
}

type SupplierDirectoryClient = Pick<Prisma.TransactionClient, "supplier">;

export async function listCompanySuppliers(client: SupplierDirectoryClient) {
  const suppliers = await client.supplier.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: {
      versions: { orderBy: { version: "desc" } },
      bankAccounts: { where: { status: "ACTIVE" }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], include: { versions: { orderBy: { version: "desc" } } } },
      verifications: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, supplierVersionId: true, bankAccountVersionId: true, decision: true, reason: true, evidenceId: true, actorId: true, createdAt: true } },
    },
  });
  return suppliers.flatMap(supplier => {
    const version = supplier.versions[0];
    if (!version) return [];
    return [{
      id: supplier.id,
      status: supplier.status,
      version: { id: version.id, version: version.version, legalName: version.legalName, normalizedName: version.normalizedName, taxCode: version.taxCode, address: version.address, contactName: version.contactName, contactEmail: version.contactEmail, contactPhone: version.contactPhone, changeReason: version.changeReason, createdAt: version.createdAt.toISOString() },
      versionHistory: supplier.versions.map(item => ({ id: item.id, version: item.version, legalName: item.legalName, taxCode: item.taxCode, changeReason: item.changeReason, createdAt: item.createdAt.toISOString() })),
      accounts: supplier.bankAccounts.flatMap(account => {
        const bank = account.versions[0];
        if (!bank) return [];
        const verification = supplier.verifications.find(item => item.supplierVersionId === version.id && item.bankAccountVersionId === bank.id);
        return [{ id: account.id, isPrimary: account.isPrimary, version: bank.version, bankVersionId: bank.id, bankName: bank.bankName, bankCode: bank.bankCode, accountHolder: bank.accountHolder, accountLast4: bank.accountLast4, verificationStatus: verification?.decision === "VERIFIED" ? "VERIFIED" as const : verification?.decision === "REJECTED" ? "REJECTED" as const : "UNVERIFIED" as const, verificationReason: verification?.reason ?? "", recipientKey: supplierRecipientKey(supplier.id, account.id), versionHistory: account.versions.map(item => ({ id: item.id, version: item.version, bankName: item.bankName, accountHolder: item.accountHolder, accountLast4: item.accountLast4, changeReason: item.changeReason, createdAt: item.createdAt.toISOString() })) }];
      }),
      bankLookupStatus: "PENDING_INTEGRATION" as const,
    }];
  });
}

export type CompanySupplier = Awaited<ReturnType<typeof listCompanySuppliers>>[number];

