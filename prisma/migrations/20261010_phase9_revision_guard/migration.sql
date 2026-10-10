ALTER TABLE "WorkflowTemplate"
ADD COLUMN "requiresExecutionTracking" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "WorkflowRequest_one_active_replacement_per_source_key"
ON "WorkflowRequest"("replacesRequestId")
WHERE "replacesRequestId" IS NOT NULL
  AND "state" IN ('DRAFT', 'SUBMITTED', 'RETURNED');
