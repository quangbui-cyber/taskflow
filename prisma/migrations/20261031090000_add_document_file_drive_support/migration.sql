-- AlterTable
ALTER TABLE "DocumentFile" ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "driveUrl" TEXT,
ADD COLUMN     "driveSyncStartedAt" TIMESTAMP(3),
ALTER COLUMN "data" DROP NOT NULL;
