# Hướng dẫn CostFlow — Kế toán / Thu ngân

> Làm việc tại `/workflow` và `/projects/{projectId}/costflow`. Kết quả local hoặc test tự động không phải xác nhận production hay phê duyệt nghiệp vụ của công ty.

## 1. Kiểm tra trước khi duyệt

1. Mở đúng request/version/attempt từ hub **Hồ sơ & Trình duyệt**.
2. Đối chiếu người nhận, source line, IC/AC, gross, VAT, manifest chứng từ và hash. Không dựa vào tổng tiền do browser gửi lên.
3. Với bước Kế toán, đánh dấu xác nhận đã kiểm tra trước khi `APPROVE`; `RETURN`/`REJECT` phải có lý do.
4. Không coi quyền Admin hoặc việc cùng một người giữ nhiều vai trò là quyền bỏ qua bước. Mỗi quyết định được ghi riêng.

## 2. Ghi nhận tiền thực tế

- Chỉ ghi cash khi request đã tạo đúng thẩm quyền và bạn là người được phân công.
- Mỗi giao dịch dùng command của ứng dụng, có số tiền dương, direction và evidence. Không gộp nhiều người nhận hoặc Project.
- `Cash OUT` là tiền đã chi; `Cash IN` là tiền thu hoàn. Hai chiều được đối chiếu độc lập.
- Partial disbursement được phép khi UI cho phép; mỗi lần ghi giữ idempotency/command identity. Nếu retry sau lỗi mạng, kiểm tra ledger trước, không bấm lặp mù.
- Request `APPROVED` không có nghĩa tiền đã đi. Chữ ký đủ cũng không tự tạo cash.

## 3. AC và quyết toán

Kế toán xem Actual Cost Control Center để đối chiếu IC, AC, evidence, payment progress và cash. Quyết định AC thuộc duy nhất AC_DD đang hoạt động; Kế toán không tự biến chứng từ thành AC đã duyệt.

Với hồ sơ quyết toán:

1. Kiểm tra toàn bộ obligations, advance đã giải ngân, AC đã DD duyệt và khóa nguồn.
2. Duyệt đúng phiên bản hiện hành; không dùng bản in cũ hoặc hash khác.
3. Sau CEO phê duyệt, ghi chi thêm/thu hoàn theo từng obligation và đính evidence.
4. Đối chiếu `remainingAmount` về 0, không tự sửa `SETTLED` lock.
5. Đóng tài chính còn cần thanh lý khách hàng đã ký và AR = 0; tiền nội bộ đủ chưa thay thế điều kiện phía khách hàng.

## 4. Export và sự cố

XLSX/PDF/QR phải cùng exact source identity. Khi hash/QR không khớp, dừng phát hành, giữ nguyên bytes và chuyển sang quy trình sự cố. Không tái tạo file rồi gắn lại vào phiên bản cũ.

Khi có sai số đã chi/đã khóa: không rollback dữ liệu tài chính và không sửa raw SQL. Cô lập read-only, lưu evidence, mở B02/correction theo quyền và tạo version mới có lineage. Xem `INCIDENT_RESPONSE_RUNBOOK.md`.

Task `DONE`, approval, cash, digital signing và financial close luôn tách biệt. Phase 11 reminders/execution chưa phải chức năng được tài liệu này xác nhận.
