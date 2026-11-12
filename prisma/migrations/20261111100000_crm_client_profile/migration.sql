-- crm50: hồ sơ khách sâu hơn (Đợt A). Chỉ cộng thêm cột/bảng, không sửa hay xóa dữ liệu cũ.
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "acquisitionSource" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "archivedReason" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "parentClientId" TEXT,
ADD COLUMN     "referredBy" TEXT,
ADD COLUMN     "shortName" TEXT,
ADD COLUMN     "taxCode" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "ClientAlias" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "ClientAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientTag" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientTagLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ClientTagLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientCompetitor" (
    "id" TEXT NOT NULL,
    "note" TEXT,
    "since" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,

    CONSTRAINT "ClientCompetitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityCompetitor" (
    "id" TEXT NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opportunityId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,

    CONSTRAINT "OpportunityCompetitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFieldChange" (
    "id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT NOT NULL,
    "actorId" TEXT,

    CONSTRAINT "ClientFieldChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAlias_key_key" ON "ClientAlias"("key");

-- CreateIndex
CREATE INDEX "ClientAlias_clientId_idx" ON "ClientAlias"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTag_label_key" ON "ClientTag"("label");

-- CreateIndex
CREATE INDEX "ClientTagLink_tagId_idx" ON "ClientTagLink"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTagLink_clientId_tagId_key" ON "ClientTagLink"("clientId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_name_key" ON "Competitor"("name");

-- CreateIndex
CREATE INDEX "ClientCompetitor_competitorId_idx" ON "ClientCompetitor"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCompetitor_clientId_competitorId_key" ON "ClientCompetitor"("clientId", "competitorId");

-- CreateIndex
CREATE INDEX "OpportunityCompetitor_competitorId_idx" ON "OpportunityCompetitor"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityCompetitor_opportunityId_competitorId_key" ON "OpportunityCompetitor"("opportunityId", "competitorId");

-- CreateIndex
CREATE INDEX "ClientFieldChange_clientId_createdAt_idx" ON "ClientFieldChange"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Client_taxCode_key" ON "Client"("taxCode");

-- CreateIndex
CREATE INDEX "Client_parentClientId_idx" ON "Client"("parentClientId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_parentClientId_fkey" FOREIGN KEY ("parentClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAlias" ADD CONSTRAINT "ClientAlias_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTagLink" ADD CONSTRAINT "ClientTagLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTagLink" ADD CONSTRAINT "ClientTagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ClientTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCompetitor" ADD CONSTRAINT "ClientCompetitor_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCompetitor" ADD CONSTRAINT "ClientCompetitor_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityCompetitor" ADD CONSTRAINT "OpportunityCompetitor_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityCompetitor" ADD CONSTRAINT "OpportunityCompetitor_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFieldChange" ADD CONSTRAINT "ClientFieldChange_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFieldChange" ADD CONSTRAINT "ClientFieldChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

