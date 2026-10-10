-- Phase 9 WF-04: additive protected reusable signature assets and PIN hash.
ALTER TABLE "User" ADD COLUMN "signaturePinHash" TEXT;

CREATE TABLE "WorkflowSignatureAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "pngData" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "sha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkflowSignatureAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowSignatureAssetAudit" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "ownerId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sha256" TEXT,
    "byteLength" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowSignatureAssetAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowSignatureAsset_ownerId_key" ON "WorkflowSignatureAsset"("ownerId");
CREATE INDEX "WorkflowSignatureAsset_sha256_idx" ON "WorkflowSignatureAsset"("sha256");
CREATE INDEX "WorkflowSignatureAssetAudit_ownerId_createdAt_idx" ON "WorkflowSignatureAssetAudit"("ownerId", "createdAt");
CREATE INDEX "WorkflowSignatureAssetAudit_actorId_createdAt_idx" ON "WorkflowSignatureAssetAudit"("actorId", "createdAt");

ALTER TABLE "WorkflowSignatureAsset" ADD CONSTRAINT "WorkflowSignatureAsset_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowSignatureAssetAudit" ADD CONSTRAINT "WorkflowSignatureAssetAudit_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "WorkflowSignatureAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowSignatureAssetAudit" ADD CONSTRAINT "WorkflowSignatureAssetAudit_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowSignatureAssetAudit" ADD CONSTRAINT "WorkflowSignatureAssetAudit_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
