# CostFlow Workflow Cheat Sheet

## Đường dẫn chuẩn

| Mục đích | Route |
|---|---|
| Tổng quan Project CostFlow | `/projects/{projectId}/costflow` |
| Hồ sơ Project | `/projects/{projectId}/costflow?tab=approvals` |
| Mở đúng request | `/projects/{projectId}/costflow?tab=approvals#request-{requestId}` |
| Hub hồ sơ chung | `/workflow` |
| Chi tiết Workflow | `/workflow/{requestId}` |
| Bản in Workflow | `/workflow/{requestId}/print` |
| Xác minh capability công khai | `/workflow/verify/{token}` |

Không tự ghép route ở component mới; dùng helper trong `lib/workflow/routes.ts`.

## Luồng và trục trạng thái

| Chặng | Actor chính | Bằng chứng cần giữ | Không được suy ra |
|---|---|---|---|
| Báo giá / IC draft | Account | draft, source IDs, primitive inputs | Draft không phải approval |
| IC Manager approve | Quản lý | request/version/attempt + event | Hiệu lực budget không phải cash |
| IC Accountant/CEO | Kế toán, CEO | từng quyết định bất biến | CEO return/reject không xóa baseline Manager |
| AC | Người lập, AC_DD | IC lineage, actual primitives, evidence | Evidence không tự thành approved AC |
| Payment request | Account | recipients, sources, manifest, gross | Approved request không phải tiền đã chi |
| Cash | Kế toán/thu ngân | direction, amount, evidence, command identity | Cash không phải signing/close |
| Settlement | Account + 3 bước duyệt | obligations, locks, canonical hash | CEO approve chưa có nghĩa balance = 0 |
| Signing/export | 4 vai trò | exact bytes, source seal, SHA-256, QR | Đủ chữ ký không tự đóng tài chính |
| Financial close | Người yêu cầu + Quản lý | two-way blockers = 0, reason/event | Task `DONE` không phải close |

## Khi bị lỗi

- `stale version` / `attempt`: tải lại và dùng bản hiện hành.
- `wrong actor`: kiểm tra assignee/role grant; không dùng Admin để bỏ qua.
- thiếu evidence: bổ sung đúng route và đúng owner; không gắn file của Project khác.
- retry cash/export: tra ledger/artifact identity trước; cùng command phải idempotent, payload khác phải bị từ chối.
- hash/QR mismatch: dừng phát hành, bảo toàn bytes, chuyển incident runbook.
- sai sau close: xin REOPEN rồi tạo B02/correction; không chỉnh bản đã khóa.

## Ranh giới phát hành

Kết quả `automated_local` và `browser_local` chỉ là bằng chứng kỹ thuật. `native_human`, `company_pilot` và `production` cần được ghi nhận riêng. Bộ hướng dẫn này không xác nhận các gate đó đã đạt. Phase 11 reminders/post-approval execution chưa thuộc phạm vi hiện tại.
