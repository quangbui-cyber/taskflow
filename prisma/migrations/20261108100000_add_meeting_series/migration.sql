-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "seriesFrequency" TEXT;

-- CreateIndex
CREATE INDEX "Meeting_seriesId_startAt_idx" ON "Meeting"("seriesId", "startAt");
