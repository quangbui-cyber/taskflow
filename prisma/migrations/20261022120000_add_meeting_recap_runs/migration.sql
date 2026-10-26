-- CreateTable
CREATE TABLE "MeetingRecapRun" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "audioSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingRecapRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingRecapRun_kind_createdAt_idx" ON "MeetingRecapRun"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "MeetingRecapRun_meetingId_kind_createdAt_idx" ON "MeetingRecapRun"("meetingId", "kind", "createdAt");

