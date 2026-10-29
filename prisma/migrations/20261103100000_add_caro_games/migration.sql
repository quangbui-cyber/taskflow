-- CreateTable
CREATE TABLE "CaroGame" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "playerXName" TEXT NOT NULL DEFAULT 'Người chơi 1',
    "playerOName" TEXT,
    "boardState" JSONB NOT NULL,
    "lastMove" JSONB,
    "turn" TEXT NOT NULL DEFAULT 'X',
    "winner" TEXT,
    "winningLine" JSONB,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "scoreX" INTEGER NOT NULL DEFAULT 0,
    "scoreO" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaroGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaroGame_code_key" ON "CaroGame"("code");

-- CreateIndex
CREATE INDEX "CaroGame_code_idx" ON "CaroGame"("code");
