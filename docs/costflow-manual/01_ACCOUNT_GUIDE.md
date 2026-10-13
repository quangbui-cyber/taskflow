# Hướng dẫn CostFlow — Account / Người lập

> Phạm vi hiện tại: thao tác trong một Project tại `/projects/{projectId}/costflow`. Tài liệu này mô tả ứng dụng hiện có; không phải biên bản nghiệm thu pilot hay xác nhận production.

## 1. Điều kiện trước khi bắt đầu

- Bạn là Account, Project Owner hoặc thành viên Project có quyền phù hợp.
- Admin đã phân công Kế toán, CEO và Quản lý đóng/mở trong tab **Phân công**.
- Tài liệu gốc được lưu ở tab **Tài liệu** của Project; không sửa file gốc bên ngoài rồi thay thế lịch sử.
- Báo giá, IC, AC, hồ sơ thanh toán, tiền, chữ ký và đóng tài chính là các trục trạng thái riêng.

## 2. Lập báo giá và IC

1. Mở Project → **CostFlow** → **Scope & Báo giá**.
2. Tạo báo giá mới hoặc mở worksheet hiện hành. Giữ đúng hierarchy Nhóm / Hạng mục / Chi tiết và nhập các primitive quantity, days, unit price, VAT.
3. Nếu dùng Excel, chỉ dùng template của ứng dụng. Luôn xem preview/diff; import tạo draft mới và không ghi đè bản đã duyệt.
4. Finalize báo giá khi số liệu bán đã sẵn sàng. Finalize không đồng nghĩa IC được duyệt.
5. Mở **Internal Cost**, hoàn thiện giá mua, nguồn dòng và chứng từ/lý do theo từng dòng; sau đó trình IC.
6. Theo dõi hồ sơ tại `/projects/{projectId}/costflow?tab=approvals#request-{requestId}` hoặc hub `/workflow`.

IC có hiệu lực ngân sách từ lúc Quản lý duyệt. CEO `RETURN` hoặc `REJECT` làm thay đổi trạng thái duyệt nhưng không tự thu hồi baseline IC đã có hiệu lực. Sửa sau trả về phải tạo revision/correction có lineage; không chỉnh trực tiếp bản đã khóa.

## 3. AC, thanh toán và quyết toán

1. Tại **Actual Cost**, ghi nhận thực tế theo quantity, days, unit price và liên kết dòng IC hoặc provenance ngoài ngân sách.
2. Đính kèm đúng loại chứng từ. Thiếu chứng từ phải được hiển thị là cảnh báo; chỉ AC_DD đang hoạt động mới có quyền quyết định AC.
3. Tạo hồ sơ tạm ứng/thanh toán từ **Hồ sơ & Trình duyệt**. Kiểm tra từng người nhận, nguồn IC/AC, gross và manifest chứng từ trước khi trình.
4. Một hồ sơ được duyệt chỉ tạo thẩm quyền xử lý tiếp. Tiền thực tế chỉ phát sinh khi Kế toán/thu ngân ghi giao dịch cash riêng.
5. Tại **Tiền & Quyết toán**, tạo một hồ sơ quyết toán tổng hợp. Máy chủ tự nạp AC đã DD duyệt và tạm ứng đã giải ngân; đối chiếu theo từng người nhận.
6. Nếu có số phải thu hoàn, bàn giao cho Kế toán ghi `Cash IN`; nếu còn phải chi, ghi `Cash OUT` sau khi hồ sơ đã khóa đúng điều kiện.
7. Chỉ yêu cầu đóng khi nội bộ balance = 0, mọi cash có chứng từ, hồ sơ quyết toán mới nhất được CEO duyệt/khóa, thanh lý khách hàng đã ký và AR = 0.

## 4. Bàn giao và bằng chứng audit

Bàn giao cho người xử lý tiếp các định danh: Project, request, version, attempt, source manifest/hash, recipient, chứng từ và quyết định gần nhất. Không gửi số tài khoản đầy đủ qua chat; dùng màn hình phân quyền của hệ thống.

Nếu bị `stale version`, `wrong actor`, thiếu evidence hoặc hash không khớp: dừng, tải lại, kiểm tra bản hiện hành và ghi lý do khi tạo revision/correction. Không chạy SQL và không sửa JSON tài chính trực tiếp.

Task `DONE`, hồ sơ `APPROVED`, chữ ký đủ, cash đủ và financial close là năm tín hiệu khác nhau. Không dùng một tín hiệu thay cho tín hiệu khác. Nhắc việc/thực hiện sau duyệt của Phase 11 chưa nằm trong phạm vi hiện tại.
