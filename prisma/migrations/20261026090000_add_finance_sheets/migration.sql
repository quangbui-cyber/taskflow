-- CreateTable
CREATE TABLE "FinanceSheet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "icStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "acStatus" TEXT NOT NULL DEFAULT 'NONE',
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "clientName" TEXT,
    "programName" TEXT,
    "headcount" TEXT,
    "location" TEXT,
    "eventStart" TIMESTAMP(3),
    "eventEnd" TIMESTAMP(3),
    "sellVatRate" DECIMAL(5,4) NOT NULL DEFAULT 0.08,
    "sellSubtotal" DECIMAL(18,0) NOT NULL DEFAULT 0,
    "icCostSubtotal" DECIMAL(18,0) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSection" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FinanceSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellLine" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "stt" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "quantity" DECIMAL(14,3),
    "unitPrice" DECIMAL(18,2),
    "note" TEXT,
    "acceptedQuantity" DECIMAL(14,3),
    "acceptedUnitPrice" DECIMAL(18,2),
    "acceptedNote" TEXT,

    CONSTRAINT "SellLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostLine" (
    "id" TEXT NOT NULL,
    "sellLineId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "icQuantity" DECIMAL(14,3),
    "icUnitPrice" DECIMAL(18,2),
    "icVatRate" DECIMAL(5,4),
    "icSupplierId" TEXT,
    "icNote" TEXT,
    "acQuantity" DECIMAL(14,3),
    "acUnitPrice" DECIMAL(18,2),
    "acVatRate" DECIMAL(5,4),
    "acSupplierId" TEXT,
    "acNote" TEXT,
    "addedInAc" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CostLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceSheet_createdById_idx" ON "FinanceSheet"("createdById");

-- CreateIndex
CREATE INDEX "FinanceSheet_updatedById_idx" ON "FinanceSheet"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSheet_projectId_version_key" ON "FinanceSheet"("projectId", "version");

-- CreateIndex
CREATE INDEX "FinanceSection_sheetId_order_idx" ON "FinanceSection"("sheetId", "order");

-- CreateIndex
CREATE INDEX "SellLine_sectionId_order_idx" ON "SellLine"("sectionId", "order");

-- CreateIndex
CREATE INDEX "CostLine_sellLineId_order_idx" ON "CostLine"("sellLineId", "order");

-- CreateIndex
CREATE INDEX "CostLine_icSupplierId_idx" ON "CostLine"("icSupplierId");

-- CreateIndex
CREATE INDEX "CostLine_acSupplierId_idx" ON "CostLine"("acSupplierId");

-- AddForeignKey
ALTER TABLE "FinanceSheet" ADD CONSTRAINT "FinanceSheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSheet" ADD CONSTRAINT "FinanceSheet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSheet" ADD CONSTRAINT "FinanceSheet_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceSection" ADD CONSTRAINT "FinanceSection_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "FinanceSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellLine" ADD CONSTRAINT "SellLine_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "FinanceSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_sellLineId_fkey" FOREIGN KEY ("sellLineId") REFERENCES "SellLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_icSupplierId_fkey" FOREIGN KEY ("icSupplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLine" ADD CONSTRAINT "CostLine_acSupplierId_fkey" FOREIGN KEY ("acSupplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

