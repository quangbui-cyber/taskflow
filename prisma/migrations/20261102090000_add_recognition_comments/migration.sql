-- CreateTable
CREATE TABLE "RecognitionComment" (
    "id" TEXT NOT NULL,
    "recognitionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecognitionComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecognitionComment_recognitionId_createdAt_idx" ON "RecognitionComment"("recognitionId", "createdAt");

-- AddForeignKey
ALTER TABLE "RecognitionComment" ADD CONSTRAINT "RecognitionComment_recognitionId_fkey" FOREIGN KEY ("recognitionId") REFERENCES "Recognition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecognitionComment" ADD CONSTRAINT "RecognitionComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
