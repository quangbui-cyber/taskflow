-- Quản lý tab Nghỉ phép (Admin chọn): duyệt đơn của người chưa có quản lý trực tiếp
-- và nhận thông báo kết quả của mọi đơn.
ALTER TABLE "User" ADD COLUMN "isLeaveManager" BOOLEAN NOT NULL DEFAULT false;
