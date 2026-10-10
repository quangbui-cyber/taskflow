-- Phase 9 WF-04: immutable approved snapshot and signing evidence foundation.
CREATE TABLE "WorkflowApprovedSnapshot" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "mode" TEXT NOT NULL, "evidenceState" TEXT NOT NULL, "projection" JSONB NOT NULL,
  "projectionSha256" TEXT NOT NULL, "attestationKeyId" TEXT NOT NULL, "attestation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowApprovedSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowApprovedSnapshot_mode_check" CHECK ("mode" IN ('DIGITAL','PHYSICAL')),
  CONSTRAINT "WorkflowApprovedSnapshot_evidence_check" CHECK (("mode"='DIGITAL' AND "evidenceState" IN ('CHO_KY','DIGITAL_CONFIRMED')) OR ("mode"='PHYSICAL' AND "evidenceState" IN ('PENDING','RETURNED','PHYSICAL_CONFIRMED')))
);
CREATE TABLE "WorkflowSigningEvent" (
  "id" TEXT NOT NULL, "snapshotId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "role" TEXT NOT NULL, "actorId" TEXT NOT NULL, "signaturePngData" BYTEA NOT NULL,
  "signatureImageSha256" TEXT NOT NULL, "legalCommitment" BOOLEAN NOT NULL DEFAULT true,
  "previousEventHash" TEXT, "eventHash" TEXT NOT NULL, "pinVerified" BOOLEAN NOT NULL DEFAULT true,
  "signerIpNormalized" TEXT, "signerIpSource" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowSigningEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowSigningEvent_ip_source_check" CHECK ("signerIpSource" IN ('DIRECT','TRUSTED_PROXY','UNAVAILABLE'))
);
CREATE TABLE "WorkflowSigningLifecycle" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "snapshotId" TEXT,
  "mode" TEXT NOT NULL, "evidenceState" TEXT NOT NULL, "expectedVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowSigningLifecycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowSigningLifecycle_mode_check" CHECK ("mode" IN ('DIGITAL','PHYSICAL')),
  CONSTRAINT "WorkflowSigningLifecycle_evidence_check" CHECK (("mode"='DIGITAL' AND "evidenceState" IN ('CHO_KY','DIGITAL_CONFIRMED')) OR ("mode"='PHYSICAL' AND "evidenceState" IN ('PENDING','RETURNED','PHYSICAL_CONFIRMED')))
);
CREATE TABLE "WorkflowSigningCommand" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "commandKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL, "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowSigningCommand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkflowApprovedSnapshot_requestId_version_key" ON "WorkflowApprovedSnapshot"("requestId","version");
CREATE INDEX "WorkflowApprovedSnapshot_projectionSha256_idx" ON "WorkflowApprovedSnapshot"("projectionSha256");
CREATE INDEX "WorkflowApprovedSnapshot_attestationKeyId_idx" ON "WorkflowApprovedSnapshot"("attestationKeyId");
CREATE UNIQUE INDEX "WorkflowSigningEvent_snapshotId_role_key" ON "WorkflowSigningEvent"("snapshotId","role");
CREATE INDEX "WorkflowSigningEvent_requestId_version_signedAt_idx" ON "WorkflowSigningEvent"("requestId","version","signedAt");
CREATE INDEX "WorkflowSigningEvent_actorId_signedAt_idx" ON "WorkflowSigningEvent"("actorId","signedAt");
CREATE INDEX "WorkflowSigningEvent_eventHash_idx" ON "WorkflowSigningEvent"("eventHash");
CREATE UNIQUE INDEX "WorkflowSigningLifecycle_requestId_key" ON "WorkflowSigningLifecycle"("requestId");
CREATE INDEX "WorkflowSigningLifecycle_snapshotId_idx" ON "WorkflowSigningLifecycle"("snapshotId");
CREATE INDEX "WorkflowSigningLifecycle_mode_evidenceState_idx" ON "WorkflowSigningLifecycle"("mode","evidenceState");
CREATE UNIQUE INDEX "WorkflowSigningCommand_requestId_commandKey_key" ON "WorkflowSigningCommand"("requestId","commandKey");
CREATE INDEX "WorkflowSigningCommand_requestId_fingerprint_idx" ON "WorkflowSigningCommand"("requestId","fingerprint");
ALTER TABLE "WorkflowApprovedSnapshot" ADD CONSTRAINT "WorkflowApprovedSnapshot_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowSigningEvent" ADD CONSTRAINT "WorkflowSigningEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WorkflowApprovedSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowSigningEvent" ADD CONSTRAINT "WorkflowSigningEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowSigningEvent" ADD CONSTRAINT "WorkflowSigningEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowSigningLifecycle" ADD CONSTRAINT "WorkflowSigningLifecycle_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowSigningLifecycle" ADD CONSTRAINT "WorkflowSigningLifecycle_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "WorkflowApprovedSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowSigningCommand" ADD CONSTRAINT "WorkflowSigningCommand_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
