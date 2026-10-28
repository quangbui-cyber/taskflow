-- AlterTable Meeting
ALTER TABLE "Meeting" ADD COLUMN "meetCode" TEXT;

-- CreateIndex
CREATE INDEX "Meeting_meetCode_idx" ON "Meeting"("meetCode");

-- Backfill meetCode from existing meetingUrl for Google Meet links
UPDATE "Meeting"
SET "meetCode" = LOWER(SUBSTRING(SUBSTRING("meetingUrl" FROM 'meet\.google\.com/([a-z]{3}-[a-z]{4}-[a-z]{3})') FROM 1 FOR 12))
WHERE "meetingUrl" IS NOT NULL
  AND "meetingUrl" ~* 'meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}';

-- CreateTable ExtensionToken
CREATE TABLE "ExtensionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionToken_tokenHash_key" ON "ExtensionToken"("tokenHash");
CREATE INDEX "ExtensionToken_userId_idx" ON "ExtensionToken"("userId");

-- AddForeignKey
ALTER TABLE "ExtensionToken" ADD CONSTRAINT "ExtensionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
