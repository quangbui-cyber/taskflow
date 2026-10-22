-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "recorderId" TEXT;

-- CreateIndex
CREATE INDEX "Meeting_recorderId_idx" ON "Meeting"("recorderId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_recorderId_fkey" FOREIGN KEY ("recorderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
