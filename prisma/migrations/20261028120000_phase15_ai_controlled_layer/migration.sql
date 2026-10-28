-- Phase 15 AI persistence is an additive advisory/audit layer. It does not
-- modify approval, cash, signing, task completion, or financial-close state.

CREATE TABLE "AiSourceRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "originKind" TEXT NOT NULL,
    "originId" TEXT NOT NULL,
    "originVersion" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "authorityStatus" TEXT NOT NULL,
    "snapshotBytes" BYTEA,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSourceRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiSourceSpan" (
    "id" TEXT NOT NULL,
    "sourceRevisionId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "spanKind" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "sheetName" TEXT,
    "cellRange" TEXT,
    "xmlPath" TEXT,
    "textStart" INTEGER,
    "textEnd" INTEGER,
    "quote" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiSourceSpan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "actorId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceBundleHash" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "configVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "scopeVersion" TEXT NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiRunSource" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceRevisionId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiRunSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiCandidateField" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "aiValue" TEXT,
    "rawValue" TEXT,
    "correctedValue" TEXT,
    "manualValue" TEXT,
    "provenance" TEXT NOT NULL,
    "confidence" TEXT,
    "sourceSpanId" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCandidateField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiFinding" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ruleCode" TEXT,
    "ruleVersion" TEXT,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "sourceSpanId" TEXT,
    "ownerId" TEXT,
    "route" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionReason" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiFinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiReviewEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "candidateFieldId" TEXT,
    "findingId" TEXT,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiApplicationReceipt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetVersionBefore" TEXT NOT NULL,
    "targetVersionAfter" TEXT NOT NULL,
    "beforeHash" TEXT NOT NULL,
    "afterHash" TEXT NOT NULL,
    "fieldDecisions" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiApplicationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiKnowledgePublication" (
    "id" TEXT NOT NULL,
    "sourceRevisionId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "publicationVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "publishedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiKnowledgePublication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "sourceSpanId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiMappingAdapter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "structureFingerprint" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "confirmedRunId" TEXT NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMappingAdapter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiSourceRevision_originKind_originId_originVersion_sha256_key" ON "AiSourceRevision"("originKind", "originId", "originVersion", "sha256");
CREATE UNIQUE INDEX "AiSourceRevision_id_scopeKey_key" ON "AiSourceRevision"("id", "scopeKey");
CREATE INDEX "AiSourceRevision_projectId_authorityStatus_createdAt_idx" ON "AiSourceRevision"("projectId", "authorityStatus", "createdAt");
CREATE INDEX "AiSourceRevision_sha256_createdAt_idx" ON "AiSourceRevision"("sha256", "createdAt");
CREATE INDEX "AiSourceRevision_createdById_createdAt_idx" ON "AiSourceRevision"("createdById", "createdAt");

CREATE UNIQUE INDEX "AiSourceSpan_sourceRevisionId_contentHash_key" ON "AiSourceSpan"("sourceRevisionId", "contentHash");
CREATE UNIQUE INDEX "AiSourceSpan_id_scopeKey_key" ON "AiSourceSpan"("id", "scopeKey");
CREATE INDEX "AiSourceSpan_sourceRevisionId_spanKind_idx" ON "AiSourceSpan"("sourceRevisionId", "spanKind");
CREATE INDEX "AiSourceSpan_contentHash_idx" ON "AiSourceSpan"("contentHash");

CREATE UNIQUE INDEX "AiRun_scopeKey_runType_idempotencyKey_key" ON "AiRun"("scopeKey", "runType", "idempotencyKey");
CREATE UNIQUE INDEX "AiRun_id_scopeKey_key" ON "AiRun"("id", "scopeKey");
CREATE INDEX "AiRun_projectId_status_createdAt_idx" ON "AiRun"("projectId", "status", "createdAt");
CREATE INDEX "AiRun_actorId_status_createdAt_idx" ON "AiRun"("actorId", "status", "createdAt");
CREATE INDEX "AiRun_sourceBundleHash_configVersion_idx" ON "AiRun"("sourceBundleHash", "configVersion");
CREATE INDEX "AiRun_scopeHash_createdAt_idx" ON "AiRun"("scopeHash", "createdAt");

CREATE UNIQUE INDEX "AiRunSource_runId_sourceRevisionId_role_key" ON "AiRunSource"("runId", "sourceRevisionId", "role");
CREATE INDEX "AiRunSource_sourceRevisionId_role_idx" ON "AiRunSource"("sourceRevisionId", "role");
CREATE INDEX "AiRunSource_scopeKey_createdAt_idx" ON "AiRunSource"("scopeKey", "createdAt");

