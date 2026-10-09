CREATE TABLE "ActualCostLine" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "stableLineId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL DEFAULT 'IC_LINKED',
  "icRevisionId" TEXT,
  "icLineId" TEXT,
  "recipientKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualCostLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActualCostVersion" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "description" TEXT NOT NULL,
  "fundingSource" TEXT NOT NULL,
  "quantity" TEXT NOT NULL,
  "days" TEXT NOT NULL,
  "unitPrice" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT '',
  "basis" TEXT NOT NULL DEFAULT 'GROSS',
  "vatPercent" TEXT NOT NULL DEFAULT '0',
  "amount" TEXT NOT NULL,
  "rawAmount" TEXT NOT NULL,
  "sourceSnapshot" JSONB,
  "billable" BOOLEAN NOT NULL DEFAULT false,
  "saleSnapshot" JSONB,
  "createdById" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualCostVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActualCostApproval" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "retryKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "warningCodes" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualCostApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActualCostEvidenceLink" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualCostEvidenceLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActualCostApplication" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "ActualCostApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerLiquidation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL,
  "netAmount" TEXT NOT NULL,
  "vatAmount" TEXT NOT NULL,
  "grossAmount" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerLiquidation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerCashIn" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "liquidationId" TEXT,
  "milestone" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "amount" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "evidenceId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "commandFingerprint" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerCashIn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerAcceptanceSnapshot" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "quotationId" TEXT NOT NULL,
  "liquidationId" TEXT,
  "projection" JSONB NOT NULL,
  "selectedActualCostVersionIds" JSONB NOT NULL DEFAULT '[]',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerAcceptanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerAcceptanceExport" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "projectionHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerAcceptanceExport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowRoleGrant_one_active_ac_dd_key"
  ON "WorkflowRoleGrant" ("role")
  WHERE "role" = 'AC_DD' AND "revokedAt" IS NULL;

CREATE UNIQUE INDEX "ActualCostLine_projectId_stableLineId_key" ON "ActualCostLine"("projectId", "stableLineId");
CREATE INDEX "ActualCostLine_projectId_icRevisionId_icLineId_idx" ON "ActualCostLine"("projectId", "icRevisionId", "icLineId");
CREATE INDEX "ActualCostLine_projectId_recipientKey_idx" ON "ActualCostLine"("projectId", "recipientKey");
CREATE UNIQUE INDEX "ActualCostVersion_lineId_version_key" ON "ActualCostVersion"("lineId", "version");
CREATE INDEX "ActualCostVersion_projectId_state_createdAt_idx" ON "ActualCostVersion"("projectId", "state", "createdAt");
CREATE INDEX "ActualCostVersion_projectId_fundingSource_idx" ON "ActualCostVersion"("projectId", "fundingSource");
CREATE UNIQUE INDEX "ActualCostApproval_versionId_key" ON "ActualCostApproval"("versionId");
CREATE UNIQUE INDEX "ActualCostApproval_projectId_retryKey_key" ON "ActualCostApproval"("projectId", "retryKey");
CREATE INDEX "ActualCostApproval_projectId_action_createdAt_idx" ON "ActualCostApproval"("projectId", "action", "createdAt");
CREATE INDEX "ActualCostApproval_actorId_createdAt_idx" ON "ActualCostApproval"("actorId", "createdAt");
CREATE UNIQUE INDEX "ActualCostEvidenceLink_versionId_evidenceId_kind_key" ON "ActualCostEvidenceLink"("versionId", "evidenceId", "kind");
CREATE INDEX "ActualCostEvidenceLink_projectId_versionId_idx" ON "ActualCostEvidenceLink"("projectId", "versionId");
CREATE INDEX "ActualCostEvidenceLink_evidenceId_idx" ON "ActualCostEvidenceLink"("evidenceId");
CREATE UNIQUE INDEX "ActualCostApplication_versionId_requestId_key" ON "ActualCostApplication"("versionId", "requestId");
CREATE INDEX "ActualCostApplication_projectId_recipientKey_state_idx" ON "ActualCostApplication"("projectId", "recipientKey", "state");
CREATE INDEX "ActualCostApplication_requestId_state_idx" ON "ActualCostApplication"("requestId", "state");
CREATE UNIQUE INDEX "CustomerLiquidation_projectId_version_key" ON "CustomerLiquidation"("projectId", "version");
CREATE INDEX "CustomerLiquidation_projectId_signedAt_idx" ON "CustomerLiquidation"("projectId", "signedAt");
CREATE UNIQUE INDEX "CustomerCashIn_projectId_idempotencyKey_key" ON "CustomerCashIn"("projectId", "idempotencyKey");
CREATE UNIQUE INDEX "CustomerCashIn_projectId_reference_key" ON "CustomerCashIn"("projectId", "reference");
CREATE INDEX "CustomerCashIn_projectId_occurredAt_idx" ON "CustomerCashIn"("projectId", "occurredAt");
CREATE UNIQUE INDEX "CustomerAcceptanceSnapshot_projectId_version_key" ON "CustomerAcceptanceSnapshot"("projectId", "version");
CREATE INDEX "CustomerAcceptanceSnapshot_projectId_quotationId_idx" ON "CustomerAcceptanceSnapshot"("projectId", "quotationId");
CREATE UNIQUE INDEX "CustomerAcceptanceExport_snapshotId_format_key" ON "CustomerAcceptanceExport"("snapshotId", "format");
CREATE INDEX "CustomerAcceptanceExport_createdAt_idx" ON "CustomerAcceptanceExport"("createdAt");

