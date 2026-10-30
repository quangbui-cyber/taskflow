-- CreateTable
CREATE TABLE "SudokuGame" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "hostName" TEXT NOT NULL,
    "guestUserId" TEXT,
    "guestName" TEXT,
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "timerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "timeLimitSec" INTEGER NOT NULL DEFAULT 900,
    "puzzle" JSONB,
    "solution" JSONB,
    "hostValues" JSONB,
    "guestValues" JSONB,
    "hostMistakes" INTEGER NOT NULL DEFAULT 0,
    "guestMistakes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "winner" TEXT,
    "finishReason" TEXT,
    "scoreHost" INTEGER NOT NULL DEFAULT 0,
    "scoreGuest" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SudokuGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SudokuGame_code_key" ON "SudokuGame"("code");
