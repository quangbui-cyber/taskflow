CREATE TABLE "ExcelIntakePreviewSession" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "operationKind" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "draftId" TEXT,
  "sourceKind" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "sourceFilename" TEXT,
  "sourceMimeType" TEXT,
  "sourceSize" INTEGER NOT NULL,
  "sourceBytes" BYTEA,
  "canonicalFingerprint" TEXT NOT NULL,
  "canonicalPayload" JSONB,
  "displayPayload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "supersededAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "receiptId" TEXT,
  "resultKind" TEXT,
  "resultId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExcelIntakePreviewSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExcelIntakeOperationReceipt" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "previewSessionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "operationKind" TEXT NOT NULL,
  "canonicalFingerprint" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "linkedRecordKind" TEXT NOT NULL,
  "linkedRecordId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExcelIntakeOperationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExcelIntakeSourceEvidence" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "previewSessionId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "operationKind" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "linkedRecordKind" TEXT NOT NULL,
  "linkedRecordId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExcelIntakeSourceEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExcelIntakePreviewSession_receiptId_key" ON "ExcelIntakePreviewSession"("receiptId");
CREATE INDEX "ExcelIntakePreviewSession_projectId_actorId_operationKind_scopeKey_status_idx" ON "ExcelIntakePreviewSession"("projectId", "actorId", "operationKind", "scopeKey", "status");
CREATE INDEX "ExcelIntakePreviewSession_expiresAt_status_idx" ON "ExcelIntakePreviewSession"("expiresAt", "status");
CREATE INDEX "ExcelIntakePreviewSession_draftId_idx" ON "ExcelIntakePreviewSession"("draftId");
CREATE INDEX "ExcelIntakePreviewSession_sourceSha256_idx" ON "ExcelIntakePreviewSession"("sourceSha256");

CREATE UNIQUE INDEX "ExcelIntakeOperationReceipt_previewSessionId_key" ON "ExcelIntakeOperationReceipt"("previewSessionId");
CREATE UNIQUE INDEX "ExcelIntakeOperationReceipt_projectId_idempotencyKey_key" ON "ExcelIntakeOperationReceipt"("projectId", "idempotencyKey");
CREATE INDEX "ExcelIntakeOperationReceipt_projectId_linkedRecordKind_linkedRecordId_idx" ON "ExcelIntakeOperationReceipt"("projectId", "linkedRecordKind", "linkedRecordId");
CREATE INDEX "ExcelIntakeOperationReceipt_actorId_createdAt_idx" ON "ExcelIntakeOperationReceipt"("actorId", "createdAt");

CREATE UNIQUE INDEX "ExcelIntakeSourceEvidence_previewSessionId_key" ON "ExcelIntakeSourceEvidence"("previewSessionId");
CREATE UNIQUE INDEX "ExcelIntakeSourceEvidence_receiptId_key" ON "ExcelIntakeSourceEvidence"("receiptId");
CREATE INDEX "ExcelIntakeSourceEvidence_projectId_linkedRecordKind_linkedRecordId_idx" ON "ExcelIntakeSourceEvidence"("projectId", "linkedRecordKind", "linkedRecordId");
CREATE INDEX "ExcelIntakeSourceEvidence_sha256_idx" ON "ExcelIntakeSourceEvidence"("sha256");
CREATE INDEX "ExcelIntakeSourceEvidence_actorId_createdAt_idx" ON "ExcelIntakeSourceEvidence"("actorId", "createdAt");

ALTER TABLE "ExcelIntakePreviewSession" ADD CONSTRAINT "ExcelIntakePreviewSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExcelIntakePreviewSession" ADD CONSTRAINT "ExcelIntakePreviewSession_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExcelIntakeOperationReceipt" ADD CONSTRAINT "ExcelIntakeOperationReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExcelIntakeOperationReceipt" ADD CONSTRAINT "ExcelIntakeOperationReceipt_previewSessionId_fkey" FOREIGN KEY ("previewSessionId") REFERENCES "ExcelIntakePreviewSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExcelIntakeOperationReceipt" ADD CONSTRAINT "ExcelIntakeOperationReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExcelIntakeSourceEvidence" ADD CONSTRAINT "ExcelIntakeSourceEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExcelIntakeSourceEvidence" ADD CONSTRAINT "ExcelIntakeSourceEvidence_previewSessionId_fkey" FOREIGN KEY ("previewSessionId") REFERENCES "ExcelIntakePreviewSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExcelIntakeSourceEvidence" ADD CONSTRAINT "ExcelIntakeSourceEvidence_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ExcelIntakeOperationReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExcelIntakeSourceEvidence" ADD CONSTRAINT "ExcelIntakeSourceEvidence_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExcelIntakePreviewSession" ADD CONSTRAINT "ExcelIntakePreviewSession_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ExcelIntakeOperationReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
