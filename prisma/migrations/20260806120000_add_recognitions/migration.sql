-- CreateTable
CREATE TABLE "Recognition" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'KINDNESS',
    "visibility" TEXT NOT NULL DEFAULT 'COMPANY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recognition_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "recognitionId" TEXT;

-- CreateIndex
CREATE INDEX "Recognition_senderId_createdAt_idx" ON "Recognition"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "Recognition_recipientId_createdAt_idx" ON "Recognition"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "Recognition_visibility_createdAt_idx" ON "Recognition"("visibility", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recognitionId_idx" ON "Notification"("recognitionId");

-- AddForeignKey
ALTER TABLE "Recognition" ADD CONSTRAINT "Recognition_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recognition" ADD CONSTRAINT "Recognition_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recognitionId_fkey" FOREIGN KEY ("recognitionId") REFERENCES "Recognition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
