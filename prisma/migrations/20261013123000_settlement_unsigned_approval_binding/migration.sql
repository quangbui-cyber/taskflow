-- Settlement approval and signing are independent axes. A settlement can bind
-- its approval attempt and exact projection before a later signing lifecycle
-- exists, so the snapshot foreign key is optional while the other approval
-- identity fields remain all-or-nothing.
ALTER TABLE "ProjectSettlementVersion"
  DROP CONSTRAINT "ProjectSettlementVersion_approval_binding_check",
  ADD CONSTRAINT "ProjectSettlementVersion_approval_binding_check" CHECK (
    ("approvedAttemptId" IS NULL AND "approvedSnapshotId" IS NULL AND "approvedProjectionHash" IS NULL)
    OR
    (length(btrim("approvedAttemptId")) > 0
      AND ("approvedSnapshotId" IS NULL OR length(btrim("approvedSnapshotId")) > 0)
      AND "approvedProjectionHash" ~ '^[0-9a-f]{64}$')
  );
