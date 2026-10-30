-- CreateTable
CREATE TABLE "SudokuMatch" (
    "id" TEXT NOT NULL,
    "roomCode" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "guestUserId" TEXT NOT NULL,
    "winnerUserId" TEXT,
    "difficulty" TEXT NOT NULL,
    "finishReason" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SudokuMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SudokuMatch_finishedAt_idx" ON "SudokuMatch"("finishedAt");
