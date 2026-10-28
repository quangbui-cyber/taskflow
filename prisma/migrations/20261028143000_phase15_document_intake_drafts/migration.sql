CREATE TABLE "DocumentIntakeDraft" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "fields" JSONB NOT NULL DEFAULT '{}',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentIntakeDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentIntakeDraft_projectId_kind_status_updatedAt_idx"
  ON "DocumentIntakeDraft"("projectId", "kind", "status", "updatedAt");
CREATE INDEX "DocumentIntakeDraft_createdById_updatedAt_idx"
  ON "DocumentIntakeDraft"("createdById", "updatedAt");

ALTER TABLE "DocumentIntakeDraft" ADD CONSTRAINT "DocumentIntakeDraft_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentIntakeDraft" ADD CONSTRAINT "DocumentIntakeDraft_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
