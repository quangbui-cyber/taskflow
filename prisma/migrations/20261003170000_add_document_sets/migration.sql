-- Tab Tài liệu: bộ hồ sơ dùng chung và các file đính kèm.
CREATE TABLE "DocumentSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentSet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentSet_name_key" ON "DocumentSet"("name");

CREATE TABLE "DocumentFile" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentFile_setId_createdAt_idx" ON "DocumentFile"("setId", "createdAt");
CREATE INDEX "DocumentFile_uploaderId_idx" ON "DocumentFile"("uploaderId");
ALTER TABLE "DocumentFile" ADD CONSTRAINT "DocumentFile_setId_fkey"
FOREIGN KEY ("setId") REFERENCES "DocumentSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentFile" ADD CONSTRAINT "DocumentFile_uploaderId_fkey"
FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
