CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "taxCodeKey" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Supplier_current_version_check" CHECK ("currentVersion" >= 1)
);

CREATE TABLE "SupplierVersion" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "legalName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "taxCode" TEXT,
  "normalizedTaxCode" TEXT,
  "address" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "contactEmail" TEXT NOT NULL DEFAULT '',
  "contactPhone" TEXT NOT NULL DEFAULT '',
  "changeReason" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierVersion_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "SupplierBankAccount" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "SupplierBankAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierBankAccount_current_version_check" CHECK ("currentVersion" >= 1)
);

CREATE TABLE "SupplierBankAccountVersion" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "bankName" TEXT NOT NULL,
  "bankCode" TEXT NOT NULL DEFAULT '',
  "accountHolder" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "accountLast4" TEXT NOT NULL,
  "accountFingerprint" TEXT NOT NULL,
  "changeReason" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierBankAccountVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierBankAccountVersion_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "SupplierEvidence" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'BANK_ACCOUNT_PROOF',
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierEvidence_byte_length_check" CHECK ("byteLength" > 0)
);

CREATE TABLE "SupplierVerification" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierVersionId" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "bankAccountVersionId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "evidenceId" TEXT,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierVerification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierVerification_decision_check" CHECK ("decision" IN ('VERIFIED', 'REJECTED'))
);

CREATE TABLE "LegacySupplierAlias" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "legacyBeneficiaryId" TEXT NOT NULL,
  "legacyRecipientKey" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierVersionId" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "bankAccountVersionId" TEXT NOT NULL,
  "sourceProofId" TEXT,
  "sourceSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacySupplierAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Supplier_taxCodeKey_key" ON "Supplier"("taxCodeKey");
CREATE INDEX "Supplier_status_dedupeKey_idx" ON "Supplier"("status", "dedupeKey");
CREATE UNIQUE INDEX "SupplierVersion_supplierId_version_key" ON "SupplierVersion"("supplierId", "version");
CREATE UNIQUE INDEX "SupplierVersion_id_supplierId_key" ON "SupplierVersion"("id", "supplierId");
CREATE INDEX "SupplierVersion_normalizedName_idx" ON "SupplierVersion"("normalizedName");
CREATE INDEX "SupplierVersion_normalizedTaxCode_idx" ON "SupplierVersion"("normalizedTaxCode");
CREATE INDEX "SupplierVersion_createdById_createdAt_idx" ON "SupplierVersion"("createdById", "createdAt");
CREATE UNIQUE INDEX "SupplierBankAccount_id_supplierId_key" ON "SupplierBankAccount"("id", "supplierId");
CREATE INDEX "SupplierBankAccount_supplierId_status_idx" ON "SupplierBankAccount"("supplierId", "status");
CREATE UNIQUE INDEX "SupplierBankAccount_one_primary_active_per_supplier" ON "SupplierBankAccount"("supplierId") WHERE "isPrimary" = true AND "status" = 'ACTIVE';
CREATE UNIQUE INDEX "SupplierBankAccountVersion_bankAccountId_version_key" ON "SupplierBankAccountVersion"("bankAccountId", "version");
CREATE UNIQUE INDEX "SupplierBankAccountVersion_id_bankAccountId_supplierId_key" ON "SupplierBankAccountVersion"("id", "bankAccountId", "supplierId");
CREATE INDEX "SupplierBankAccountVersion_supplierId_accountFingerprint_idx" ON "SupplierBankAccountVersion"("supplierId", "accountFingerprint");
CREATE INDEX "SupplierBankAccountVersion_createdById_createdAt_idx" ON "SupplierBankAccountVersion"("createdById", "createdAt");
CREATE INDEX "SupplierEvidence_supplierId_createdAt_idx" ON "SupplierEvidence"("supplierId", "createdAt");
CREATE INDEX "SupplierEvidence_sha256_idx" ON "SupplierEvidence"("sha256");
CREATE INDEX "SupplierVerification_supplierId_supplierVersionId_bankAccountVersionId_createdAt_idx" ON "SupplierVerification"("supplierId", "supplierVersionId", "bankAccountVersionId", "createdAt");
CREATE INDEX "SupplierVerification_actorId_createdAt_idx" ON "SupplierVerification"("actorId", "createdAt");
CREATE INDEX "SupplierVerification_evidenceId_idx" ON "SupplierVerification"("evidenceId");
CREATE UNIQUE INDEX "LegacySupplierAlias_projectId_legacyBeneficiaryId_key" ON "LegacySupplierAlias"("projectId", "legacyBeneficiaryId");
CREATE UNIQUE INDEX "LegacySupplierAlias_projectId_legacyRecipientKey_key" ON "LegacySupplierAlias"("projectId", "legacyRecipientKey");
CREATE INDEX "LegacySupplierAlias_supplierId_projectId_idx" ON "LegacySupplierAlias"("supplierId", "projectId");
CREATE INDEX "LegacySupplierAlias_bankAccountId_idx" ON "LegacySupplierAlias"("bankAccountId");

ALTER TABLE "SupplierVersion" ADD CONSTRAINT "SupplierVersion_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierVersion" ADD CONSTRAINT "SupplierVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierBankAccountVersion" ADD CONSTRAINT "SupplierBankAccountVersion_bankAccountId_supplierId_fkey" FOREIGN KEY ("bankAccountId", "supplierId") REFERENCES "SupplierBankAccount"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierBankAccountVersion" ADD CONSTRAINT "SupplierBankAccountVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierEvidence" ADD CONSTRAINT "SupplierEvidence_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierEvidence" ADD CONSTRAINT "SupplierEvidence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierVerification" ADD CONSTRAINT "SupplierVerification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierVerification" ADD CONSTRAINT "SupplierVerification_supplierVersionId_supplierId_fkey" FOREIGN KEY ("supplierVersionId", "supplierId") REFERENCES "SupplierVersion"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierVerification" ADD CONSTRAINT "SupplierVerification_bankAccountId_supplierId_fkey" FOREIGN KEY ("bankAccountId", "supplierId") REFERENCES "SupplierBankAccount"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierVerification" ADD CONSTRAINT "SupplierVerification_bankAccountVersionId_bankAccountId_supplierId_fkey" FOREIGN KEY ("bankAccountVersionId", "bankAccountId", "supplierId") REFERENCES "SupplierBankAccountVersion"("id", "bankAccountId", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierVerification" ADD CONSTRAINT "SupplierVerification_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "SupplierEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierVerification" ADD CONSTRAINT "SupplierVerification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacySupplierAlias" ADD CONSTRAINT "LegacySupplierAlias_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacySupplierAlias" ADD CONSTRAINT "LegacySupplierAlias_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacySupplierAlias" ADD CONSTRAINT "LegacySupplierAlias_supplierVersionId_supplierId_fkey" FOREIGN KEY ("supplierVersionId", "supplierId") REFERENCES "SupplierVersion"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacySupplierAlias" ADD CONSTRAINT "LegacySupplierAlias_bankAccountId_supplierId_fkey" FOREIGN KEY ("bankAccountId", "supplierId") REFERENCES "SupplierBankAccount"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacySupplierAlias" ADD CONSTRAINT "LegacySupplierAlias_bankAccountVersionId_bankAccountId_supplierId_fkey" FOREIGN KEY ("bankAccountVersionId", "bankAccountId", "supplierId") REFERENCES "SupplierBankAccountVersion"("id", "bankAccountId", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
