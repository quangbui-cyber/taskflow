-- AlterTable
ALTER TABLE "FinanceSheet" ADD COLUMN     "icApprovedAt" TIMESTAMP(3),
ADD COLUMN     "icApprovedById" TEXT,
ADD COLUMN     "icCcUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "icEmailMessageId" TEXT,
ADD COLUMN     "icRejectReason" TEXT,
ADD COLUMN     "icSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "icSubmittedById" TEXT;

-- CreateTable
CREATE TABLE "FinanceApprovalEvent" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'IC',
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "selfApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceApprovalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceApprovalEvent_sheetId_createdAt_idx" ON "FinanceApprovalEvent"("sheetId", "createdAt");

-- CreateIndex
CREATE INDEX "FinanceApprovalEvent_actorId_idx" ON "FinanceApprovalEvent"("actorId");

-- CreateIndex
CREATE INDEX "FinanceSheet_icSubmittedById_idx" ON "FinanceSheet"("icSubmittedById");

-- CreateIndex
CREATE INDEX "FinanceSheet_icApprovedById_idx" ON "FinanceSheet"("icApprovedById");

-- AddForeignKey
ALTER TABLE "FinanceSheet" ADD CONSTRAINT "FinanceSheet_icSubmittedById_fkey" FOREIGN KEY ("icSubmittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSheet" ADD CONSTRAINT "FinanceSheet_icApprovedById_fkey" FOREIGN KEY ("icApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceApprovalEvent" ADD CONSTRAINT "FinanceApprovalEvent_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "FinanceSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceApprovalEvent" ADD CONSTRAINT "FinanceApprovalEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

