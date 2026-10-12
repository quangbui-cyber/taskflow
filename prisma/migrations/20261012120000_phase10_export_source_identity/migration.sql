ALTER TABLE "SettlementExportSourceProjection"
  ALTER COLUMN "dossierVersionId" DROP NOT NULL,
  ADD COLUMN "approvalAttemptId" TEXT,
  ADD COLUMN "approvedSnapshotId" TEXT,
  ADD COLUMN "signingState" TEXT,
  ADD COLUMN "canonicalPayload" JSONB;

ALTER TABLE "SettlementExportSourceProjection"
  DROP CONSTRAINT "SettlementExportSourceProjection_dossierVersionId_projectId_fkey",
  ADD CONSTRAINT "SettlementExportSourceProjection_dossierVersionId_fkey"
    FOREIGN KEY ("dossierVersionId") REFERENCES "ProjectSettlementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SettlementExportSourceProjection"
  ADD CONSTRAINT "SettlementExportSourceProjection_identity_check" CHECK (
    ("approvalAttemptId" IS NULL OR length(btrim("approvalAttemptId")) > 0)
    AND ("approvedSnapshotId" IS NULL OR length(btrim("approvedSnapshotId")) > 0)
    AND ("signingState" IS NULL OR length(btrim("signingState")) > 0)
    AND ("canonicalPayload" IS NULL OR jsonb_typeof("canonicalPayload") = 'object')
  );
