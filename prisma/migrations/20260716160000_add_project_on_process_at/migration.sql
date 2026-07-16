ALTER TABLE "Project" ADD COLUMN "onProcessAt" TIMESTAMP(3);

UPDATE "Project"
SET "onProcessAt" = COALESCE("completedAt", "createdAt")
WHERE "status" IN ('ON_PROCESS', 'DONE')
  AND "onProcessAt" IS NULL;

CREATE INDEX "Project_status_onProcessAt_idx"
ON "Project"("status", "onProcessAt");
