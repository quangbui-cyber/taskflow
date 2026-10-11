-- Phase 10 CF-06: append-only settlement dossier, lock, close and export audit.
-- This migration intentionally does not update producer lifecycle columns.

CREATE TABLE "ProjectSettlementDossier" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectSettlementDossier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectSettlementVersion" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dossierId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "attemptId" TEXT NOT NULL,
  "canonicalHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "supersedesId" TEXT,
  "replacementReason" TEXT,
  "replacementActorId" TEXT,
  "replacedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectSettlementVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectSettlementVersion_version_check" CHECK ("version" > 0),
  CONSTRAINT "ProjectSettlementVersion_replacement_check" CHECK (
    ("supersedesId" IS NULL AND "replacementReason" IS NULL AND "replacementActorId" IS NULL AND "replacedAt" IS NULL)
    OR
    ("supersedesId" IS NOT NULL AND length(btrim("replacementReason")) > 0 AND "replacementActorId" IS NOT NULL AND "replacedAt" IS NOT NULL)
  )
);

CREATE TABLE "SettlementRecipientObligation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dossierVersionId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "recipientType" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "approvedAcGross" TEXT NOT NULL,
  "disbursedAdvance" TEXT NOT NULL,
  "amountDue" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementRecipientObligation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementRecipientObligation_direction_check" CHECK ("direction" IN ('IN','OUT','BALANCED')),
  CONSTRAINT "SettlementRecipientObligation_amount_check" CHECK (
    "approvedAcGross" ~ '^\\d+$' AND "disbursedAdvance" ~ '^\\d+$' AND "amountDue" ~ '^\\d+$'
  )
);

CREATE TABLE "SettlementCashAllocation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "obligationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "cashId" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementCashAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementCashAllocation_amount_check" CHECK ("amount" ~ '^[1-9]\\d*$')
);

CREATE TABLE "SettlementLock" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dossierVersionId" TEXT NOT NULL,
  "obligationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "actualCostApplicationId" TEXT,
  "advanceApplicationId" TEXT,
  "sourceCashAllocationId" TEXT,
  "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementLock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementLock_source_xor_check" CHECK (
    ("actualCostApplicationId" IS NOT NULL)::integer + ("advanceApplicationId" IS NOT NULL)::integer = 1
  ),
  CONSTRAINT "SettlementLock_advance_cash_check" CHECK (
    ("advanceApplicationId" IS NULL AND "sourceCashAllocationId" IS NULL)
    OR ("advanceApplicationId" IS NOT NULL AND "sourceCashAllocationId" IS NOT NULL)
  )
);

CREATE TABLE "SettlementEvidence" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dossierVersionId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "addedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementEvidence_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "FinancialCloseRequest" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dossierId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialCloseRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCloseRequest_action_check" CHECK ("action" IN ('CLOSE','REOPEN')),
  CONSTRAINT "FinancialCloseRequest_reason_check" CHECK (length(btrim("reason")) > 0)
);

