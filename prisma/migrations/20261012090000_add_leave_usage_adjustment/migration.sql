CREATE TABLE "LeaveUsageAdjustment" (
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "adjustmentDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveUsageAdjustment_pkey" PRIMARY KEY ("userId","year")
);

ALTER TABLE "LeaveUsageAdjustment" ADD CONSTRAINT "LeaveUsageAdjustment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
