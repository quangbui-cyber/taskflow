-- CreateTable
CREATE TABLE "SalesTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesTeam_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "teamId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SalesTeam_name_key" ON "SalesTeam"("name");

-- CreateIndex
CREATE INDEX "Account_teamId_idx" ON "Account"("teamId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "SalesTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
