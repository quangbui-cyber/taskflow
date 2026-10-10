CREATE TABLE "WorkflowPhysicalScanBatch" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "keeperDeclared" TEXT NOT NULL,
  "locationDeclared" TEXT NOT NULL, "keeperNormalized" TEXT, "locationNormalized" TEXT,
  "uploadedById" TEXT NOT NULL, "returnedReason" TEXT, "confirmedById" TEXT,
  "confirmedAt" TIMESTAMP(3), "supersededAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowPhysicalScanBatch_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkflowPhysicalScanFile" (
  "id" TEXT NOT NULL, "batchId" TEXT NOT NULL, "name" TEXT NOT NULL, "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL, "data" BYTEA NOT NULL, "sha256" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowPhysicalScanFile_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkflowPhysicalSigningTransition" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "batchId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL, "reason" TEXT NOT NULL DEFAULT '', "details" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowPhysicalSigningTransition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkflowPhysicalScanBatch_requestId_version_key" ON "WorkflowPhysicalScanBatch"("requestId", "version");
CREATE INDEX "WorkflowPhysicalScanBatch_requestId_status_createdAt_idx" ON "WorkflowPhysicalScanBatch"("requestId", "status", "createdAt");
CREATE INDEX "WorkflowPhysicalScanFile_batchId_createdAt_idx" ON "WorkflowPhysicalScanFile"("batchId", "createdAt");
CREATE INDEX "WorkflowPhysicalScanFile_sha256_idx" ON "WorkflowPhysicalScanFile"("sha256");
CREATE INDEX "WorkflowPhysicalSigningTransition_requestId_createdAt_idx" ON "WorkflowPhysicalSigningTransition"("requestId", "createdAt");
CREATE INDEX "WorkflowPhysicalSigningTransition_batchId_createdAt_idx" ON "WorkflowPhysicalSigningTransition"("batchId", "createdAt");
ALTER TABLE "WorkflowPhysicalScanBatch" ADD CONSTRAINT "WorkflowPhysicalScanBatch_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowPhysicalScanFile" ADD CONSTRAINT "WorkflowPhysicalScanFile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WorkflowPhysicalScanBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowPhysicalSigningTransition" ADD CONSTRAINT "WorkflowPhysicalSigningTransition_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowPhysicalSigningTransition" ADD CONSTRAINT "WorkflowPhysicalSigningTransition_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WorkflowPhysicalScanBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
