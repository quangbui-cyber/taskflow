# CostFlow Incident Response Runbook

## 1. Kích hoạt

Kích hoạt khi có hash/QR mismatch, sai recipient/Project, duplicate cash, stale version lọt qua, source manifest khác lock, dữ liệu hiển thị mâu thuẫn, export bytes không đúng seal hoặc nghi ngờ lộ dữ liệu.

## 2. Containment — read-only trước

1. Tạm dừng hành động tài chính liên quan và ghi thời điểm, Project, request, version, attempt, actor.
2. Chuyển quy trình vận hành sang **read-only maintenance**; không xóa record, không chỉnh raw SQL và không replay command.
3. Giữ nguyên file gốc/export bytes, SHA-256, QR token, response/error và log đã redacted. Không đưa credentials hoặc số tài khoản đầy đủ vào ticket/chat.
4. Xác định phạm vi: một request, một Project hay toàn hệ thống. Approval, cash, signing và close phải được đánh giá riêng.

## 3. Backup và evidence capture

- Release owner tạo snapshot/backup theo công cụ của database provider trước mọi repair ở target environment.
- Ghi target environment, application commit/SHA, migration inventory và thời điểm backup. Không dùng bản dump để “quay ngược” chọn lọc giao dịch tài chính.
- Local reproduction dùng `postgresql://postgres@127.0.0.1:55439/costflow_test` với disposable schema. Không seed/reset DB `taskflow`.
- Khởi động stack local được phê duyệt bằng PowerShell: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.codex-tmp\run-local-test.ps1`.

## 4. Diagnose

1. So sánh request/version/attempt và actor/assignee.
2. So sánh source manifest, canonical/projection hash, artifact bytes và persisted seal.
3. Đối chiếu cash command identity, direction, amount, recipient, Project và evidence.
4. Chạy kiểm tra local không phá dữ liệu: `npm.cmd run test:costflow`, `npx.cmd tsc --noEmit`, `npx.cmd next build --webpack`.
5. Nếu lỗi chỉ là stale server/client, xác minh process và generated client trước khi thay đổi application code.

## 5. Recovery

- Dữ liệu chưa khóa: sửa qua UI bằng revision/resubmission đúng version.
- Dữ liệu đã khóa/đã chi: xin `REOPEN` khi cần, tạo B02/correction hoặc version mới có lineage; giữ nguyên prior bytes, cash, signature, hash và `SETTLED` lock.
- Lỗi code: roll-forward hotfix với test tái hiện, review, migration-safe deploy và smoke read-only. Không dùng destructive database rollback như công cụ sửa tài chính.
- Lỗi export: tạo artifact mới từ exact current source; không thay bytes dưới cùng artifact identity.

## 6. Verify và mở lại

Chỉ bỏ read-only khi test tái hiện đã xanh, source/hash/bytes khớp, ledger không duplicate, role owner xác nhận phạm vi và backup/rollback point được ghi. Production cần smoke trên target và monitoring sau deploy; local pass không thay thế.

Biên bản sự cố phải ghi impact theo từng trục approval/budget/cash/signing/close, root cause, correction lineage, người phê duyệt mở lại và các gate human/company còn pending.
