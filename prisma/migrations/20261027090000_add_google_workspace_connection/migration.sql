-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "googleChatSpaceById" TEXT,
ADD COLUMN     "googleChatSpaceName" TEXT,
ADD COLUMN     "googleChatSpaceUri" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "googleEmail" TEXT,
ADD COLUMN     "googleScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "googleToken" TEXT;

-- CreateIndex
CREATE INDEX "Project_googleChatSpaceById_idx" ON "Project"("googleChatSpaceById");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_googleChatSpaceById_fkey" FOREIGN KEY ("googleChatSpaceById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

