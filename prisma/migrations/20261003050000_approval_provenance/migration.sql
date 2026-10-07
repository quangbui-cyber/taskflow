ALTER TABLE "WorkflowRequest"
  ADD COLUMN "currentAttemptId" TEXT,
  ADD COLUMN "currentStepArrivedAt" TIMESTAMP(3),
  ADD COLUMN "replacesRequestId" TEXT,
  ADD COLUMN "replacedByRequestId" TEXT,
  ADD COLUMN "pendingReplacementRequestId" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3);

ALTER TABLE "Notification" ADD COLUMN "workflowRequestId" TEXT;

CREATE TABLE "WorkflowApprovalEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "attemptId" TEXT,
  "submittedVersion" INTEGER,
  "mutationVersion" INTEGER NOT NULL,
  "stepIndex" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "details" JSONB,
  "fromAssigneeId" TEXT,
  "toAssigneeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowApprovalEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowRoleGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "grantedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "WorkflowRoleGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowRequestReader" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowRequestReader_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowNotificationDelivery" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowNotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkflowApprovalEvent_requestId_mutationVersion_action_key" ON "WorkflowApprovalEvent"("requestId", "mutationVersion", "action");
CREATE INDEX "WorkflowApprovalEvent_actorId_createdAt_idx" ON "WorkflowApprovalEvent"("actorId", "createdAt");
CREATE INDEX "WorkflowApprovalEvent_requestId_attemptId_createdAt_idx" ON "WorkflowApprovalEvent"("requestId", "attemptId", "createdAt");
CREATE INDEX "WorkflowRoleGrant_userId_role_revokedAt_idx" ON "WorkflowRoleGrant"("userId", "role", "revokedAt");
CREATE UNIQUE INDEX "WorkflowRoleGrant_active_user_role_key" ON "WorkflowRoleGrant"("userId", "role") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "WorkflowRequestReader_requestId_userId_key" ON "WorkflowRequestReader"("requestId", "userId");
CREATE INDEX "WorkflowRequestReader_userId_createdAt_idx" ON "WorkflowRequestReader"("userId", "createdAt");
CREATE UNIQUE INDEX "WorkflowNotificationDelivery_eventId_userId_key" ON "WorkflowNotificationDelivery"("eventId", "userId");
CREATE INDEX "WorkflowNotificationDelivery_status_nextAttemptAt_idx" ON "WorkflowNotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "WorkflowNotificationDelivery_userId_createdAt_idx" ON "WorkflowNotificationDelivery"("userId", "createdAt");
CREATE INDEX "WorkflowRequest_state_currentStepArrivedAt_idx" ON "WorkflowRequest"("state", "currentStepArrivedAt");
CREATE INDEX "WorkflowRequest_replacesRequestId_idx" ON "WorkflowRequest"("replacesRequestId");
CREATE INDEX "WorkflowRequest_replacedByRequestId_idx" ON "WorkflowRequest"("replacedByRequestId");
CREATE INDEX "WorkflowRequest_pendingReplacementRequestId_idx" ON "WorkflowRequest"("pendingReplacementRequestId");
CREATE INDEX "Notification_workflowRequestId_idx" ON "Notification"("workflowRequestId");

ALTER TABLE "WorkflowApprovalEvent" ADD CONSTRAINT "WorkflowApprovalEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowApprovalEvent" ADD CONSTRAINT "WorkflowApprovalEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowRoleGrant" ADD CONSTRAINT "WorkflowRoleGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowRoleGrant" ADD CONSTRAINT "WorkflowRoleGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowRequestReader" ADD CONSTRAINT "WorkflowRequestReader_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkflowRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowRequestReader" ADD CONSTRAINT "WorkflowRequestReader_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowNotificationDelivery" ADD CONSTRAINT "WorkflowNotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WorkflowApprovalEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowNotificationDelivery" ADD CONSTRAINT "WorkflowNotificationDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workflowRequestId_fkey" FOREIGN KEY ("workflowRequestId") REFERENCES "WorkflowRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
