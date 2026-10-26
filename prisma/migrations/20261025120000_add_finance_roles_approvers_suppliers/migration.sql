-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "acApproverId" TEXT,
ADD COLUMN     "icApproverId" TEXT;

-- CreateTable
CREATE TABLE "FinanceSupplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'COMPANY',
    "taxCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "bankAccount" TEXT,
    "bankName" TEXT,
    "accountHolder" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSupplier_name_key" ON "FinanceSupplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSupplier_shortName_key" ON "FinanceSupplier"("shortName");

-- CreateIndex
CREATE INDEX "FinanceSupplier_createdById_idx" ON "FinanceSupplier"("createdById");

-- CreateIndex
CREATE INDEX "FinanceSupplier_updatedById_idx" ON "FinanceSupplier"("updatedById");

-- CreateIndex
CREATE INDEX "Project_icApproverId_idx" ON "Project"("icApproverId");

-- CreateIndex
CREATE INDEX "Project_acApproverId_idx" ON "Project"("acApproverId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_icApproverId_fkey" FOREIGN KEY ("icApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_acApproverId_fkey" FOREIGN KEY ("acApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSupplier" ADD CONSTRAINT "FinanceSupplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSupplier" ADD CONSTRAINT "FinanceSupplier_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

