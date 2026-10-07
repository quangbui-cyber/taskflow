-- CreateTable
CREATE TABLE "WorkflowRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "cashAssigneeId" TEXT NOT NULL,
    "parentId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "steps" JSONB NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "step" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostFlowWorkspace" (
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostFlowWorkspace_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "CostFlowCash" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "allocations" JSONB NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostFlowCash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostFlowEvidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestId" TEXT,
    "sourceFileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostFlowEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostFlowHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostFlowHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowRequest_projectId_module_createdAt_idx" ON "WorkflowRequest"("projectId", "module", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRequest_creatorId_state_idx" ON "WorkflowRequest"("creatorId", "state");

-- CreateIndex
CREATE INDEX "WorkflowRequest_cashAssigneeId_idx" ON "WorkflowRequest"("cashAssigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDecision_requestId_version_key" ON "WorkflowDecision"("requestId", "version");

-- CreateIndex
CREATE INDEX "CostFlowCash_projectId_recipientKey_idx" ON "CostFlowCash"("projectId", "recipientKey");

-- CreateIndex
CREATE UNIQUE INDEX "CostFlowCash_projectId_reference_key" ON "CostFlowCash"("projectId", "reference");

-- CreateIndex
CREATE INDEX "CostFlowEvidence_projectId_requestId_idx" ON "CostFlowEvidence"("projectId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "CostFlowHistory_projectId_version_key" ON "CostFlowHistory"("projectId", "version");

-- AddForeignKey
ALTER TABLE "WorkflowRequest" ADD CONSTRAINT "WorkflowRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDecision" ADD CONSTRAINT "WorkflowDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostFlowWorkspace" ADD CONSTRAINT "CostFlowWorkspace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostFlowCash" ADD CONSTRAINT "CostFlowCash_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostFlowCash" ADD CONSTRAINT "CostFlowCash_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostFlowEvidence" ADD CONSTRAINT "CostFlowEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostFlowEvidence" ADD CONSTRAINT "CostFlowEvidence_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostFlowHistory" ADD CONSTRAINT "CostFlowHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
