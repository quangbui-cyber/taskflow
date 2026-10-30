-- AlterTable
ALTER TABLE "CaroGame" ADD COLUMN "hostUserId" TEXT,
ADD COLUMN "guestUserId" TEXT,
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "turnStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CaroMatch" (
    "id" TEXT NOT NULL,
    "roomCode" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "guestUserId" TEXT NOT NULL,
    "winnerUserId" TEXT,
    "finishReason" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaroMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaroMatch_finishedAt_idx" ON "CaroMatch"("finishedAt");
