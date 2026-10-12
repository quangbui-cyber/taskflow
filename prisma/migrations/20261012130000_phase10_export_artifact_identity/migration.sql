ALTER TABLE "SettlementExportAudit"
  DROP CONSTRAINT "SettlementExportAudit_artifact_check",
  DROP CONSTRAINT "SettlementExportAudit_status_check",
  ALTER COLUMN "dossierVersionId" DROP NOT NULL,
  ALTER COLUMN "approvedSnapshotId" DROP NOT NULL,
  ADD COLUMN "artifactByteLength" INTEGER;

ALTER TABLE "SettlementExportAudit"
  ADD CONSTRAINT "SettlementExportAudit_status_check" CHECK ("artifactStatus" IN ('RESERVED', 'FINALIZED', 'FAILED')),
  ADD CONSTRAINT "SettlementExportAudit_artifact_check" CHECK (
    ("artifactStatus" IN ('RESERVED', 'FAILED') AND "artifactBytes" IS NULL AND "artifactByteLength" IS NULL AND "fileSha256" IS NULL)
    OR
    ("artifactStatus" = 'FINALIZED' AND "artifactBytes" IS NOT NULL AND "artifactByteLength" = octet_length("artifactBytes") AND "artifactByteLength" > 0 AND "fileSha256" IS NOT NULL)
  );

ALTER TABLE "WorkflowPublicVerificationCapability"
  ADD COLUMN "exportAuditId" TEXT;

DROP INDEX "WorkflowPublicVerificationCapability_snapshotId_key";

CREATE INDEX "WorkflowPublicVerificationCapability_snapshotId_idx"
  ON "WorkflowPublicVerificationCapability"("snapshotId");

CREATE UNIQUE INDEX "WorkflowPublicVerificationCapability_legacy_snapshot_key"
  ON "WorkflowPublicVerificationCapability"("snapshotId")
  WHERE "exportAuditId" IS NULL;

CREATE UNIQUE INDEX "WorkflowPublicVerificationCapability_exportAuditId_key"
  ON "WorkflowPublicVerificationCapability"("exportAuditId");

ALTER TABLE "WorkflowPublicVerificationCapability"
  ADD CONSTRAINT "WorkflowPublicVerificationCapability_exportAuditId_fkey"
    FOREIGN KEY ("exportAuditId") REFERENCES "SettlementExportAudit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
