-- CreateTable
CREATE TABLE "CreativeArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "originalTitle" TEXT NOT NULL,
    "originalPublishedAt" TIMESTAMP(3),
    "originalLines" JSONB NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "titleVi" TEXT,
    "linesVi" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedDate" DATE,
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleReader" (
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "likedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleReader_pkey" PRIMARY KEY ("userId","articleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreativeArticle_slug_key" ON "CreativeArticle"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeArticle_guid_key" ON "CreativeArticle"("guid");

-- CreateIndex
CREATE INDEX "CreativeArticle_status_publishedDate_idx" ON "CreativeArticle"("status", "publishedDate");

-- CreateIndex
CREATE INDEX "ArticleReader_articleId_idx" ON "ArticleReader"("articleId");

-- CreateIndex
CREATE INDEX "ArticleReader_userId_savedAt_idx" ON "ArticleReader"("userId", "savedAt");

-- AddForeignKey
ALTER TABLE "CreativeArticle" ADD CONSTRAINT "CreativeArticle_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleReader" ADD CONSTRAINT "ArticleReader_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleReader" ADD CONSTRAINT "ArticleReader_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "CreativeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
