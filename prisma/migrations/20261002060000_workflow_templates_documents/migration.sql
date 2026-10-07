-- AlterTable
ALTER TABLE "WorkflowRequest" ADD COLUMN     "templateId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "parentId" TEXT,
    "ownerId" TEXT NOT NULL,
    "accountantId" TEXT NOT NULL,
    "ceoId" TEXT NOT NULL,
    "signerNames" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "fileId" TEXT,
    "ownerConfirmedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowFile" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "requestId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowTemplate_ownerId_publishedAt_idx" ON "WorkflowTemplate"("ownerId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTemplate_kind_version_key" ON "WorkflowTemplate"("kind", "version");

-- CreateIndex
CREATE INDEX "WorkflowFile_requestId_createdAt_idx" ON "WorkflowFile"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowFile_templateId_idx" ON "WorkflowFile"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowHistory_requestId_version_key" ON "WorkflowHistory"("requestId", "version");

-- AddForeignKey
ALTER TABLE "WorkflowRequest" ADD CONSTRAINT "WorkflowRequest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowFile" ADD CONSTRAINT "WorkflowFile_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowFile" ADD CONSTRAINT "WorkflowFile_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowHistory" ADD CONSTRAINT "WorkflowHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
