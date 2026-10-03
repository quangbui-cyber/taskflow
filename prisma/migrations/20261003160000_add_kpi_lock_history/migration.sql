-- Chốt kế hoạch KPI và nhật ký thay đổi.
ALTER TABLE "KpiPlan" ADD COLUMN "lockedAt" TIMESTAMP(3);

CREATE TABLE "KpiPlanChange" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KpiPlanChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KpiPlanChange_planId_createdAt_idx" ON "KpiPlanChange"("planId", "createdAt");
ALTER TABLE "KpiPlanChange" ADD CONSTRAINT "KpiPlanChange_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "KpiPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiPlanChange" ADD CONSTRAINT "KpiPlanChange_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
