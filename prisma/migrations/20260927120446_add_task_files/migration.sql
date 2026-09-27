-- CreateTable
CREATE TABLE "TaskFile" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "uploaderId" TEXT,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskFile_taskId_createdAt_idx" ON "TaskFile"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskFile_uploaderId_idx" ON "TaskFile"("uploaderId");

-- AddForeignKey
ALTER TABLE "TaskFile" ADD CONSTRAINT "TaskFile_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskFile" ADD CONSTRAINT "TaskFile_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