CREATE TABLE "FinancialCloseEvent" (
  "id" TEXT NOT NULL,
  "closeRequestId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "eventHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialCloseEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCloseEvent_decision_check" CHECK ("decision" IN ('APPROVED','RETURNED','REJECTED')),
  CONSTRAINT "FinancialCloseEvent_hash_check" CHECK ("eventHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "SettlementExportAudit" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dossierVersionId" TEXT NOT NULL,
  "family" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "canonicalHash" TEXT NOT NULL,
  "approvedSnapshotId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementExportAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementExportAudit_format_check" CHECK ("format" IN ('PDF','XLSX')),
  CONSTRAINT "SettlementExportAudit_hash_check" CHECK ("canonicalHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "ProjectSettlementDossier_projectId_key" ON "ProjectSettlementDossier"("projectId");
CREATE UNIQUE INDEX "ProjectSettlementDossier_id_projectId_key" ON "ProjectSettlementDossier"("id", "projectId");
CREATE INDEX "ProjectSettlementDossier_createdById_createdAt_idx" ON "ProjectSettlementDossier"("createdById", "createdAt");

CREATE UNIQUE INDEX "ProjectSettlementVersion_supersedesId_key" ON "ProjectSettlementVersion"("supersedesId");
CREATE UNIQUE INDEX "ProjectSettlementVersion_dossierId_version_key" ON "ProjectSettlementVersion"("dossierId", "version");
CREATE UNIQUE INDEX "ProjectSettlementVersion_projectId_attemptId_key" ON "ProjectSettlementVersion"("projectId", "attemptId");
CREATE UNIQUE INDEX "ProjectSettlementVersion_id_projectId_key" ON "ProjectSettlementVersion"("id", "projectId");
CREATE INDEX "ProjectSettlementVersion_projectId_createdAt_idx" ON "ProjectSettlementVersion"("projectId", "createdAt");
CREATE INDEX "ProjectSettlementVersion_requestId_idx" ON "ProjectSettlementVersion"("requestId");
CREATE INDEX "ProjectSettlementVersion_replacementActorId_replacedAt_idx" ON "ProjectSettlementVersion"("replacementActorId", "replacedAt");

CREATE UNIQUE INDEX "SettlementRecipientObligation_dossierVersionId_recipientKey_key" ON "SettlementRecipientObligation"("dossierVersionId", "recipientKey");
CREATE UNIQUE INDEX "SettlementRecipientObligation_id_projectId_recipientKey_key" ON "SettlementRecipientObligation"("id", "projectId", "recipientKey");
CREATE INDEX "SettlementRecipientObligation_projectId_recipientKey_idx" ON "SettlementRecipientObligation"("projectId", "recipientKey");

CREATE UNIQUE INDEX "SettlementCashAllocation_projectId_idempotencyKey_key" ON "SettlementCashAllocation"("projectId", "idempotencyKey");
CREATE UNIQUE INDEX "SettlementCashAllocation_cashId_obligationId_key" ON "SettlementCashAllocation"("cashId", "obligationId");
CREATE INDEX "SettlementCashAllocation_projectId_obligationId_recipientKe_idx" ON "SettlementCashAllocation"("projectId", "obligationId", "recipientKey");

CREATE UNIQUE INDEX "SettlementLock_actualCostApplicationId_key" ON "SettlementLock"("actualCostApplicationId");
CREATE UNIQUE INDEX "SettlementLock_advanceApplicationId_key" ON "SettlementLock"("advanceApplicationId");
CREATE UNIQUE INDEX "SettlementLock_dossierVersionId_actualCostApplicationId_key" ON "SettlementLock"("dossierVersionId", "actualCostApplicationId");
CREATE UNIQUE INDEX "SettlementLock_dossierVersionId_advanceApplicationId_key" ON "SettlementLock"("dossierVersionId", "advanceApplicationId");
CREATE INDEX "SettlementLock_projectId_obligationId_recipientKey_idx" ON "SettlementLock"("projectId", "obligationId", "recipientKey");
CREATE INDEX "SettlementLock_sourceCashAllocationId_idx" ON "SettlementLock"("sourceCashAllocationId");

CREATE UNIQUE INDEX "SettlementEvidence_dossierVersionId_evidenceId_kind_key" ON "SettlementEvidence"("dossierVersionId", "evidenceId", "kind");
CREATE INDEX "SettlementEvidence_projectId_dossierVersionId_idx" ON "SettlementEvidence"("projectId", "dossierVersionId");
CREATE INDEX "SettlementEvidence_addedById_createdAt_idx" ON "SettlementEvidence"("addedById", "createdAt");

CREATE UNIQUE INDEX "FinancialCloseRequest_projectId_attemptId_key" ON "FinancialCloseRequest"("projectId", "attemptId");
CREATE INDEX "FinancialCloseRequest_projectId_action_createdAt_idx" ON "FinancialCloseRequest"("projectId", "action", "createdAt");
CREATE INDEX "FinancialCloseRequest_requestedById_createdAt_idx" ON "FinancialCloseRequest"("requestedById", "createdAt");

CREATE UNIQUE INDEX "FinancialCloseEvent_eventHash_key" ON "FinancialCloseEvent"("eventHash");
CREATE INDEX "FinancialCloseEvent_closeRequestId_createdAt_idx" ON "FinancialCloseEvent"("closeRequestId", "createdAt");
CREATE INDEX "FinancialCloseEvent_actorId_createdAt_idx" ON "FinancialCloseEvent"("actorId", "createdAt");

CREATE UNIQUE INDEX "SettlementExportAudit_projectId_idempotencyKey_key" ON "SettlementExportAudit"("projectId", "idempotencyKey");
CREATE INDEX "SettlementExportAudit_dossierVersionId_family_format_idx" ON "SettlementExportAudit"("dossierVersionId", "family", "format");
CREATE INDEX "SettlementExportAudit_approvedSnapshotId_idx" ON "SettlementExportAudit"("approvedSnapshotId");
CREATE INDEX "SettlementExportAudit_createdById_createdAt_idx" ON "SettlementExportAudit"("createdById", "createdAt");

CREATE UNIQUE INDEX "ActualCostApplication_id_projectId_recipientKey_key" ON "ActualCostApplication"("id", "projectId", "recipientKey");
CREATE UNIQUE INDEX "AdvanceApplication_id_projectId_recipientKey_key" ON "AdvanceApplication"("id", "projectId", "recipientKey");
CREATE UNIQUE INDEX "CostFlowCash_id_projectId_recipientKey_key" ON "CostFlowCash"("id", "projectId", "recipientKey");
CREATE UNIQUE INDEX "CostFlowCashAllocation_id_projectId_recipientKey_key" ON "CostFlowCashAllocation"("id", "projectId", "recipientKey");

ALTER TABLE "ProjectSettlementDossier" ADD CONSTRAINT "ProjectSettlementDossier_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectSettlementDossier" ADD CONSTRAINT "ProjectSettlementDossier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectSettlementVersion" ADD CONSTRAINT "ProjectSettlementVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectSettlementVersion" ADD CONSTRAINT "ProjectSettlementVersion_dossierId_projectId_fkey" FOREIGN KEY ("dossierId", "projectId") REFERENCES "ProjectSettlementDossier"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectSettlementVersion" ADD CONSTRAINT "ProjectSettlementVersion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectSettlementVersion" ADD CONSTRAINT "ProjectSettlementVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectSettlementVersion" ADD CONSTRAINT "ProjectSettlementVersion_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "ProjectSettlementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectSettlementVersion" ADD CONSTRAINT "ProjectSettlementVersion_replacementActorId_fkey" FOREIGN KEY ("replacementActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementRecipientObligation" ADD CONSTRAINT "SettlementRecipientObligation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementRecipientObligation" ADD CONSTRAINT "SettlementRecipientObligation_dossierVersionId_projectId_fkey" FOREIGN KEY ("dossierVersionId", "projectId") REFERENCES "ProjectSettlementVersion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementCashAllocation" ADD CONSTRAINT "SettlementCashAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCashAllocation" ADD CONSTRAINT "SettlementCashAllocation_obligationId_projectId_recipientK_fkey" FOREIGN KEY ("obligationId", "projectId", "recipientKey") REFERENCES "SettlementRecipientObligation"("id", "projectId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCashAllocation" ADD CONSTRAINT "SettlementCashAllocation_cashId_projectId_recipientKey_fkey" FOREIGN KEY ("cashId", "projectId", "recipientKey") REFERENCES "CostFlowCash"("id", "projectId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementLock" ADD CONSTRAINT "SettlementLock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementLock" ADD CONSTRAINT "SettlementLock_dossierVersionId_projectId_fkey" FOREIGN KEY ("dossierVersionId", "projectId") REFERENCES "ProjectSettlementVersion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementLock" ADD CONSTRAINT "SettlementLock_obligationId_projectId_recipientKey_fkey" FOREIGN KEY ("obligationId", "projectId", "recipientKey") REFERENCES "SettlementRecipientObligation"("id", "projectId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementLock" ADD CONSTRAINT "SettlementLock_actualCostApplicationId_projectId_recipient_fkey" FOREIGN KEY ("actualCostApplicationId", "projectId", "recipientKey") REFERENCES "ActualCostApplication"("id", "projectId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementLock" ADD CONSTRAINT "SettlementLock_advanceApplicationId_projectId_recipientKey_fkey" FOREIGN KEY ("advanceApplicationId", "projectId", "recipientKey") REFERENCES "AdvanceApplication"("id", "projectId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementLock" ADD CONSTRAINT "SettlementLock_sourceCashAllocationId_projectId_recipientK_fkey" FOREIGN KEY ("sourceCashAllocationId", "projectId", "recipientKey") REFERENCES "CostFlowCashAllocation"("id", "projectId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementEvidence" ADD CONSTRAINT "SettlementEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementEvidence" ADD CONSTRAINT "SettlementEvidence_dossierVersionId_projectId_fkey" FOREIGN KEY ("dossierVersionId", "projectId") REFERENCES "ProjectSettlementVersion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementEvidence" ADD CONSTRAINT "SettlementEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "CostFlowEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementEvidence" ADD CONSTRAINT "SettlementEvidence_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialCloseRequest" ADD CONSTRAINT "FinancialCloseRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCloseRequest" ADD CONSTRAINT "FinancialCloseRequest_dossierId_projectId_fkey" FOREIGN KEY ("dossierId", "projectId") REFERENCES "ProjectSettlementDossier"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCloseRequest" ADD CONSTRAINT "FinancialCloseRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialCloseEvent" ADD CONSTRAINT "FinancialCloseEvent_closeRequestId_fkey" FOREIGN KEY ("closeRequestId") REFERENCES "FinancialCloseRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCloseEvent" ADD CONSTRAINT "FinancialCloseEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementExportAudit" ADD CONSTRAINT "SettlementExportAudit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementExportAudit" ADD CONSTRAINT "SettlementExportAudit_dossierVersionId_projectId_fkey" FOREIGN KEY ("dossierVersionId", "projectId") REFERENCES "ProjectSettlementVersion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementExportAudit" ADD CONSTRAINT "SettlementExportAudit_approvedSnapshotId_fkey" FOREIGN KEY ("approvedSnapshotId") REFERENCES "WorkflowApprovedSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementExportAudit" ADD CONSTRAINT "SettlementExportAudit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
