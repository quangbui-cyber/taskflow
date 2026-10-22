-- CreateTable
CREATE TABLE "MeetingRecap" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "stage" TEXT,
    "error" TEXT,
    "audioName" TEXT,
    "audioPathname" TEXT,
    "audioSeconds" INTEGER,
    "transcript" TEXT,
    "content" TEXT,
    "createdById" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingRecap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecap_meetingId_key" ON "MeetingRecap"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingRecap_status_processingStartedAt_idx" ON "MeetingRecap"("status", "processingStartedAt");

-- CreateIndex
CREATE INDEX "MeetingRecap_createdById_idx" ON "MeetingRecap"("createdById");

-- AddForeignKey
ALTER TABLE "MeetingRecap" ADD CONSTRAINT "MeetingRecap_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecap" ADD CONSTRAINT "MeetingRecap_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

