# Known Limitations Matrix

| Giới hạn / gate | Loại | Rủi ro | Owner quyết định | Workaround an toàn hiện tại | Evidence status |
|---|---|---|---|---|---|
| Chưa có direct human review của 4 vai trò Huy, Quang, Uyên, Sơn | Company pilot | Quy trình có thể chưa phù hợp vận hành thực tế | Company owner | Chạy checklist trên một Project được ủy quyền; không dùng synthetic test thay sign-off | `PENDING` |
| Native Excel/PDF/A4/QR chưa được quan sát đầy đủ | Human/native | Sai layout, formula cache, printer hoặc QR scanner | Kế toán + người duyệt | Giữ exact bytes/hash và kiểm tra bằng ứng dụng native trước phát hành | `PENDING` |
| 390px vật lý, touch/keyboard/focus và Vietnamese IME | Human/UI | Lỗi nhập liệu hoặc thao tác mobile | Product owner | Browser contract tests chỉ là prerequisite; cần thiết bị/người thật | `PENDING` |
| Production migration/deploy/monitoring/backup chưa thuộc bằng chứng Plan 12-06 | Production | Local pass không phản ánh target environment | Release owner | Dùng release charter và runbook; ghi target SHA, migration, smoke, backup riêng | `PENDING` |
| Benchmark là local single-process | Technical evidence | Không chứng minh concurrency/network/capacity production | Engineering | Dùng số local để phát hiện regression; chạy load/observability ở target trước go-live | `automated_local` only |
| Phase 10 human settlement/export checkpoint còn mở | Upstream | Có thể phát hành khi nghiệp vụ quyết toán chưa được chấp nhận | Finance owner | Không quyết định READY cho Phase 12 cho tới khi checkpoint được ghi nhận | `human_needed` |
| Phase 11 reminders/post-approval execution bị loại khỏi Phase 12 | Deferred scope | Người dùng có thể kỳ vọng nhắc việc/tự động thực hiện | Product owner | Quản lý ngoài hệ thống theo quy trình công ty; không tuyên bố OPS-01–04 hoàn tất | `OUT_OF_SCOPE` |
| Không có policy sửa trực tiếp số đã chi/đã khóa | Policy gate | Mất audit trail nếu chỉnh DB | Finance owner | REOPEN + B02/correction/revision; giữ version/cash/hash/lock cũ | `FAIL_CLOSED` |
| Public verification cố ý giới hạn dữ liệu | Security | Người xem có thể kỳ vọng raw evidence/bank details | Security owner | Người được quyền xem chi tiết đăng nhập; public route chỉ trả allowlist | `BY_DESIGN` |

Trạng thái trong bảng là provenance/gate status, không phải phần trăm hoàn thành. Không có dòng nào ở đây xác nhận company sign-off hoặc production acceptance.
