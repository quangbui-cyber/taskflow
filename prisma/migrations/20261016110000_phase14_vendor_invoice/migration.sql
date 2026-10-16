CREATE TABLE "VendorInvoice" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierVersionId" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "bankAccountVersionId" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "sellerTaxCode" TEXT NOT NULL,
  "netAmount" TEXT NOT NULL,
  "vatAmount" TEXT NOT NULL,
  "grossAmount" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'DRAFT',
  "sourceSnapshot" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  CONSTRAINT "VendorInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorInvoice_amounts_check" CHECK ("netAmount" ~ '^\\d+$' AND "vatAmount" ~ '^\\d+$' AND "grossAmount" ~ '^\\d+$')
);

CREATE TABLE "VendorInvoiceFile" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "sha256" TEXT NOT NULL,
  "metadataHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorInvoiceFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorInvoiceFile_format_check" CHECK ("format" IN ('XML', 'PDF'))
);

CREATE TABLE "VendorInvoiceActualCost" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "actualCostLineId" TEXT NOT NULL,
  "actualCostVersionId" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "approvalAttemptId" TEXT NOT NULL,
  "stableLineId" TEXT NOT NULL,
  "icRevisionId" TEXT,
  "icLineId" TEXT,
  "recipientKey" TEXT NOT NULL,
  "approvedAmount" TEXT NOT NULL,
  "allocatedAmount" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorInvoiceActualCost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VendorInvoiceApplication" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "invoiceActualCostId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "paymentLineId" TEXT,
  "amount" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  "idempotencyKey" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "VendorInvoiceApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorInvoice_businessKey_key" ON "VendorInvoice"("businessKey");
CREATE INDEX "VendorInvoice_projectId_state_createdAt_idx" ON "VendorInvoice"("projectId", "state", "createdAt");
CREATE INDEX "VendorInvoice_supplierId_supplierVersionId_bankAccountVersionId_idx" ON "VendorInvoice"("supplierId", "supplierVersionId", "bankAccountVersionId");
CREATE UNIQUE INDEX "VendorInvoiceFile_invoiceId_format_key" ON "VendorInvoiceFile"("invoiceId", "format");
CREATE INDEX "VendorInvoiceFile_sha256_idx" ON "VendorInvoiceFile"("sha256");
CREATE UNIQUE INDEX "VendorInvoiceActualCost_invoiceId_actualCostVersionId_approvalId_key" ON "VendorInvoiceActualCost"("invoiceId", "actualCostVersionId", "approvalId");
CREATE INDEX "VendorInvoiceActualCost_projectId_actualCostVersionId_approvalId_idx" ON "VendorInvoiceActualCost"("projectId", "actualCostVersionId", "approvalId");
CREATE INDEX "VendorInvoiceActualCost_icRevisionId_icLineId_idx" ON "VendorInvoiceActualCost"("icRevisionId", "icLineId");
CREATE UNIQUE INDEX "VendorInvoiceApplication_idempotencyKey_key" ON "VendorInvoiceApplication"("idempotencyKey");
CREATE UNIQUE INDEX "VendorInvoiceApplication_requestId_invoiceActualCostId_key" ON "VendorInvoiceApplication"("requestId", "invoiceActualCostId");
CREATE INDEX "VendorInvoiceApplication_projectId_requestId_state_idx" ON "VendorInvoiceApplication"("projectId", "requestId", "state");
CREATE INDEX "VendorInvoiceApplication_invoiceId_state_idx" ON "VendorInvoiceApplication"("invoiceId", "state");

ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_supplierVersion_fkey" FOREIGN KEY ("supplierVersionId", "supplierId") REFERENCES "SupplierVersion"("id", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_bankVersion_fkey" FOREIGN KEY ("bankAccountVersionId", "bankAccountId", "supplierId") REFERENCES "SupplierBankAccountVersion"("id", "bankAccountId", "supplierId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceFile" ADD CONSTRAINT "VendorInvoiceFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "VendorInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceFile" ADD CONSTRAINT "VendorInvoiceFile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceActualCost" ADD CONSTRAINT "VendorInvoiceActualCost_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "VendorInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceActualCost" ADD CONSTRAINT "VendorInvoiceActualCost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceActualCost" ADD CONSTRAINT "VendorInvoiceActualCost_actualCostLineId_fkey" FOREIGN KEY ("actualCostLineId") REFERENCES "ActualCostLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceActualCost" ADD CONSTRAINT "VendorInvoiceActualCost_actualCostVersionId_fkey" FOREIGN KEY ("actualCostVersionId") REFERENCES "ActualCostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceActualCost" ADD CONSTRAINT "VendorInvoiceActualCost_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ActualCostApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceApplication" ADD CONSTRAINT "VendorInvoiceApplication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "VendorInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceApplication" ADD CONSTRAINT "VendorInvoiceApplication_invoiceActualCostId_fkey" FOREIGN KEY ("invoiceActualCostId") REFERENCES "VendorInvoiceActualCost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceApplication" ADD CONSTRAINT "VendorInvoiceApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceApplication" ADD CONSTRAINT "VendorInvoiceApplication_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorInvoiceApplication" ADD CONSTRAINT "VendorInvoiceApplication_paymentLineId_fkey" FOREIGN KEY ("paymentLineId") REFERENCES "PaymentRequestLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
