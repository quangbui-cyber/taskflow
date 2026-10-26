-- AlterTable
ALTER TABLE "ProjectFile" ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "driveSyncStartedAt" TIMESTAMP(3),
ALTER COLUMN "data" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TaskFile" ADD COLUMN     "driveFileId" TEXT,
ADD COLUMN     "driveSyncStartedAt" TIMESTAMP(3),
ALTER COLUMN "data" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GoogleDriveConnection" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "scopes" TEXT[],
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "GoogleDriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveFolder" (
    "key" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveFolder_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriveFolder_folderId_key" ON "DriveFolder"("folderId");

