-- CreateTable
CREATE TABLE "MeetingRecapActionItem" (
    "id" TEXT NOT NULL,
    "recapId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "dueDate" TIMESTAMP(3),
    "dueText" TEXT,
    "doneAt" TIMESTAMP(3),
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingRecapActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecapActionItem_taskId_key" ON "MeetingRecapActionItem"("taskId");

-- CreateIndex
CREATE INDEX "MeetingRecapActionItem_recapId_order_idx" ON "MeetingRecapActionItem"("recapId", "order");

-- CreateIndex
CREATE INDEX "MeetingRecapActionItem_ownerId_idx" ON "MeetingRecapActionItem"("ownerId");

-- AddForeignKey
ALTER TABLE "MeetingRecapActionItem" ADD CONSTRAINT "MeetingRecapActionItem_recapId_fkey" FOREIGN KEY ("recapId") REFERENCES "MeetingRecap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecapActionItem" ADD CONSTRAINT "MeetingRecapActionItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecapActionItem" ADD CONSTRAINT "MeetingRecapActionItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