CREATE UNIQUE INDEX "AiCandidateField_runId_rowKey_fieldKey_key" ON "AiCandidateField"("runId", "rowKey", "fieldKey");
CREATE UNIQUE INDEX "AiCandidateField_id_scopeKey_key" ON "AiCandidateField"("id", "scopeKey");
CREATE INDEX "AiCandidateField_runId_reviewStatus_createdAt_idx" ON "AiCandidateField"("runId", "reviewStatus", "createdAt");
CREATE INDEX "AiCandidateField_reviewedById_reviewedAt_idx" ON "AiCandidateField"("reviewedById", "reviewedAt");
CREATE INDEX "AiCandidateField_sourceSpanId_idx" ON "AiCandidateField"("sourceSpanId");

CREATE UNIQUE INDEX "AiFinding_id_scopeKey_key" ON "AiFinding"("id", "scopeKey");
CREATE INDEX "AiFinding_projectId_status_createdAt_idx" ON "AiFinding"("projectId", "status", "createdAt");
CREATE INDEX "AiFinding_ownerId_status_createdAt_idx" ON "AiFinding"("ownerId", "status", "createdAt");
CREATE INDEX "AiFinding_runId_kind_createdAt_idx" ON "AiFinding"("runId", "kind", "createdAt");
CREATE INDEX "AiFinding_sourceSpanId_idx" ON "AiFinding"("sourceSpanId");

CREATE INDEX "AiReviewEvent_runId_targetKind_targetId_createdAt_idx" ON "AiReviewEvent"("runId", "targetKind", "targetId", "createdAt");
CREATE INDEX "AiReviewEvent_candidateFieldId_createdAt_idx" ON "AiReviewEvent"("candidateFieldId", "createdAt");
CREATE INDEX "AiReviewEvent_findingId_createdAt_idx" ON "AiReviewEvent"("findingId", "createdAt");
CREATE INDEX "AiReviewEvent_actorId_createdAt_idx" ON "AiReviewEvent"("actorId", "createdAt");

CREATE UNIQUE INDEX "AiApplicationReceipt_scopeKey_idempotencyKey_key" ON "AiApplicationReceipt"("scopeKey", "idempotencyKey");
CREATE INDEX "AiApplicationReceipt_runId_targetKind_targetId_createdAt_idx" ON "AiApplicationReceipt"("runId", "targetKind", "targetId", "createdAt");
CREATE INDEX "AiApplicationReceipt_actorId_createdAt_idx" ON "AiApplicationReceipt"("actorId", "createdAt");

CREATE UNIQUE INDEX "AiKnowledgePublication_supersedesId_key" ON "AiKnowledgePublication"("supersedesId");
CREATE UNIQUE INDEX "AiKnowledgePublication_sourceRevisionId_publicationVersion_key" ON "AiKnowledgePublication"("sourceRevisionId", "publicationVersion");
CREATE UNIQUE INDEX "AiKnowledgePublication_id_scopeKey_key" ON "AiKnowledgePublication"("id", "scopeKey");
CREATE INDEX "AiKnowledgePublication_status_effectiveFrom_effectiveTo_idx" ON "AiKnowledgePublication"("status", "effectiveFrom", "effectiveTo");
CREATE INDEX "AiKnowledgePublication_publishedById_publishedAt_idx" ON "AiKnowledgePublication"("publishedById", "publishedAt");

CREATE UNIQUE INDEX "AiKnowledgeChunk_publicationId_chunkIndex_key" ON "AiKnowledgeChunk"("publicationId", "chunkIndex");
CREATE INDEX "AiKnowledgeChunk_sourceSpanId_idx" ON "AiKnowledgeChunk"("sourceSpanId");
CREATE INDEX "AiKnowledgeChunk_contentHash_idx" ON "AiKnowledgeChunk"("contentHash");

CREATE UNIQUE INDEX "AiMappingAdapter_supersedesId_key" ON "AiMappingAdapter"("supersedesId");
CREATE UNIQUE INDEX "AiMappingAdapter_structureFingerprint_adapterVersion_key" ON "AiMappingAdapter"("structureFingerprint", "adapterVersion");
CREATE UNIQUE INDEX "AiMappingAdapter_id_scopeKey_key" ON "AiMappingAdapter"("id", "scopeKey");
CREATE INDEX "AiMappingAdapter_projectId_status_createdAt_idx" ON "AiMappingAdapter"("projectId", "status", "createdAt");
CREATE INDEX "AiMappingAdapter_confirmedById_createdAt_idx" ON "AiMappingAdapter"("confirmedById", "createdAt");
CREATE INDEX "AiMappingAdapter_confirmedRunId_idx" ON "AiMappingAdapter"("confirmedRunId");

