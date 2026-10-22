-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "MeetingRecap" ADD COLUMN     "projectFileId" TEXT;

-- CreateIndex
CREATE INDEX "Meeting_projectId_idx" ON "Meeting"("projectId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

