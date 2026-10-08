-- Tab Tài liệu: gắn link bên cạnh file đính kèm.
CREATE TABLE "DocumentLink" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "creatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentLink_setId_createdAt_idx" ON "DocumentLink"("setId", "createdAt");
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_setId_fkey"
FOREIGN KEY ("setId") REFERENCES "DocumentSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentLink" ADD CONSTRAINT "DocumentLink_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
