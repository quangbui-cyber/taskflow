CREATE TABLE "WorkflowPublicVerificationCapability" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "publicNonce" TEXT NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "attestationKeyId" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "replacedAt" TIMESTAMP(3),
  "replacedBySnapshotId" TEXT,
  CONSTRAINT "WorkflowPublicVerificationCapability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowPublicVerificationRateLimit" (
  "key" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowPublicVerificationRateLimit_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "WorkflowPublicVerificationCapability_snapshotId_key" ON "WorkflowPublicVerificationCapability"("snapshotId");
CREATE UNIQUE INDEX "WorkflowPublicVerificationCapability_publicNonce_key" ON "WorkflowPublicVerificationCapability"("publicNonce");
CREATE UNIQUE INDEX "WorkflowPublicVerificationCapability_tokenDigest_key" ON "WorkflowPublicVerificationCapability"("tokenDigest");
CREATE INDEX "WorkflowPublicVerificationCapability_revokedAt_replacedAt_idx" ON "WorkflowPublicVerificationCapability"("revokedAt", "replacedAt");
CREATE INDEX "WorkflowPublicVerificationCapability_attestationKeyId_idx" ON "WorkflowPublicVerificationCapability"("attestationKeyId");
CREATE INDEX "WorkflowPublicVerificationRateLimit_updatedAt_idx" ON "WorkflowPublicVerificationRateLimit"("updatedAt");

ALTER TABLE "WorkflowPublicVerificationCapability"
  ADD CONSTRAINT "WorkflowPublicVerificationCapability_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "WorkflowApprovedSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