ALTER TABLE "AiSourceRevision" ADD CONSTRAINT "AiSourceRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiSourceRevision" ADD CONSTRAINT "AiSourceRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiSourceSpan" ADD CONSTRAINT "AiSourceSpan_sourceRevisionId_scopeKey_fkey" FOREIGN KEY ("sourceRevisionId", "scopeKey") REFERENCES "AiSourceRevision"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiRunSource" ADD CONSTRAINT "AiRunSource_runId_scopeKey_fkey" FOREIGN KEY ("runId", "scopeKey") REFERENCES "AiRun"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiRunSource" ADD CONSTRAINT "AiRunSource_sourceRevisionId_scopeKey_fkey" FOREIGN KEY ("sourceRevisionId", "scopeKey") REFERENCES "AiSourceRevision"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiCandidateField" ADD CONSTRAINT "AiCandidateField_runId_scopeKey_fkey" FOREIGN KEY ("runId", "scopeKey") REFERENCES "AiRun"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiCandidateField" ADD CONSTRAINT "AiCandidateField_sourceSpanId_scopeKey_fkey" FOREIGN KEY ("sourceSpanId", "scopeKey") REFERENCES "AiSourceSpan"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiCandidateField" ADD CONSTRAINT "AiCandidateField_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiFinding" ADD CONSTRAINT "AiFinding_runId_scopeKey_fkey" FOREIGN KEY ("runId", "scopeKey") REFERENCES "AiRun"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiFinding" ADD CONSTRAINT "AiFinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiFinding" ADD CONSTRAINT "AiFinding_sourceSpanId_scopeKey_fkey" FOREIGN KEY ("sourceSpanId", "scopeKey") REFERENCES "AiSourceSpan"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiFinding" ADD CONSTRAINT "AiFinding_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiFinding" ADD CONSTRAINT "AiFinding_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiReviewEvent" ADD CONSTRAINT "AiReviewEvent_runId_scopeKey_fkey" FOREIGN KEY ("runId", "scopeKey") REFERENCES "AiRun"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiReviewEvent" ADD CONSTRAINT "AiReviewEvent_candidateFieldId_scopeKey_fkey" FOREIGN KEY ("candidateFieldId", "scopeKey") REFERENCES "AiCandidateField"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiReviewEvent" ADD CONSTRAINT "AiReviewEvent_findingId_scopeKey_fkey" FOREIGN KEY ("findingId", "scopeKey") REFERENCES "AiFinding"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiReviewEvent" ADD CONSTRAINT "AiReviewEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApplicationReceipt" ADD CONSTRAINT "AiApplicationReceipt_runId_scopeKey_fkey" FOREIGN KEY ("runId", "scopeKey") REFERENCES "AiRun"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiApplicationReceipt" ADD CONSTRAINT "AiApplicationReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiKnowledgePublication" ADD CONSTRAINT "AiKnowledgePublication_sourceRevisionId_scopeKey_fkey" FOREIGN KEY ("sourceRevisionId", "scopeKey") REFERENCES "AiSourceRevision"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiKnowledgePublication" ADD CONSTRAINT "AiKnowledgePublication_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiKnowledgePublication" ADD CONSTRAINT "AiKnowledgePublication_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "AiKnowledgePublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiKnowledgeChunk" ADD CONSTRAINT "AiKnowledgeChunk_publicationId_scopeKey_fkey" FOREIGN KEY ("publicationId", "scopeKey") REFERENCES "AiKnowledgePublication"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiKnowledgeChunk" ADD CONSTRAINT "AiKnowledgeChunk_sourceSpanId_scopeKey_fkey" FOREIGN KEY ("sourceSpanId", "scopeKey") REFERENCES "AiSourceSpan"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiMappingAdapter" ADD CONSTRAINT "AiMappingAdapter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiMappingAdapter" ADD CONSTRAINT "AiMappingAdapter_confirmedRunId_scopeKey_fkey" FOREIGN KEY ("confirmedRunId", "scopeKey") REFERENCES "AiRun"("id", "scopeKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiMappingAdapter" ADD CONSTRAINT "AiMappingAdapter_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiMappingAdapter" ADD CONSTRAINT "AiMappingAdapter_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "AiMappingAdapter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
