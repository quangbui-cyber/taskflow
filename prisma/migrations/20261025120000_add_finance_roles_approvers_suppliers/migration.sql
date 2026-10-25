-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "acApproverId" TEXT,
ADD COLUMN     "icApproverId" TEXT;

-- CreateTable
CREATE TABLE "Supplier" (
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

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_shortName_key" ON "Supplier"("shortName");

-- CreateIndex
CREATE INDEX "Supplier_createdById_idx" ON "Supplier"("createdById");

-- CreateIndex
CREATE INDEX "Supplier_updatedById_idx" ON "Supplier"("updatedById");

-- CreateIndex
CREATE INDEX "Project_icApproverId_idx" ON "Project"("icApproverId");

-- CreateIndex
CREATE INDEX "Project_acApproverId_idx" ON "Project"("acApproverId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_icApproverId_fkey" FOREIGN KEY ("icApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_acApproverId_fkey" FOREIGN KEY ("acApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

