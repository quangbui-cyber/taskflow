-- AlterTable
ALTER TABLE "MeetingRecap" ADD COLUMN "glossarySuggestions" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "MeetingRecapRecipient" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingRecapRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecapGlossaryTerm" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TERM',
    "text" TEXT NOT NULL,
    "heardAs" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecapGlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingRecapRecipient_userId_idx" ON "MeetingRecapRecipient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRecapRecipient_meetingId_userId_key" ON "MeetingRecapRecipient"("meetingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecapGlossaryTerm_kind_text_key" ON "RecapGlossaryTerm"("kind", "text");

-- AddForeignKey
ALTER TABLE "MeetingRecapRecipient" ADD CONSTRAINT "MeetingRecapRecipient_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecapRecipient" ADD CONSTRAINT "MeetingRecapRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRecapRecipient" ADD CONSTRAINT "MeetingRecapRecipient_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecapGlossaryTerm" ADD CONSTRAINT "RecapGlossaryTerm_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