ALTER TABLE "ActualCostLine" ADD CONSTRAINT "ActualCostLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostLine" ADD CONSTRAINT "ActualCostLine_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostVersion" ADD CONSTRAINT "ActualCostVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostVersion" ADD CONSTRAINT "ActualCostVersion_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ActualCostLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostVersion" ADD CONSTRAINT "ActualCostVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostApproval" ADD CONSTRAINT "ActualCostApproval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostApproval" ADD CONSTRAINT "ActualCostApproval_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ActualCostLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostApproval" ADD CONSTRAINT "ActualCostApproval_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ActualCostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostApproval" ADD CONSTRAINT "ActualCostApproval_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostEvidenceLink" ADD CONSTRAINT "ActualCostEvidenceLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostEvidenceLink" ADD CONSTRAINT "ActualCostEvidenceLink_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ActualCostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostEvidenceLink" ADD CONSTRAINT "ActualCostEvidenceLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "CostFlowEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostApplication" ADD CONSTRAINT "ActualCostApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostApplication" ADD CONSTRAINT "ActualCostApplication_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ActualCostLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostApplication" ADD CONSTRAINT "ActualCostApplication_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ActualCostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostApplication" ADD CONSTRAINT "ActualCostApplication_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ActualCostApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostApplication" ADD CONSTRAINT "ActualCostApplication_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerLiquidation" ADD CONSTRAINT "CustomerLiquidation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerLiquidation" ADD CONSTRAINT "CustomerLiquidation_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "CostFlowEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerLiquidation" ADD CONSTRAINT "CustomerLiquidation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerCashIn" ADD CONSTRAINT "CustomerCashIn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerCashIn" ADD CONSTRAINT "CustomerCashIn_liquidationId_fkey" FOREIGN KEY ("liquidationId") REFERENCES "CustomerLiquidation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerCashIn" ADD CONSTRAINT "CustomerCashIn_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "CostFlowEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerCashIn" ADD CONSTRAINT "CustomerCashIn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAcceptanceSnapshot" ADD CONSTRAINT "CustomerAcceptanceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAcceptanceSnapshot" ADD CONSTRAINT "CustomerAcceptanceSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAcceptanceExport" ADD CONSTRAINT "CustomerAcceptanceExport_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "CustomerAcceptanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerAcceptanceExport" ADD CONSTRAINT "CustomerAcceptanceExport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
