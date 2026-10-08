-- Customer projects derive their team from Account, including future team changes.
-- Keep legacy projects without Account so they can be assigned by an owner/admin.
UPDATE "Project" SET "responsibleTeamId" = NULL, "responsibleGroupId" = NULL
WHERE "category" = 'CLIENT';

ALTER TABLE "Project" ADD CONSTRAINT "Project_customer_team_from_account"
CHECK ("category" <> 'CLIENT' OR ("responsibleTeamId" IS NULL AND "responsibleGroupId" IS NULL));
