ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "userId" TEXT;
DROP INDEX IF EXISTS "Account_name_key";

ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_teamId_fkey";

INSERT INTO "SalesTeam" ("id", "name")
SELECT 'legacy_sales_team', 'Chưa phân team'
WHERE NOT EXISTS (SELECT 1 FROM "SalesTeam");

UPDATE "Account"
SET "teamId" = COALESCE(
  "teamId",
  (SELECT "id" FROM "SalesTeam" ORDER BY "createdAt" ASC LIMIT 1)
)
WHERE "teamId" IS NULL;

ALTER TABLE "Account" ALTER COLUMN "teamId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Account_teamId_fkey'
  ) THEN
    ALTER TABLE "Account"
    ADD CONSTRAINT "Account_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "SalesTeam"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Account_userId_key" ON "Account"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Account_userId_fkey'
  ) THEN
    ALTER TABLE "Account"
    ADD CONSTRAINT "Account_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MemberGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MemberGroupMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MemberGroup_name_key" ON "MemberGroup"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "MemberGroupMember_groupId_userId_key"
ON "MemberGroupMember"("groupId", "userId");
CREATE INDEX IF NOT EXISTS "MemberGroupMember_userId_idx" ON "MemberGroupMember"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MemberGroupMember_groupId_fkey'
  ) THEN
    ALTER TABLE "MemberGroupMember"
    ADD CONSTRAINT "MemberGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "MemberGroup"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MemberGroupMember_userId_fkey'
  ) THEN
    ALTER TABLE "MemberGroupMember"
    ADD CONSTRAINT "MemberGroupMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
