ALTER TABLE "Project" ADD COLUMN "responsibleTeamId" TEXT,
ADD COLUMN "responsibleGroupId" TEXT;

-- Preserve the sidebar grouping of existing customer projects.
UPDATE "Project" AS p
SET "responsibleTeamId" = a."teamId"
FROM "Account" AS a
WHERE p."accountId" = a."id";

CREATE INDEX "Project_responsibleTeamId_idx" ON "Project"("responsibleTeamId");
CREATE INDEX "Project_responsibleGroupId_idx" ON "Project"("responsibleGroupId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_responsibleTeamId_fkey"
FOREIGN KEY ("responsibleTeamId") REFERENCES "SalesTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_responsibleGroupId_fkey"
FOREIGN KEY ("responsibleGroupId") REFERENCES "MemberGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_one_responsible_group"
CHECK ("responsibleTeamId" IS NULL OR "responsibleGroupId" IS NULL);
