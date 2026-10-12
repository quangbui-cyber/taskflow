-- A draft must persist its exact source-manifest hash before it can be submitted.
-- Approval identity remains an all-or-nothing binding established later at approval.
ALTER TABLE "ProjectSettlementVersion"
  DROP CONSTRAINT "ProjectSettlementVersion_approval_binding_check",
  ADD CONSTRAINT "ProjectSettlementVersion_source_manifest_hash_check" CHECK (
    "sourceManifestHash" IS NULL OR "sourceManifestHash" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "ProjectSettlementVersion_approval_binding_check" CHECK (
    ("approvedAttemptId" IS NULL AND "approvedSnapshotId" IS NULL AND "approvedProjectionHash" IS NULL)
    OR
    (length(btrim("approvedAttemptId")) > 0
      AND "approvedSnapshotId" IS NOT NULL
      AND "approvedProjectionHash" ~ '^[0-9a-f]{64}$')
  );
