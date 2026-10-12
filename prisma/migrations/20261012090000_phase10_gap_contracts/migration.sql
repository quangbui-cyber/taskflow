-- Phase 10 gap closure: exact correction, source-manifest and export identity.
-- Additive only: no producer lifecycle, cash, lock or history row is updated.

ALTER TABLE "SettlementRecipientObligation"
  DROP CONSTRAINT "SettlementRecipientObligation_direction_check",
  DROP CONSTRAINT "SettlementRecipientObligation_amount_check",
  ADD CONSTRAINT "SettlementRecipientObligation_direction_check"
    CHECK ("direction" IN ('REFUND', 'ADDITIONAL', 'BALANCED')),
  ADD CONSTRAINT "SettlementRecipientObligation_amount_check"
    CHECK ("approvedAcGross" ~ '^[0-9]+$' AND "disbursedAdvance" ~ '^[0-9]+$' AND "amountDue" ~ '^[0-9]+$');

ALTER TABLE "FinancialCloseEvent"
  DROP CONSTRAINT "FinancialCloseEvent_decision_check",
  ADD CONSTRAINT "FinancialCloseEvent_decision_check"
    CHECK ("decision" IN ('REQUESTED', 'APPROVE', 'RETURN', 'REJECT'));

ALTER TABLE "ProjectSettlementVersion"
  ADD COLUMN "sourceManifestHash" TEXT,
  ADD COLUMN "approvedAttemptId" TEXT,
  ADD COLUMN "approvedSnapshotId" TEXT,
  ADD COLUMN "approvedProjectionHash" TEXT,
  ADD CONSTRAINT "ProjectSettlementVersion_approval_binding_check" CHECK (
    ("sourceManifestHash" IS NULL AND "approvedAttemptId" IS NULL AND "approvedSnapshotId" IS NULL AND "approvedProjectionHash" IS NULL)
    OR
    ("sourceManifestHash" ~ '^[0-9a-f]{64}$' AND length(btrim("approvedAttemptId")) > 0
      AND "approvedSnapshotId" IS NOT NULL AND "approvedProjectionHash" ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE "FinancialCloseRequest"
  ADD COLUMN "dossierVersionId" TEXT,
  ADD COLUMN "canonicalHash" TEXT,
  ADD COLUMN "workspaceVersion" INTEGER,
  ADD CONSTRAINT "FinancialCloseRequest_exact_binding_check" CHECK (
    ("dossierVersionId" IS NULL AND "canonicalHash" IS NULL AND "workspaceVersion" IS NULL)
    OR
    ("dossierVersionId" IS NOT NULL AND "canonicalHash" ~ '^[0-9a-f]{64}$' AND "workspaceVersion" >= 0)
  );

ALTER TABLE "SettlementExportAudit"
  ADD COLUMN "approvalAttemptId" TEXT,
  ADD COLUMN "sourceProjectionId" TEXT,
  ADD COLUMN "sourceKind" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "sourceVersion" INTEGER,
  ADD COLUMN "artifactStatus" TEXT NOT NULL DEFAULT 'RESERVED',
  ADD COLUMN "artifactBytes" BYTEA,
  ADD COLUMN "reservationToken" TEXT,
  ADD COLUMN "fileSha256" TEXT,
  ADD CONSTRAINT "SettlementExportAudit_source_identity_check" CHECK (
    ("approvalAttemptId" IS NULL AND "sourceProjectionId" IS NULL AND "sourceKind" IS NULL AND "sourceId" IS NULL AND "sourceVersion" IS NULL)
    OR
    (length(btrim("approvalAttemptId")) > 0 AND "sourceProjectionId" IS NOT NULL
      AND length(btrim("sourceKind")) > 0 AND length(btrim("sourceId")) > 0 AND "sourceVersion" > 0)
  ),
  ADD CONSTRAINT "SettlementExportAudit_status_check" CHECK ("artifactStatus" IN ('RESERVED', 'FINALIZED')),
  ADD CONSTRAINT "SettlementExportAudit_file_sha256_check" CHECK ("fileSha256" IS NULL OR "fileSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "SettlementExportAudit_artifact_check" CHECK (
    ("artifactStatus" = 'RESERVED' AND "artifactBytes" IS NULL AND "fileSha256" IS NULL)
    OR
    ("artifactStatus" = 'FINALIZED' AND "artifactBytes" IS NOT NULL AND octet_length("artifactBytes") > 0 AND "fileSha256" IS NOT NULL)
  );

CREATE TABLE "SettlementAdvanceManifestRow" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dossierVersionId" TEXT NOT NULL,
  "obligationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "advanceApplicationId" TEXT NOT NULL,
  "sourceCashAllocationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementAdvanceManifestRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SettlementCorrectionAttempt" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dossierId" TEXT NOT NULL,
  "baseVersionId" TEXT NOT NULL,
  "correctionVersionId" TEXT,
  "requestedFieldScopes" JSONB NOT NULL,
  "requestedLockScopes" JSONB NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "terminalAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementCorrectionAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementCorrectionAttempt_scope_check" CHECK (
    jsonb_typeof("requestedFieldScopes") = 'array' AND jsonb_array_length("requestedFieldScopes") > 0
    AND jsonb_typeof("requestedLockScopes") = 'array'
  ),
  CONSTRAINT "SettlementCorrectionAttempt_reason_check" CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "SettlementCorrectionAttempt_stage_check" CHECK (
    "stage" IN ('REQUESTED', 'APPROVED', 'VERSION_CREATED', 'RECOVERY_PENDING', 'PAYMENT_PENDING', 'APPROVAL_PENDING', 'SIGNING_PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED')
  ),
  CONSTRAINT "SettlementCorrectionAttempt_status_check" CHECK ("status" IN ('OPEN', 'COMPLETED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT "SettlementCorrectionAttempt_terminal_check" CHECK (
    ("terminalAt" IS NULL AND "status" = 'OPEN' AND "stage" NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED'))
    OR
    ("terminalAt" IS NOT NULL AND "status" = "stage" AND "stage" IN ('COMPLETED', 'REJECTED', 'CANCELLED'))
  )
);

CREATE TABLE "SettlementCorrectionObligationPair" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "correctionAttemptId" TEXT NOT NULL,
  "originalObligationId" TEXT NOT NULL,
  "recoveryObligationId" TEXT NOT NULL,
  "correctedPaymentObligationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementCorrectionObligationPair_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementCorrectionObligationPair_distinct_check" CHECK (
    "originalObligationId" <> "recoveryObligationId"
    AND "originalObligationId" <> "correctedPaymentObligationId"
    AND "recoveryObligationId" <> "correctedPaymentObligationId"
  )
);

CREATE TABLE "SettlementExportSourceProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dossierVersionId" TEXT NOT NULL,
  "family" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "authoritativeNet" TEXT NOT NULL,
  "authoritativeVat" TEXT NOT NULL,
  "authoritativeGross" TEXT NOT NULL,
  "roundingAdjustment" INTEGER NOT NULL,
  "vatLineAssignment" JSONB NOT NULL,
  "projectionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementExportSourceProjection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementExportSourceProjection_source_check" CHECK (
    length(btrim("family")) > 0 AND length(btrim("sourceKind")) > 0
    AND length(btrim("sourceId")) > 0 AND "sourceVersion" > 0
  ),
  CONSTRAINT "SettlementExportSourceProjection_amount_check" CHECK (
    "authoritativeNet" ~ '^[0-9]+$' AND "authoritativeVat" ~ '^[0-9]+$' AND "authoritativeGross" ~ '^[0-9]+$'
  ),
  CONSTRAINT "SettlementExportSourceProjection_rounding_check" CHECK ("roundingAdjustment" IN (-1, 0, 1)),
  CONSTRAINT "SettlementExportSourceProjection_vat_assignment_check" CHECK (jsonb_typeof("vatLineAssignment") = 'object'),
  CONSTRAINT "SettlementExportSourceProjection_hash_check" CHECK ("projectionHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "SettlementRecipientObligation_id_projectId_key" ON "SettlementRecipientObligation"("id", "projectId");
CREATE UNIQUE INDEX "WorkflowApprovedSnapshot_id_requestId_key" ON "WorkflowApprovedSnapshot"("id", "requestId");
CREATE UNIQUE INDEX "SettlementCorrectionAttempt_correctionVersionId_key" ON "SettlementCorrectionAttempt"("correctionVersionId");
CREATE UNIQUE INDEX "SettlementCorrectionAttempt_id_projectId_key" ON "SettlementCorrectionAttempt"("id", "projectId");
CREATE UNIQUE INDEX "SettlementCorrectionAttempt_one_open_per_project_idx" ON "SettlementCorrectionAttempt"("projectId") WHERE "terminalAt" IS NULL;
CREATE INDEX "SettlementCorrectionAttempt_projectId_createdAt_idx" ON "SettlementCorrectionAttempt"("projectId", "createdAt");
CREATE INDEX "SettlementCorrectionAttempt_dossierId_createdAt_idx" ON "SettlementCorrectionAttempt"("dossierId", "createdAt");
CREATE UNIQUE INDEX "SettlementAdvanceManifestRow_dossier_application_allocation_key" ON "SettlementAdvanceManifestRow"("dossierVersionId", "advanceApplicationId", "sourceCashAllocationId");
CREATE INDEX "SettlementAdvanceManifestRow_project_obligation_recipient_idx" ON "SettlementAdvanceManifestRow"("projectId", "obligationId", "recipientKey");
CREATE UNIQUE INDEX "SettlementCorrectionObligationPair_attempt_original_key" ON "SettlementCorrectionObligationPair"("correctionAttemptId", "originalObligationId");
CREATE UNIQUE INDEX "SettlementCorrectionObligationPair_recovery_key" ON "SettlementCorrectionObligationPair"("recoveryObligationId");
CREATE UNIQUE INDEX "SettlementCorrectionObligationPair_payment_key" ON "SettlementCorrectionObligationPair"("correctedPaymentObligationId");
CREATE INDEX "SettlementCorrectionObligationPair_projectId_createdAt_idx" ON "SettlementCorrectionObligationPair"("projectId", "createdAt");
CREATE UNIQUE INDEX "SettlementExportSourceProjection_exact_source_key" ON "SettlementExportSourceProjection"("projectId", "family", "sourceKind", "sourceId", "sourceVersion");
CREATE UNIQUE INDEX "SettlementExportSourceProjection_id_projectId_key" ON "SettlementExportSourceProjection"("id", "projectId");
CREATE INDEX "SettlementExportSourceProjection_dossierVersionId_family_idx" ON "SettlementExportSourceProjection"("dossierVersionId", "family");
CREATE INDEX "FinancialCloseRequest_dossierVersionId_idx" ON "FinancialCloseRequest"("dossierVersionId");
CREATE INDEX "SettlementExportAudit_exact_source_idx" ON "SettlementExportAudit"("projectId", "family", "sourceKind", "sourceId", "sourceVersion");
CREATE INDEX "SettlementExportAudit_fileSha256_idx" ON "SettlementExportAudit"("fileSha256");

ALTER TABLE "ProjectSettlementVersion" ADD CONSTRAINT "ProjectSettlementVersion_approvedSnapshotId_requestId_fkey" FOREIGN KEY ("approvedSnapshotId", "requestId") REFERENCES "WorkflowApprovedSnapshot"("id", "requestId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCloseRequest" ADD CONSTRAINT "FinancialCloseRequest_dossierVersionId_projectId_fkey" FOREIGN KEY ("dossierVersionId", "projectId") REFERENCES "ProjectSettlementVersion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementAdvanceManifestRow" ADD CONSTRAINT "SettlementAdvanceManifestRow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementAdvanceManifestRow" ADD CONSTRAINT "SettlementAdvanceManifestRow_dossierVersionId_projectId_fkey" FOREIGN KEY ("dossierVersionId", "projectId") REFERENCES "ProjectSettlementVersion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementAdvanceManifestRow" ADD CONSTRAINT "SettlementAdvanceManifestRow_obligationId_projectId_recipient_fkey" FOREIGN KEY ("obligationId", "projectId", "recipientKey") REFERENCES "SettlementRecipientObligation"("id", "projectId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementAdvanceManifestRow" ADD CONSTRAINT "SettlementAdvanceManifestRow_advanceApplicationId_projectId_recipient_fkey" FOREIGN KEY ("advanceApplicationId", "projectId", "recipientKey") REFERENCES "AdvanceApplication"("id", "projectId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementAdvanceManifestRow" ADD CONSTRAINT "SettlementAdvanceManifestRow_sourceCashAllocationId_project_recipient_fkey" FOREIGN KEY ("sourceCashAllocationId", "projectId", "recipientKey") REFERENCES "CostFlowCashAllocation"("id", "projectId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementCorrectionAttempt" ADD CONSTRAINT "SettlementCorrectionAttempt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCorrectionAttempt" ADD CONSTRAINT "SettlementCorrectionAttempt_dossierId_projectId_fkey" FOREIGN KEY ("dossierId", "projectId") REFERENCES "ProjectSettlementDossier"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCorrectionAttempt" ADD CONSTRAINT "SettlementCorrectionAttempt_baseVersionId_projectId_fkey" FOREIGN KEY ("baseVersionId", "projectId") REFERENCES "ProjectSettlementVersion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCorrectionAttempt" ADD CONSTRAINT "SettlementCorrectionAttempt_correctionVersionId_projectId_fkey" FOREIGN KEY ("correctionVersionId", "projectId") REFERENCES "ProjectSettlementVersion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCorrectionAttempt" ADD CONSTRAINT "SettlementCorrectionAttempt_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementCorrectionObligationPair" ADD CONSTRAINT "SettlementCorrectionObligationPair_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCorrectionObligationPair" ADD CONSTRAINT "SettlementCorrectionObligationPair_attemptId_projectId_fkey" FOREIGN KEY ("correctionAttemptId", "projectId") REFERENCES "SettlementCorrectionAttempt"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCorrectionObligationPair" ADD CONSTRAINT "SettlementCorrectionObligationPair_originalId_projectId_fkey" FOREIGN KEY ("originalObligationId", "projectId") REFERENCES "SettlementRecipientObligation"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCorrectionObligationPair" ADD CONSTRAINT "SettlementCorrectionObligationPair_recoveryId_projectId_fkey" FOREIGN KEY ("recoveryObligationId", "projectId") REFERENCES "SettlementRecipientObligation"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementCorrectionObligationPair" ADD CONSTRAINT "SettlementCorrectionObligationPair_paymentId_projectId_fkey" FOREIGN KEY ("correctedPaymentObligationId", "projectId") REFERENCES "SettlementRecipientObligation"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementExportSourceProjection" ADD CONSTRAINT "SettlementExportSourceProjection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementExportSourceProjection" ADD CONSTRAINT "SettlementExportSourceProjection_dossierVersionId_projectId_fkey" FOREIGN KEY ("dossierVersionId", "projectId") REFERENCES "ProjectSettlementVersion"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementExportAudit" ADD CONSTRAINT "SettlementExportAudit_sourceProjectionId_projectId_fkey" FOREIGN KEY ("sourceProjectionId", "projectId") REFERENCES "SettlementExportSourceProjection"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
