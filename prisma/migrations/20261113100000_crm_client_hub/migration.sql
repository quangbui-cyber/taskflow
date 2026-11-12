-- crm53: client hub (playbook, project feedback). Additive only.
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "approvalFlow" TEXT,
ADD COLUMN     "brandDonts" TEXT,
ADD COLUMN     "brandDos" TEXT,
ADD COLUMN     "brandGuidelineUrl" TEXT,
ADD COLUMN     "executionNotes" TEXT,
ADD COLUMN     "frameworkContractUntil" TIMESTAMP(3),
ADD COLUMN     "invoiceNotes" TEXT,
ADD COLUMN     "paymentPractice" TEXT,
ADD COLUMN     "paymentTermsText" TEXT,
ADD COLUMN     "quotesRequired" INTEGER,
ADD COLUMN     "vendorRegisteredUntil" TIMESTAMP(3),
ADD COLUMN     "vendorStatus" TEXT;

-- CreateTable
CREATE TABLE "ClientPlaybookUpdate" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ClientPlaybookUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFeedback" (
    "id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "note" TEXT,
    "caseStudy" TEXT NOT NULL DEFAULT 'NOT_ASKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "ProjectFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientPlaybookUpdate_clientId_section_key" ON "ClientPlaybookUpdate"("clientId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFeedback_projectId_key" ON "ProjectFeedback"("projectId");

-- AddForeignKey
ALTER TABLE "ClientPlaybookUpdate" ADD CONSTRAINT "ClientPlaybookUpdate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPlaybookUpdate" ADD CONSTRAINT "ClientPlaybookUpdate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeedback" ADD CONSTRAINT "ProjectFeedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFeedback" ADD CONSTRAINT "ProjectFeedback_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Guard values the app already validates.
ALTER TABLE "Client" ADD CONSTRAINT "Client_vendorStatus_check" CHECK ("vendorStatus" IS NULL OR "vendorStatus" IN ('NOT_REGISTERED', 'IN_PROGRESS', 'REGISTERED', 'EXPIRED'));
ALTER TABLE "Client" ADD CONSTRAINT "Client_quotesRequired_check" CHECK ("quotesRequired" IS NULL OR "quotesRequired" BETWEEN 1 AND 20);
ALTER TABLE "ClientPlaybookUpdate" ADD CONSTRAINT "ClientPlaybookUpdate_section_check" CHECK ("section" IN ('PROCUREMENT', 'PAYMENT', 'BRAND', 'EXECUTION'));
ALTER TABLE "ProjectFeedback" ADD CONSTRAINT "ProjectFeedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "ProjectFeedback" ADD CONSTRAINT "ProjectFeedback_caseStudy_check" CHECK ("caseStudy" IN ('ALLOWED', 'NOT_ASKED', 'DENIED'));
ALTER TABLE "ProjectFeedback" ADD CONSTRAINT "ProjectFeedback_note_length_check" CHECK ("note" IS NULL OR char_length("note") <= 1000);
