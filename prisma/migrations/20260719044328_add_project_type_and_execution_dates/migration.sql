-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "executionEndAt" TIMESTAMP(3),
ADD COLUMN     "executionStartAt" TIMESTAMP(3),
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'OTHER';

-- CreateIndex
CREATE INDEX "Project_executionStartAt_idx" ON "Project"("executionStartAt");
