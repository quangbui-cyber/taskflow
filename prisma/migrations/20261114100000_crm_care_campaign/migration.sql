-- CreateTable
CREATE TABLE "CareCampaignTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "steps" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareCampaignTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "targetOpportunities" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "steps" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "filter" JSONB NOT NULL,
    "assignments" JSONB NOT NULL DEFAULT '{}',
    "launchedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "teamId" TEXT,
    "createdById" TEXT,

    CONSTRAINT "CareCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareCampaignTarget" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stoppedReason" TEXT,
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "picAccountId" TEXT,

    CONSTRAINT "CareCampaignTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareCampaignTask" (
    "id" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "touchpointId" TEXT,

    CONSTRAINT "CareCampaignTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareCampaignTemplate_name_key" ON "CareCampaignTemplate"("name");

-- CreateIndex
CREATE INDEX "CareCampaign_status_idx" ON "CareCampaign"("status");

-- CreateIndex
CREATE INDEX "CareCampaign_teamId_idx" ON "CareCampaign"("teamId");

-- CreateIndex
CREATE INDEX "CareCampaignTarget_clientId_status_idx" ON "CareCampaignTarget"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CareCampaignTarget_campaignId_clientId_key" ON "CareCampaignTarget"("campaignId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "CareCampaignTask_taskId_key" ON "CareCampaignTask"("taskId");

-- CreateIndex
CREATE INDEX "CareCampaignTask_touchpointId_idx" ON "CareCampaignTask"("touchpointId");

-- CreateIndex
CREATE UNIQUE INDEX "CareCampaignTask_targetId_stepIndex_key" ON "CareCampaignTask"("targetId", "stepIndex");

-- AddForeignKey
ALTER TABLE "CareCampaign" ADD CONSTRAINT "CareCampaign_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SalesTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCampaign" ADD CONSTRAINT "CareCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCampaignTarget" ADD CONSTRAINT "CareCampaignTarget_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CareCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCampaignTarget" ADD CONSTRAINT "CareCampaignTarget_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCampaignTarget" ADD CONSTRAINT "CareCampaignTarget_picAccountId_fkey" FOREIGN KEY ("picAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCampaignTask" ADD CONSTRAINT "CareCampaignTask_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "CareCampaignTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCampaignTask" ADD CONSTRAINT "CareCampaignTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCampaignTask" ADD CONSTRAINT "CareCampaignTask_touchpointId_fkey" FOREIGN KEY ("touchpointId") REFERENCES "Touchpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

