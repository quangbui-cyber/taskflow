# Danh bạ NCC và thanh toán VAT sau AC

Tài liệu này mô tả đường vận hành Phase 14. Đây là hướng dẫn kỹ thuật/local, không phải xác nhận company acceptance, pilot hay production deployment.

## Luồng chuẩn

1. Account/Admin tạo NCC trong `/suppliers`. NCC dùng chung toàn công ty; Project chỉ tham chiếu ID và phiên bản.
2. Một tài khoản được đánh dấu mặc định. Hệ thống vẫn hỗ trợ nhiều tài khoản cho trường hợp hiếm.
3. File ngân hàng không bắt buộc. Kế toán xác minh đúng tuple phiên bản pháp lý + phiên bản tài khoản ở lần thanh toán đầu và sau mỗi thay đổi. API ngân hàng còn pending, không được mô tả là đã tra cứu tự động.
4. Trước khi có AC, mọi đợt chi NCC từ lịch thanh toán phát hành dưới ĐNTU và giữ phân bổ về dòng IC.
5. Sau khi AC nguồn `VENDOR_PAYMENT` được DD duyệt, Account lập ĐNTT. Một hóa đơn điện tử nhận XML hoặc PDF, hoặc cả hai định dạng của cùng hóa đơn; metadata, hash và business key chỉ tạo một payable identity.
6. ĐNTT giữ lineage `ĐNTT → hóa đơn VAT → AC/version/approval → dòng IC`. Minh chứng IC chỉ được truy về lịch sử, không tự kế thừa vào evidence của ĐNTT.

## Phiên bản, thay đổi ngân hàng và xác minh

- Hồ sơ đã trình đóng băng tên pháp lý, tài khoản, version ID và fingerprint. Sửa NCC không đổi snapshot cũ.
- Sau khi đổi tài khoản, trạng thái quay về chưa xác minh. Hồ sơ đang dùng tuple cũ phải bị trả và lập lại; không được đổi recipient âm thầm.
- Nếu ĐNTT bị trả, từ chối, rút hoặc hủy, `VendorInvoiceApplication` chuyển `RELEASED`. Invoice, file và allocation vẫn còn nguyên để audit; chỉ application `ACTIVE` tham gia số đã áp dụng.

## Expense legacy

`BENEFICIARY`, `EXPENSE`, `EXPENSE_EVIDENCE` và `REVISE_EXPENSE` bị chặn trước transaction. Dữ liệu Expense legacy, chứng từ và nhãn cũ vẫn đọc/tải/xuất được nhưng không được tạo, bổ sung, sửa hay dùng làm nguồn ĐNTT/quyết toán mới. AC chuẩn hóa là nguồn có thẩm quyền; export và settlement chỉ nhận một normalized identity.

## Xung đột migrate và backfill

- Chỉ chạy migration trên database đã backup và đúng môi trường. Automation Phase 14 chỉ dùng `costflow_test` với schema tạm.
- Nếu gặp xung đột migrate, dừng ghi mới, lưu output Prisma và kiểm tra `_prisma_migrations`; không sửa tay lịch sử migration và không xóa dữ liệu NCC/Expense.
- Backfill tạo `LegacySupplierAlias`; rerun phải idempotent. Dòng thiếu tên/ngân hàng/STK nằm trong báo cáo unresolved. Các dòng giống tên nhưng khác tài khoản không tự merge.
- Sau deploy, kiểm tra table/constraint/index, số alias, snapshot JSON workspace và hash cash/request trước khi mở chức năng.

## Incident và rollback

- Sai tuple hoặc MST: trả toàn bộ hồ sơ, sửa NCC/hóa đơn và lập lại từ phiên bản hiện hành.
- Trùng hóa đơn: đối chiếu business key `MST người bán | ký hiệu | số hóa đơn | ngày phát hành`; không xóa record để thử lại.
- Allocation kẹt sau terminal state: dừng lập hồ sơ mới, kiểm tra application còn `ACTIVE`; không sửa số tiền trực tiếp. Chỉ chạy script sửa có review và bằng chứng snapshot.
- Rollback ứng dụng: đưa code về release trước nhưng giữ nguyên migration additive và toàn bộ dữ liệu. Không dùng destructive database rollback, reset hoặc seed.
- Khôi phục dịch vụ: chạy schema/readback, service regression, TypeScript, lint và build; sau đó Account/Kế toán kiểm tra thủ công một NCC và một ĐNTT.

## Giới hạn và cổng còn mở

- Chưa tích hợp API ngân hàng hoặc tax-authority parser. Metadata hóa đơn hiện được người lập nhập và đóng băng chung cho XML/PDF.
- Browser smoke `/suppliers` và ĐNTT cần database local dài hạn đã được migrate có chủ đích; verifier không tự migrate/seed database `taskflow`.
- Native upload/IME, pilot thật, company acceptance, production backup/migration/smoke và deployment đều `PENDING`.
