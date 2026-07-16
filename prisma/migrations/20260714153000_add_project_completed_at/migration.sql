ALTER TABLE "Project" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Dữ liệu cũ không có lịch sử đổi trạng thái, nên dùng ngày tạo làm mốc ban đầu.
UPDATE "Project"
SET "completedAt" = "createdAt"
WHERE "status" = 'DONE' AND "completedAt" IS NULL;

CREATE INDEX "Project_status_completedAt_idx"
ON "Project"("status", "completedAt");
