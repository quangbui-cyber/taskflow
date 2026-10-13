# Hướng dẫn CostFlow — Quản lý / CEO

> Dùng hub `/workflow` hoặc deep link `/projects/{projectId}/costflow?tab=approvals#request-{requestId}`. Chỉ quyết định hồ sơ được phân công và đúng attempt/version hiện hành.

## 1. Quản lý

1. Kiểm tra nguồn, người nhận, số tiền, evidence và thay đổi so với phiên bản trước.
2. Chọn `APPROVE`, `RETURN` hoặc `REJECT`; return/reject cần lý do cụ thể. Không duyệt dựa trên file ngoài hệ thống không có manifest/hash.
3. Với IC, `APPROVE` của Quản lý làm baseline ngân sách có hiệu lực. Quyết định sau đó của CEO không tự xóa hiệu lực này.
4. Khi CEO trả/từ chối IC, Quản lý có thể ghi giải trình theo command chuyên biệt; sửa số phải tạo correction/revision, không sửa bản hiệu lực.
5. Yêu cầu CLOSE/REOPEN chỉ do Quản lý được phân công quyết định và phải có lý do. CLOSE bị chặn nếu còn bất kỳ blocker hai chiều nào.

## 2. CEO

1. Xác minh đây là bước CEO của request/version/attempt hiện hành.
2. `APPROVE` kết thúc chuỗi duyệt của hồ sơ nhưng không tự chứng minh tiền đã chuyển, đủ chữ ký hay Project đã đóng tài chính.
3. `RETURN` trả hồ sơ để sửa có lineage; `REJECT` kết thúc attempt theo chính sách. Với IC, cả hai vẫn giữ baseline Quản lý đã làm hiệu lực.
4. Hồ sơ quyết toán chỉ khóa đúng source manifest khi CEO duyệt. Cash sau khóa vẫn là thao tác riêng của Kế toán/thu ngân.

## 3. Chữ ký, QR và close

Chuỗi ký số có bốn vai trò `CREATOR`, `MANAGER`, `ACCOUNTANT`, `CEO`; trạng thái ký không đồng nhất với approval. QR công khai chỉ xác minh capability/identity cho phép và không được lộ dữ liệu ngân hàng hoặc raw evidence.

Để đóng tài chính, phải cùng lúc thỏa:

- hồ sơ quyết toán mới nhất được duyệt, manifest/hash khớp và source đã `SETTLED`;
- mọi obligation nội bộ đã phân bổ đủ, cash có evidence;
- không có correction lifecycle còn mở;
- thanh lý khách hàng đã ký kèm evidence;
- Customer AR đúng 0.

Nếu cần sửa sau close, phê duyệt `REOPEN`, sau đó tạo B02/revision mới chỉ cho delta hợp lệ. Version cũ, cash, chữ ký, hash và lock phải giữ bất biến.

## 4. Nguyên tắc dừng

Dừng và trả lại khi actor sai, version stale, evidence thiếu, hash không khớp, người nhận/Project sai hoặc UI hiển thị trạng thái mâu thuẫn. Không yêu cầu kỹ thuật sửa raw SQL để “cho qua”. Task `DONE` không phải close; approval không phải cash; signing không phải approval. Phase 11 thực hiện/nhắc việc nằm ngoài phạm vi hiện tại.
