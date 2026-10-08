ALTER TABLE "CostFlowCash"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "commandFingerprint" TEXT,
  ADD COLUMN "channel" TEXT;

UPDATE "CostFlowCash"
SET
  "idempotencyKey" = 'legacy:' || "id",
  "commandFingerprint" = 'legacy:' || "id",
  "channel" = 'LEGACY'
WHERE "idempotencyKey" IS NULL
   OR "commandFingerprint" IS NULL
   OR "channel" IS NULL;

ALTER TABLE "CostFlowCash"
  ALTER COLUMN "idempotencyKey" SET NOT NULL,
  ALTER COLUMN "idempotencyKey" SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN "commandFingerprint" SET NOT NULL,
  ALTER COLUMN "commandFingerprint" SET DEFAULT 'LEGACY',
  ALTER COLUMN "channel" SET NOT NULL,
  ALTER COLUMN "channel" SET DEFAULT 'LEGACY';

CREATE TABLE "PaymentRecipientSnapshot" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "recipientType" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "bankName" TEXT,
  "accountLast4" TEXT,
  "sourceVersion" INTEGER,
  "totalAmount" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRecipientSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentRequestLine" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "icRevisionId" TEXT NOT NULL,
  "icLineId" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "evidenceManifest" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRequestLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostFlowCashAllocation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "cashId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestLineId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostFlowCashAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentLineDiscussion" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentLineDiscussion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdvanceApplication" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "advanceRequestId" TEXT NOT NULL,
  "advanceLineId" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdvanceApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostFlowCash_projectId_idempotencyKey_key" ON "CostFlowCash"("projectId", "idempotencyKey");
CREATE INDEX "CostFlowCash_projectId_requestId_recipientKey_direction_idx" ON "CostFlowCash"("projectId", "requestId", "recipientKey", "direction");

CREATE UNIQUE INDEX "PaymentRecipientSnapshot_requestId_recipientKey_key" ON "PaymentRecipientSnapshot"("requestId", "recipientKey");
CREATE INDEX "PaymentRecipientSnapshot_projectId_requestId_idx" ON "PaymentRecipientSnapshot"("projectId", "requestId");

CREATE UNIQUE INDEX "PaymentRequestLine_requestId_stableKey_key" ON "PaymentRequestLine"("requestId", "stableKey");
CREATE INDEX "PaymentRequestLine_projectId_requestId_idx" ON "PaymentRequestLine"("projectId", "requestId");
CREATE INDEX "PaymentRequestLine_icRevisionId_icLineId_idx" ON "PaymentRequestLine"("icRevisionId", "icLineId");
CREATE INDEX "PaymentRequestLine_requestId_recipientKey_idx" ON "PaymentRequestLine"("requestId", "recipientKey");

CREATE UNIQUE INDEX "CostFlowCashAllocation_cashId_requestLineId_key" ON "CostFlowCashAllocation"("cashId", "requestLineId");
CREATE INDEX "CostFlowCashAllocation_projectId_requestId_recipientKey_direction_idx" ON "CostFlowCashAllocation"("projectId", "requestId", "recipientKey", "direction");
CREATE INDEX "CostFlowCashAllocation_requestLineId_direction_idx" ON "CostFlowCashAllocation"("requestLineId", "direction");

CREATE INDEX "PaymentLineDiscussion_requestId_lineId_createdAt_idx" ON "PaymentLineDiscussion"("requestId", "lineId", "createdAt");
CREATE INDEX "PaymentLineDiscussion_authorId_createdAt_idx" ON "PaymentLineDiscussion"("authorId", "createdAt");

CREATE UNIQUE INDEX "AdvanceApplication_advanceLineId_expenseId_key" ON "AdvanceApplication"("advanceLineId", "expenseId");
CREATE INDEX "AdvanceApplication_projectId_recipientKey_idx" ON "AdvanceApplication"("projectId", "recipientKey");
CREATE INDEX "AdvanceApplication_advanceRequestId_createdAt_idx" ON "AdvanceApplication"("advanceRequestId", "createdAt");
CREATE INDEX "AdvanceApplication_expenseId_idx" ON "AdvanceApplication"("expenseId");

ALTER TABLE "PaymentRecipientSnapshot" ADD CONSTRAINT "PaymentRecipientSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRecipientSnapshot" ADD CONSTRAINT "PaymentRecipientSnapshot_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRequestLine" ADD CONSTRAINT "PaymentRequestLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRequestLine" ADD CONSTRAINT "PaymentRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRequestLine" ADD CONSTRAINT "PaymentRequestLine_requestId_recipientKey_fkey" FOREIGN KEY ("requestId", "recipientKey") REFERENCES "PaymentRecipientSnapshot"("requestId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CostFlowCashAllocation" ADD CONSTRAINT "CostFlowCashAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostFlowCashAllocation" ADD CONSTRAINT "CostFlowCashAllocation_cashId_fkey" FOREIGN KEY ("cashId") REFERENCES "CostFlowCash"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostFlowCashAllocation" ADD CONSTRAINT "CostFlowCashAllocation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostFlowCashAllocation" ADD CONSTRAINT "CostFlowCashAllocation_requestLineId_fkey" FOREIGN KEY ("requestLineId") REFERENCES "PaymentRequestLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentLineDiscussion" ADD CONSTRAINT "PaymentLineDiscussion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentLineDiscussion" ADD CONSTRAINT "PaymentLineDiscussion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentLineDiscussion" ADD CONSTRAINT "PaymentLineDiscussion_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PaymentRequestLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentLineDiscussion" ADD CONSTRAINT "PaymentLineDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_advanceRequestId_fkey" FOREIGN KEY ("advanceRequestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdvanceApplication" ADD CONSTRAINT "AdvanceApplication_advanceLineId_fkey" FOREIGN KEY ("advanceLineId") REFERENCES "PaymentRequestLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
