CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploaderId" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectFile_projectId_createdAt_idx"
ON "ProjectFile"("projectId", "createdAt");

CREATE INDEX "ProjectFile_uploaderId_idx"
ON "ProjectFile"("uploaderId");

ALTER TABLE "ProjectFile"
ADD CONSTRAINT "ProjectFile_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectFile"
ADD CONSTRAINT "ProjectFile_uploaderId_fkey"
FOREIGN KEY ("uploaderId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
