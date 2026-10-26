CREATE TABLE "ExcelIntakePreviewAuthority" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operationKind" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExcelIntakePreviewAuthority_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExcelIntakePreviewAuthority_projectId_actorId_operationKind_scopeKey_key"
ON "ExcelIntakePreviewAuthority"("projectId", "actorId", "operationKind", "scopeKey");

CREATE INDEX "ExcelIntakePreviewAuthority_actorId_updatedAt_idx"
ON "ExcelIntakePreviewAuthority"("actorId", "updatedAt");

ALTER TABLE "ExcelIntakePreviewAuthority"
ADD CONSTRAINT "ExcelIntakePreviewAuthority_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExcelIntakePreviewAuthority"
ADD CONSTRAINT "ExcelIntakePreviewAuthority_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
