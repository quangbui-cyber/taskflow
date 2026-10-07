CREATE TABLE "QuotationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "proposalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "QuotationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotationTemplateProposal" (
    "id" TEXT NOT NULL,
    "sourceProjectId" TEXT NOT NULL,
    "sourceQuotationId" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "proposedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuotationTemplateProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuotationTemplate_proposalId_key" ON "QuotationTemplate"("proposalId");
CREATE INDEX "QuotationTemplate_status_createdAt_idx" ON "QuotationTemplate"("status", "createdAt");
CREATE UNIQUE INDEX "QuotationTemplateProposal_templateId_key" ON "QuotationTemplateProposal"("templateId");
CREATE INDEX "QuotationTemplateProposal_status_createdAt_idx" ON "QuotationTemplateProposal"("status", "createdAt");
CREATE INDEX "QuotationTemplateProposal_sourceProjectId_sourceQuotationId_idx" ON "QuotationTemplateProposal"("sourceProjectId", "sourceQuotationId");
