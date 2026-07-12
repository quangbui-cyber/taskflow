-- AlterTable
ALTER TABLE "Project" ADD COLUMN "webhookToken" TEXT;

UPDATE "Project"
SET "webhookToken" = substr(md5(random()::text || clock_timestamp()::text || id), 1, 32)
WHERE "webhookToken" IS NULL;

ALTER TABLE "Project" ALTER COLUMN "webhookToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Project_webhookToken_key" ON "Project"("webhookToken");
