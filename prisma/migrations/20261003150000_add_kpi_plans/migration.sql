-- Trưởng team kinh doanh: Account được chia KPI team xuống từng Account.
ALTER TABLE "SalesTeam" ADD COLUMN "leaderId" TEXT;
CREATE UNIQUE INDEX "SalesTeam_leaderId_key" ON "SalesTeam"("leaderId");
ALTER TABLE "SalesTeam" ADD CONSTRAINT "SalesTeam_leaderId_fkey"
FOREIGN KEY ("leaderId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "KpiPlan" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "companyTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KpiPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KpiPlan_year_key" ON "KpiPlan"("year");

CREATE TABLE "KpiTeamTarget" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "KpiTeamTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KpiTeamTarget_planId_teamId_month_key" ON "KpiTeamTarget"("planId", "teamId", "month");
CREATE INDEX "KpiTeamTarget_teamId_idx" ON "KpiTeamTarget"("teamId");
ALTER TABLE "KpiTeamTarget" ADD CONSTRAINT "KpiTeamTarget_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "KpiPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiTeamTarget" ADD CONSTRAINT "KpiTeamTarget_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "SalesTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "KpiAccountTarget" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "KpiAccountTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KpiAccountTarget_planId_accountId_month_key" ON "KpiAccountTarget"("planId", "accountId", "month");
CREATE INDEX "KpiAccountTarget_accountId_idx" ON "KpiAccountTarget"("accountId");
ALTER TABLE "KpiAccountTarget" ADD CONSTRAINT "KpiAccountTarget_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "KpiPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiAccountTarget" ADD CONSTRAINT "KpiAccountTarget_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
