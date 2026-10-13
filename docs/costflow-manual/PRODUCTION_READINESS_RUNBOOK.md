# Production Readiness Runbook — Dry Run Only

> `STATUS: NOT_EXECUTED`. Đây là checklist quyết định cho release owner. Phase 12 không chạy deploy, migration, backup, rollback hay gửi thông báo bên ngoài.

## A. Ownership và change record

- [ ] `PROD-OWNER-01` Release owner, Finance owner và Incident commander được ghi bằng danh tính thật.
- [ ] `PROD-SHA-01` App commit/SHA, branch/tag và artifact build được chốt.
- [ ] `PROD-WINDOW-01` Change window, kênh liên lạc và tiêu chí dừng/rollback được duyệt.
- [ ] `PROD-SECRETS-01` Owner xác nhận `DATABASE_URL`, `SESSION_SECRET`, cron/chat keys và document attestation keys tồn tại ở target; không chép giá trị vào biên bản.

## B. Backup và migration preflight

- [ ] `PROD-BACKUP-01` Provider snapshot/backup hoàn tất; ghi immutable provider ID, timestamp và retention.
- [ ] `PROD-RESTORE-01` Restore drill/restore procedure được owner xác nhận trên môi trường không phải production.
- [ ] `PROD-MIGRATION-01` Kiểm kê migration đã áp dụng và pending; schema/client compatibility được review.
- [ ] `PROD-MIGRATION-02` `scripts/deploy-migrations.mjs` chỉ chạy khi `VERCEL_ENV=production`, `CLOUDFLARE_DEPLOY=1` hoặc explicit `--force`; retry chỉ cho lỗi kết nối tạm thời.
- [ ] `PROD-DATA-01` Không seed/reset, không import dữ liệu giả và không thay đổi bản ghi tài chính để tạo fixture acceptance.

## C. Deployment gate

- [ ] `PROD-AUTO-01` Final exact SHA: Prisma validate/generate, TypeScript, focused lint, full CostFlow registry và direct webpack build đều exit 0.
- [ ] `PROD-APPROVAL-01` Bốn quyết định company sign-off trong `RELEASE_SIGN_OFF.md` đều trỏ exact evidence và không còn `PENDING`.
- [ ] `PROD-CHANGE-01` Deployment command/provider action được peer review. Không thực hiện command từ tài liệu này.
- [ ] `PROD-READONLY-01` Có cơ chế chuyển app/quy trình sang read-only maintenance nếu smoke hoặc monitoring thất bại.

## D. Target smoke — read-only trước

- [ ] `PROD-SMOKE-01` Login/session, project, task/file, PO parser, `/revenue`, `/workflow` và `/api/cron/daily-digest` được kiểm tra trên target.
- [ ] `PROD-SMOKE-02` Một Project đã ủy quyền mở CostFlow; role visibility và public QR allowlist được kiểm tra mà không tạo cash/approval/close.
- [ ] `PROD-SMOKE-03` Database/schema target và running SHA được ghi; không dùng kết quả localhost làm thay thế.

## E. Post-deploy observation và rollback

- [ ] `PROD-OBS-01` Theo dõi auth errors, Prisma errors, request latency, export failures, cron retries và notification delivery trong change window.
- [ ] `PROD-FINANCE-01` Finance owner kiểm tra không có duplicate cash, stale attempt hoặc hash mismatch.
- [ ] `PROD-ROLLBACK-01` Khi lỗi: read-only containment → evidence/backup capture → roll-forward hotfix hoặc revision/B02 correction. Không dùng destructive database rollback để sửa nghiệp vụ tiền.
- [ ] `PROD-CLOSE-01` Release owner ghi `READY` hoặc `NOT_READY`, lý do, exact evidence IDs và thời điểm. Không để automation tự ký.

Mọi ô hiện để trống vì target production chưa được thực thi/quan sát trong Phase 12. Kết quả local chỉ tham chiếu trong `PHASE12_EVIDENCE_INDEX.md`.
