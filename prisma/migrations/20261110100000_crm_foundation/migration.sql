-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "budgetSeason" TEXT,
ADD COLUMN     "budgetSeasonMonth" INTEGER,
ADD COLUMN     "importConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "importStatus" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "picAccountId" TEXT,
ADD COLUMN     "potentialLevel" TEXT,
ADD COLUMN     "potentialScoredAt" TIMESTAMP(3),
ADD COLUMN     "potentialScoredById" TEXT,
ADD COLUMN     "responsibleTeamId" TEXT,
ADD COLUMN     "valuedMost" TEXT,
ADD COLUMN     "vendorSelection" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "sourceOpportunityId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "opportunityId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "sourceOpportunityId" TEXT;

-- AlterTable
ALTER TABLE "ProjectFile" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "sourceOpportunityId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "closedReason" TEXT,
ADD COLUMN     "crmKind" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "sourceOpportunityId" TEXT,
ALTER COLUMN "projectId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isCrmDataSteward" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClientPotentialScore" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "note" TEXT,
    "scoredByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "scoredById" TEXT,

    CONSTRAINT "ClientPotentialScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyingUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "BuyingUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTeamManager" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CrmTeamManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramType" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ProgramTypeAlias" (
    "alias" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "ProgramTypeAlias_pkey" PRIMARY KEY ("alias")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expectedYear" INTEGER NOT NULL,
    "expectedMonth" INTEGER,
    "expectedQuarter" INTEGER,
    "source" TEXT NOT NULL,
    "demandSignal" TEXT NOT NULL,
    "confirmReason" TEXT,
    "budgetMin" DECIMAL(18,0),
    "budgetMax" DECIMAL(18,0),
    "stage" TEXT NOT NULL DEFAULT 'CARE',
    "outcome" TEXT,
    "outcomeNote" TEXT,
    "lessons" TEXT,
    "briefReceivedAt" TIMESTAMP(3),
    "proposalDueAt" TIMESTAMP(3),
    "briefSummary" TEXT,
    "winStrategy" TEXT,
    "proposalPlannedAt" TIMESTAMP(3),
    "contractValue" DECIMAL(18,0),
    "wonAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "expectedEventId" TEXT,
    "legacyProjectId" TEXT,
    "legacyStatus" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "buyingUnitId" TEXT,
    "picAccountId" TEXT,
    "responsibleTeamId" TEXT,
    "outcomeReasonId" TEXT,
    "closedById" TEXT,
    "createdById" TEXT,
    "programTypeCode" TEXT NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityStageEvent" (
    "id" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "outcome" TEXT,
    "actorName" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "opportunityId" TEXT NOT NULL,
    "actorId" TEXT,

    CONSTRAINT "OpportunityStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opportunityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "OpportunityMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpectedEvent" (
    "id" TEXT NOT NULL,
    "precision" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "quarter" INTEGER,
    "date" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "buyingUnitId" TEXT,
    "createdById" TEXT,
    "programTypeCode" TEXT NOT NULL,

    CONSTRAINT "ExpectedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderStep" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "offsetDays" INTEGER,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedEventId" TEXT NOT NULL,
    "taskId" TEXT,

    CONSTRAINT "ReminderStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadenceReminder" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "taskId" TEXT,

    CONSTRAINT "CadenceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Touchpoint" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "outcomeLevel" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "sourceType" TEXT,
    "sourceId" TEXT,
    "clientRequestId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "authorId" TEXT,
    "confirmedById" TEXT,

    CONSTRAINT "Touchpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskPostpone" (
    "id" TEXT NOT NULL,
    "fromDueDate" TIMESTAMP(3),
    "toDueDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,

    CONSTRAINT "TaskPostpone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "CrmSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CrmSettingChange" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,

    CONSTRAINT "CrmSettingChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmReason" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "requiresNote" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmMigrationBatch" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "databaseHost" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "summary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CrmMigrationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmMigrationRecord" (
    "id" TEXT NOT NULL,
    "legacyProjectId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "classification" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" TEXT NOT NULL,

    CONSTRAINT "CrmMigrationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerImportRun" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "TrackerImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerImportRow" (
    "id" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "proposed" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "runId" TEXT NOT NULL,
    "matchedClientId" TEXT,
    "resolvedById" TEXT,

    CONSTRAINT "TrackerImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMergeLog" (
    "id" TEXT NOT NULL,
    "sourceClientId" TEXT NOT NULL,
    "sourceClientName" TEXT NOT NULL,
    "targetClientId" TEXT NOT NULL,
    "movedCounts" JSONB NOT NULL,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "ClientMergeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPotentialScore_clientId_createdAt_idx" ON "ClientPotentialScore"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BuyingUnit_clientId_name_key" ON "BuyingUnit"("clientId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTeamManager_teamId_userId_key" ON "CrmTeamManager"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_expectedEventId_key" ON "Opportunity"("expectedEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_legacyProjectId_key" ON "Opportunity"("legacyProjectId");

-- CreateIndex
CREATE INDEX "Opportunity_clientId_outcome_idx" ON "Opportunity"("clientId", "outcome");

-- CreateIndex
CREATE INDEX "Opportunity_stage_outcome_idx" ON "Opportunity"("stage", "outcome");

-- CreateIndex
CREATE INDEX "Opportunity_picAccountId_idx" ON "Opportunity"("picAccountId");

-- CreateIndex
CREATE INDEX "OpportunityStageEvent_opportunityId_occurredAt_idx" ON "OpportunityStageEvent"("opportunityId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityMember_opportunityId_userId_key" ON "OpportunityMember"("opportunityId", "userId");

-- CreateIndex
CREATE INDEX "ExpectedEvent_clientId_status_idx" ON "ExpectedEvent"("clientId", "status");

-- CreateIndex
CREATE INDEX "ReminderStep_status_dueDate_idx" ON "ReminderStep"("status", "dueDate");

-- CreateIndex
CREATE INDEX "ReminderStep_expectedEventId_revision_idx" ON "ReminderStep"("expectedEventId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "CadenceReminder_clientId_periodKey_key" ON "CadenceReminder"("clientId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "Touchpoint_clientRequestId_key" ON "Touchpoint"("clientRequestId");

-- CreateIndex
CREATE INDEX "Touchpoint_clientId_status_occurredAt_idx" ON "Touchpoint"("clientId", "status", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Touchpoint_sourceType_sourceId_clientId_key" ON "Touchpoint"("sourceType", "sourceId", "clientId");

-- CreateIndex
CREATE INDEX "CrmSettingChange_key_createdAt_idx" ON "CrmSettingChange"("key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmReason_group_label_key" ON "CrmReason"("group", "label");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMigrationRecord_batchId_legacyProjectId_key" ON "CrmMigrationRecord"("batchId", "legacyProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackerImportRow_runId_sheet_rowNumber_key" ON "TrackerImportRow"("runId", "sheet", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Project_sourceOpportunityId_key" ON "Project"("sourceOpportunityId");

-- CreateIndex
CREATE INDEX "Task_opportunityId_status_idx" ON "Task"("opportunityId", "status");

-- CreateIndex
CREATE INDEX "Task_clientId_status_idx" ON "Task"("clientId", "status");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_sourceOpportunityId_fkey" FOREIGN KEY ("sourceOpportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- Danh mục loại chương trình: giữ nguyên mã và màu hiện có.
INSERT INTO "ProgramType" ("code","label","color","order") SELECT 'TEAMBUILDING','Teambuilding','#0d9488',0 WHERE NOT EXISTS (SELECT 1 FROM "ProgramType" WHERE "code"='TEAMBUILDING');
INSERT INTO "ProgramType" ("code","label","color","order") SELECT 'MICE','MICE','#4f46e5',1 WHERE NOT EXISTS (SELECT 1 FROM "ProgramType" WHERE "code"='MICE');
INSERT INTO "ProgramType" ("code","label","color","order") SELECT 'ACTIVATION','Activation','#ea580c',2 WHERE NOT EXISTS (SELECT 1 FROM "ProgramType" WHERE "code"='ACTIVATION');
INSERT INTO "ProgramType" ("code","label","color","order") SELECT 'EVENT','Event','#db2777',3 WHERE NOT EXISTS (SELECT 1 FROM "ProgramType" WHERE "code"='EVENT');
INSERT INTO "ProgramType" ("code","label","color","order") SELECT 'PUR','Pur','#65a30d',4 WHERE NOT EXISTS (SELECT 1 FROM "ProgramType" WHERE "code"='PUR');
INSERT INTO "ProgramType" ("code","label","color","order") SELECT 'OTHER','Other','#0891b2',5 WHERE NOT EXISTS (SELECT 1 FROM "ProgramType" WHERE "code"='OTHER');
INSERT INTO "ProgramType" ("code","label","color","order") SELECT 'OUTING','Outing','#0d9488',6 WHERE NOT EXISTS (SELECT 1 FROM "ProgramType" WHERE "code"='OUTING');
INSERT INTO "ProgramType" ("code","label","color","order") SELECT 'YEP','Tiệc cuối năm (YEP)','#db2777',7 WHERE NOT EXISTS (SELECT 1 FROM "ProgramType" WHERE "code"='YEP');
-- Bảo toàn mã cũ ngoài danh mục trước khi thêm khóa ngoại.
INSERT INTO "ProgramType" ("code","label","color","active","order") SELECT DISTINCT p."type",p."type",'#71717a',false,999 FROM "Project" p WHERE NOT EXISTS (SELECT 1 FROM "ProgramType" t WHERE t."code"=p."type");

ALTER TABLE "Project" ADD CONSTRAINT "Project_type_fkey" FOREIGN KEY ("type") REFERENCES "ProgramType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_picAccountId_fkey" FOREIGN KEY ("picAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_responsibleTeamId_fkey" FOREIGN KEY ("responsibleTeamId") REFERENCES "SalesTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_potentialScoredById_fkey" FOREIGN KEY ("potentialScoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_sourceOpportunityId_fkey" FOREIGN KEY ("sourceOpportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceOpportunityId_fkey" FOREIGN KEY ("sourceOpportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_sourceOpportunityId_fkey" FOREIGN KEY ("sourceOpportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPotentialScore" ADD CONSTRAINT "ClientPotentialScore_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPotentialScore" ADD CONSTRAINT "ClientPotentialScore_scoredById_fkey" FOREIGN KEY ("scoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyingUnit" ADD CONSTRAINT "BuyingUnit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTeamManager" ADD CONSTRAINT "CrmTeamManager_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTeamManager" ADD CONSTRAINT "CrmTeamManager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramTypeAlias" ADD CONSTRAINT "ProgramTypeAlias_code_fkey" FOREIGN KEY ("code") REFERENCES "ProgramType"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_expectedEventId_fkey" FOREIGN KEY ("expectedEventId") REFERENCES "ExpectedEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_buyingUnitId_fkey" FOREIGN KEY ("buyingUnitId") REFERENCES "BuyingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_picAccountId_fkey" FOREIGN KEY ("picAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_responsibleTeamId_fkey" FOREIGN KEY ("responsibleTeamId") REFERENCES "SalesTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_outcomeReasonId_fkey" FOREIGN KEY ("outcomeReasonId") REFERENCES "CrmReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_programTypeCode_fkey" FOREIGN KEY ("programTypeCode") REFERENCES "ProgramType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageEvent" ADD CONSTRAINT "OpportunityStageEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageEvent" ADD CONSTRAINT "OpportunityStageEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityMember" ADD CONSTRAINT "OpportunityMember_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityMember" ADD CONSTRAINT "OpportunityMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedEvent" ADD CONSTRAINT "ExpectedEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedEvent" ADD CONSTRAINT "ExpectedEvent_buyingUnitId_fkey" FOREIGN KEY ("buyingUnitId") REFERENCES "BuyingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedEvent" ADD CONSTRAINT "ExpectedEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedEvent" ADD CONSTRAINT "ExpectedEvent_programTypeCode_fkey" FOREIGN KEY ("programTypeCode") REFERENCES "ProgramType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderStep" ADD CONSTRAINT "ReminderStep_expectedEventId_fkey" FOREIGN KEY ("expectedEventId") REFERENCES "ExpectedEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderStep" ADD CONSTRAINT "ReminderStep_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadenceReminder" ADD CONSTRAINT "CadenceReminder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadenceReminder" ADD CONSTRAINT "CadenceReminder_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Touchpoint" ADD CONSTRAINT "Touchpoint_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Touchpoint" ADD CONSTRAINT "Touchpoint_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Touchpoint" ADD CONSTRAINT "Touchpoint_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Touchpoint" ADD CONSTRAINT "Touchpoint_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPostpone" ADD CONSTRAINT "TaskPostpone_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPostpone" ADD CONSTRAINT "TaskPostpone_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSetting" ADD CONSTRAINT "CrmSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSettingChange" ADD CONSTRAINT "CrmSettingChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMigrationRecord" ADD CONSTRAINT "CrmMigrationRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CrmMigrationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerImportRun" ADD CONSTRAINT "TrackerImportRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerImportRow" ADD CONSTRAINT "TrackerImportRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TrackerImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerImportRow" ADD CONSTRAINT "TrackerImportRow_matchedClientId_fkey" FOREIGN KEY ("matchedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackerImportRow" ADD CONSTRAINT "TrackerImportRow_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMergeLog" ADD CONSTRAINT "ClientMergeLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Ánh xạ, cấu hình khởi tạo và ràng buộc CRM.
INSERT INTO "ProgramTypeAlias" ("alias","code") SELECT 'outing','OUTING' WHERE NOT EXISTS (SELECT 1 FROM "ProgramTypeAlias" WHERE "alias"='outing');
INSERT INTO "ProgramTypeAlias" ("alias","code") SELECT 'yep','YEP' WHERE NOT EXISTS (SELECT 1 FROM "ProgramTypeAlias" WHERE "alias"='yep');
INSERT INTO "ProgramTypeAlias" ("alias","code") SELECT 'year end party','YEP' WHERE NOT EXISTS (SELECT 1 FROM "ProgramTypeAlias" WHERE "alias"='year end party');
INSERT INTO "ProgramTypeAlias" ("alias","code") SELECT 'tiec cuoi nam','YEP' WHERE NOT EXISTS (SELECT 1 FROM "ProgramTypeAlias" WHERE "alias"='tiec cuoi nam');
INSERT INTO "ProgramTypeAlias" ("alias","code") SELECT 'team building','TEAMBUILDING' WHERE NOT EXISTS (SELECT 1 FROM "ProgramTypeAlias" WHERE "alias"='team building');
INSERT INTO "ProgramTypeAlias" ("alias","code") SELECT 'teambuilding','TEAMBUILDING' WHERE NOT EXISTS (SELECT 1 FROM "ProgramTypeAlias" WHERE "alias"='teambuilding');
INSERT INTO "ProgramTypeAlias" ("alias","code") SELECT 'mice','MICE' WHERE NOT EXISTS (SELECT 1 FROM "ProgramTypeAlias" WHERE "alias"='mice');
INSERT INTO "ProgramTypeAlias" ("alias","code") SELECT 'activation','ACTIVATION' WHERE NOT EXISTS (SELECT 1 FROM "ProgramTypeAlias" WHERE "alias"='activation');
INSERT INTO "ProgramTypeAlias" ("alias","code") SELECT 'event','EVENT' WHERE NOT EXISTS (SELECT 1 FROM "ProgramTypeAlias" WHERE "alias"='event');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_lost_1','LOST','Giá',false,0 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='LOST' AND "label"='Giá');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_lost_2','LOST','Ý tưởng',false,1 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='LOST' AND "label"='Ý tưởng');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_lost_3','LOST','Năng lực/kinh nghiệm',false,2 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='LOST' AND "label"='Năng lực/kinh nghiệm');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_lost_4','LOST','Thời gian',false,3 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='LOST' AND "label"='Thời gian');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_lost_5','LOST','Quan hệ với đối thủ',false,4 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='LOST' AND "label"='Quan hệ với đối thủ');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_lost_6','LOST','Khác',true,5 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='LOST' AND "label"='Khác');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_cancelled_1','CANCELLED','Khách dừng chương trình',false,0 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='CANCELLED' AND "label"='Khách dừng chương trình');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_cancelled_2','CANCELLED','Khách dời sang năm sau',false,1 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='CANCELLED' AND "label"='Khách dời sang năm sau');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_cancelled_3','CANCELLED','Khách tự tổ chức',false,2 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='CANCELLED' AND "label"='Khách tự tổ chức');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_cancelled_4','CANCELLED','Khác',true,3 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='CANCELLED' AND "label"='Khác');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_declined_1','DECLINED','Ngân sách quá thấp',false,0 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='DECLINED' AND "label"='Ngân sách quá thấp');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_declined_2','DECLINED','Thời gian không đủ',false,1 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='DECLINED' AND "label"='Thời gian không đủ');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_declined_3','DECLINED','Ngoài năng lực',false,2 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='DECLINED' AND "label"='Ngoài năng lực');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_declined_4','DECLINED','Rủi ro thanh toán',false,3 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='DECLINED' AND "label"='Rủi ro thanh toán');
INSERT INTO "CrmReason" ("id","group","label","requiresNote","order") SELECT 'crm_reason_declined_5','DECLINED','Khác',true,4 WHERE NOT EXISTS (SELECT 1 FROM "CrmReason" WHERE "group"='DECLINED' AND "label"='Khác');
INSERT INTO "CrmSetting" ("key","value","version","updatedAt") SELECT 'tier.cadenceWeeks','{"S":2,"A":4,"B":8,"C":13,"UNRATED":4}'::jsonb,0,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "CrmSetting" WHERE "key"='tier.cadenceWeeks');
INSERT INTO "CrmSetting" ("key","value","version","updatedAt") SELECT 'tier.potentialScale','[]'::jsonb,0,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "CrmSetting" WHERE "key"='tier.potentialScale');
INSERT INTO "CrmSetting" ("key","value","version","updatedAt") SELECT 'tier.matrix','{"revenueBands":[],"cells":{}}'::jsonb,0,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "CrmSetting" WHERE "key"='tier.matrix');
INSERT INTO "CrmSetting" ("key","value","version","updatedAt") SELECT 'reminder.offsets','{"MICE":[90,60,30],"YEP":[90,60,30],"OUTING":[60,30],"TEAMBUILDING":[60,30],"ACTIVATION":[45,21],"EVENT":[45,21]}'::jsonb,0,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "CrmSetting" WHERE "key"='reminder.offsets');
INSERT INTO "CrmSetting" ("key","value","version","updatedAt") SELECT 'review.priority','["APPOINTMENT","PLAN_CLOSE","ESCALATED","TIER"]'::jsonb,0,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "CrmSetting" WHERE "key"='review.priority');
INSERT INTO "CrmSetting" ("key","value","version","updatedAt") SELECT 'pipeline.mode','{"mode":"PROJECT_OFFICIAL","pilotTeamIds":[],"plannedCutoverDate":null}'::jsonb,0,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "CrmSetting" WHERE "key"='pipeline.mode');
INSERT INTO "CrmTeamManager" ("id","teamId","userId") SELECT 'crm_tm_' || t."id",t."id",a."userId" FROM "SalesTeam" t JOIN "Account" a ON a."id"=t."leaderId" WHERE a."userId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CrmTeamManager" m WHERE m."teamId"=t."id" AND m."userId"=a."userId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_exactly_one_owner" CHECK (num_nonnulls("projectId","opportunityId","clientId") = 1);
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_exactly_one_owner" CHECK (num_nonnulls("projectId","opportunityId","clientId") = 1);
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_at_most_one_owner" CHECK (num_nonnulls("projectId","opportunityId","clientId") <= 1);
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_stage_valid" CHECK ("stage" IN ('CARE','BRIEF','BIDDING'));
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_outcome_valid" CHECK ("outcome" IS NULL OR "outcome" IN ('WON','LOST_COMPETITIVE','CUSTOMER_CANCELLED','CS_DECLINED','LEGACY_UNCLASSIFIED'));
ALTER TABLE "Touchpoint" ADD CONSTRAINT "Touchpoint_outcome_level_range" CHECK ("outcomeLevel" IS NULL OR "outcomeLevel" BETWEEN 1 AND 4);
ALTER TABLE "Touchpoint" ADD CONSTRAINT "Touchpoint_confirmed_has_level" CHECK ("status" <> 'CONFIRMED' OR "outcomeLevel" IS NOT NULL);
ALTER TABLE "ReminderStep" ADD CONSTRAINT "ReminderStep_status_valid" CHECK ("status" IN ('PLANNED','OPEN','DONE','CLOSED','SUPERSEDED'));
ALTER TABLE "ExpectedEvent" ADD CONSTRAINT "ExpectedEvent_precision_valid" CHECK (("precision"='DAY' AND "date" IS NOT NULL) OR ("precision"='MONTH' AND "month" BETWEEN 1 AND 12 AND "month" IS NOT NULL) OR ("precision"='QUARTER' AND "quarter" BETWEEN 1 AND 4 AND "quarter" IS NOT NULL));
ALTER TABLE "Client" ADD CONSTRAINT "Client_budget_season_month_valid" CHECK ("budgetSeasonMonth" IS NULL OR "budgetSeasonMonth" BETWEEN 1 AND 12);
