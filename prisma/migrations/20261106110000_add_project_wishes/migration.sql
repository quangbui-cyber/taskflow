CREATE TABLE "ProjectWish" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "chatSpaceName" TEXT,
    "chatSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectWish_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectWish_projectId_createdAt_idx" ON "ProjectWish"("projectId", "createdAt");
CREATE INDEX "ProjectWish_authorId_idx" ON "ProjectWish"("authorId");
ALTER TABLE "ProjectWish" ADD CONSTRAINT "ProjectWish_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWish" ADD CONSTRAINT "ProjectWish_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
