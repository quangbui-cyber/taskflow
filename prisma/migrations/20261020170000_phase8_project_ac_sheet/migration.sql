ALTER TABLE "ActualCostLine"
  ADD COLUMN "draftRemovedAt" TIMESTAMP(3),
  ADD COLUMN "draftRemovedById" TEXT;

CREATE TABLE "ActualCostSheet" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "currentRevision" INTEGER NOT NULL DEFAULT 0,
  "mutationVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualCostSheet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActualCostSheetRevision" (
  "id" TEXT NOT NULL,
  "sheetId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'DRAFT',
  "icRevisionId" TEXT NOT NULL,
  "mutationVersion" INTEGER NOT NULL DEFAULT 0,
  "manifestHash" TEXT,
  "submittedById" TEXT,
  "decidedById" TEXT,
  "workflowRequestId" TEXT,
  "note" TEXT NOT NULL DEFAULT '',
  "missingEvidenceExplanation" TEXT NOT NULL DEFAULT '',
  "overBudgetExplanation" TEXT NOT NULL DEFAULT '',
  "decisionReason" TEXT NOT NULL DEFAULT '',
  "submittedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "returnedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualCostSheetRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActualCostSheetRevision_state_check" CHECK ("state" IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')),
  CONSTRAINT "ActualCostSheetRevision_distinct_actor_check" CHECK ("submittedById" IS NULL OR "decidedById" IS NULL OR "submittedById" <> "decidedById")
);

CREATE TABLE "ActualCostSheetRevisionLine" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualCostSheetRevisionLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActualCostFundingAllocation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL DEFAULT '',
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualCostFundingAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActualCostSheetEvent" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "lineId" TEXT,
  "versionId" TEXT,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActualCostSheetEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActualCostSheet_projectId_key" ON "ActualCostSheet"("projectId");
CREATE INDEX "ActualCostSheet_projectId_updatedAt_idx" ON "ActualCostSheet"("projectId", "updatedAt");

CREATE UNIQUE INDEX "ActualCostSheetRevision_sheetId_revision_key" ON "ActualCostSheetRevision"("sheetId", "revision");
CREATE UNIQUE INDEX "ActualCostSheetRevision_workflowRequestId_key" ON "ActualCostSheetRevision"("workflowRequestId");
CREATE UNIQUE INDEX "ActualCostSheetRevision_one_open_key" ON "ActualCostSheetRevision"("sheetId") WHERE "state" IN ('DRAFT', 'SUBMITTED');
CREATE UNIQUE INDEX "ActualCostSheetRevision_manifest_key" ON "ActualCostSheetRevision"("sheetId", "manifestHash") WHERE "manifestHash" IS NOT NULL;
CREATE INDEX "ActualCostSheetRevision_projectId_state_createdAt_idx" ON "ActualCostSheetRevision"("projectId", "state", "createdAt");
CREATE INDEX "ActualCostSheetRevision_submittedById_submittedAt_idx" ON "ActualCostSheetRevision"("submittedById", "submittedAt");
CREATE INDEX "ActualCostSheetRevision_decidedById_decidedAt_idx" ON "ActualCostSheetRevision"("decidedById", "decidedAt");

CREATE UNIQUE INDEX "ActualCostSheetRevisionLine_revisionId_lineId_key" ON "ActualCostSheetRevisionLine"("revisionId", "lineId");
CREATE UNIQUE INDEX "ActualCostSheetRevisionLine_revisionId_versionId_key" ON "ActualCostSheetRevisionLine"("revisionId", "versionId");
CREATE INDEX "ActualCostSheetRevisionLine_projectId_revisionId_position_idx" ON "ActualCostSheetRevisionLine"("projectId", "revisionId", "position");
CREATE INDEX "ActualCostSheetRevisionLine_lineId_versionId_idx" ON "ActualCostSheetRevisionLine"("lineId", "versionId");

CREATE UNIQUE INDEX "ActualCostFundingAllocation_versionId_position_key" ON "ActualCostFundingAllocation"("versionId", "position");
CREATE INDEX "ActualCostFundingAllocation_projectId_source_idx" ON "ActualCostFundingAllocation"("projectId", "source");
CREATE INDEX "ActualCostFundingAllocation_recipientKey_idx" ON "ActualCostFundingAllocation"("recipientKey");

CREATE INDEX "ActualCostSheetEvent_projectId_revisionId_createdAt_idx" ON "ActualCostSheetEvent"("projectId", "revisionId", "createdAt");
CREATE INDEX "ActualCostSheetEvent_lineId_createdAt_idx" ON "ActualCostSheetEvent"("lineId", "createdAt");
CREATE INDEX "ActualCostSheetEvent_actorId_createdAt_idx" ON "ActualCostSheetEvent"("actorId", "createdAt");

ALTER TABLE "ActualCostSheet" ADD CONSTRAINT "ActualCostSheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetRevision" ADD CONSTRAINT "ActualCostSheetRevision_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ActualCostSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetRevision" ADD CONSTRAINT "ActualCostSheetRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetRevision" ADD CONSTRAINT "ActualCostSheetRevision_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetRevision" ADD CONSTRAINT "ActualCostSheetRevision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetRevision" ADD CONSTRAINT "ActualCostSheetRevision_workflowRequestId_fkey" FOREIGN KEY ("workflowRequestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetRevisionLine" ADD CONSTRAINT "ActualCostSheetRevisionLine_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ActualCostSheetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetRevisionLine" ADD CONSTRAINT "ActualCostSheetRevisionLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ActualCostLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetRevisionLine" ADD CONSTRAINT "ActualCostSheetRevisionLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ActualCostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostFundingAllocation" ADD CONSTRAINT "ActualCostFundingAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostFundingAllocation" ADD CONSTRAINT "ActualCostFundingAllocation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ActualCostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostFundingAllocation" ADD CONSTRAINT "ActualCostFundingAllocation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetEvent" ADD CONSTRAINT "ActualCostSheetEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetEvent" ADD CONSTRAINT "ActualCostSheetEvent_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ActualCostSheetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetEvent" ADD CONSTRAINT "ActualCostSheetEvent_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ActualCostLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetEvent" ADD CONSTRAINT "ActualCostSheetEvent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ActualCostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActualCostSheetEvent" ADD CONSTRAINT "ActualCostSheetEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
