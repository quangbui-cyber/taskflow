-- A creator/manager/accountant signs before the final approved snapshot exists.
-- Bind each event to request + submitted version + role first; attach the
-- immutable approved snapshot only when the fourth (CEO) signature finalizes.
DROP INDEX IF EXISTS "WorkflowSigningEvent_snapshotId_role_key";

ALTER TABLE "WorkflowSigningEvent"
  ALTER COLUMN "snapshotId" DROP NOT NULL;

CREATE UNIQUE INDEX "WorkflowSigningEvent_requestId_version_role_key"
  ON "WorkflowSigningEvent"("requestId", "version", "role");

CREATE INDEX "WorkflowSigningEvent_snapshotId_role_idx"
  ON "WorkflowSigningEvent"("snapshotId", "role");
