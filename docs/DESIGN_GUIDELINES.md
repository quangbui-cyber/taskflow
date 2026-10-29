# myCreative — Quy chuẩn Thẩm mỹ & Thiết kế Giao diện (Design Guidelines)

> Tài liệu định hướng thẩm mỹ và trải nghiệm thị giác cho hệ thống **myCreative (TaskFlow)**.  
> Mọi trợ lý AI và lập trình viên khi xây dựng hoặc chỉnh sửa giao diện **phải tuân thủ nghiêm ngặt** các nguyên tắc dưới đây.

---

## 🌿 1. Triết lý cốt lõi: Tiết chế & Khoảng thở (Restraint & Breathing Room)

1. **Nguyên tắc "Hiên nhà" cho Trang chủ (`/`):**
   * Trang chủ là nơi đón nhân sự vào làm việc mỗi sáng: **phải mang lại cảm giác bình tĩnh, ấm áp, nhiều ánh sáng và khoảng thở**.
   * **Tuyệt đối KHÔNG nhồi nhét:** Không biến trang chủ thành bảng điều khiển ngột ngạt (không đặt dày đặc các danh sách deadline, cảnh báo dồn dập, đồng hồ đếm ngược áp lực hay biểu đồ phức tạp).
   * **Nội dung trang chủ chỉ giữ:**
     * Lời chào cá nhân hóa ấm áp kèm câu truyền cảm hứng nhẹ nhàng.
     * Tối đa 1–2 việc gấp nhất cần xử lý hôm nay.
     * Kết nối đồng nghiệp & văn hóa (Kudos Wall, sinh nhật đồng đội, ngày phép cá nhân).
     * Lối tắt nhanh (Quick Actions) đến các tác vụ thường dùng.
   * **Chi tiết công việc thuộc về trang con:** Toàn bộ việc quản lý task chuyển sâu vào `/tasks`, dự án vào `/projects`, doanh số vào `/revenue`.

2. **Dùng Khoảng trắng (Whitespace) thay vì Khung viền (Borders):**
   * Hạn chế đóng khung mọi thứ vào từng cái hộp. Hãy gom nhóm các phần tử bằng khoảng cách đệm (`gap-3`, `space-y-4`, `p-5`) thay vì vẽ viền cứng bao quanh.
   * Tránh lồng quá 2 cấp thẻ (nested cards): Không đặt thẻ con bên trong thẻ mẹ rồi lại lồng thêm viền ở bên trong.

---

## 🎨 2. Hệ thống Màu sắc & Cấp bậc thị giác (Visual Hierarchy)

1. **Quy tắc 90 / 10:**
   * **90% Giao diện:** Sử dụng màu nền sạch (`bg-white`, `bg-zinc-50`), bề mặt trung tính và chữ xám đen (`zinc-950` đến `zinc-500`).
   * **10% Điểm nhấn:** Dành riêng màu thương hiệu (`brand-400` / `brand-500` / `brand-700`) cho nút hành động chính (Primary CTA), chỉ số quan trọng hoặc icon tạo điểm nhấn.

2. **Đừng bắt mọi thứ phải "gào lên" (Refactoring UI Principle):**
   * Giảm độ chói của chữ phụ: Nhãn ngày tháng, mô tả ngắn, số phụ dùng `text-zinc-500` hoặc `text-zinc-400`.
   * Tạo sự phân cấp bằng độ đậm chữ (`font-semibold` vs `font-normal`) và kích thước (`text-sm` vs `text-xs`) thay vì dùng màu đậm.

3. **Khung & Bo góc:**
   * Bo góc hiện đại, mềm mại: Thẻ dùng `rounded-[14px]` đến `rounded-[18px]`, nút bấm dùng `rounded-[10px]`.
   * Đường viền tinh tế: Luôn dùng viền mờ `border-zinc-200` hoặc `border-zinc-200/80` (tránh viền xám đậm hoặc dày thô).
   * Đổ bóng nhẹ: Ưu tiên `shadow-sm` hoặc viền tương phản nhẹ, tránh đổ bóng đen xì nặng nề.

---

## ✨ 3. Thẩm mỹ Chuyển động & Vi tương tác (Micro-interactions)

1. **Nhanh, nhẹ và phản hồi tự nhiên:**
   * Tương tác chuột (hover, focus, active): Thời lượng từ `150ms` đến `200ms` với `ease-out`.
   * Chuyển động nhấc thẻ (`hover:-translate-y-0.5 hover:shadow-sm`) tạo cảm giác xúc giác chân thật.
2. **Không chuyển động vô tận:**
   * Không dùng animation lặp vĩnh viễn (`infinite loop`) trên các phần tử tĩnh vì sẽ gây mỏi mắt và phân tâm người dùng khi đọc văn bản.
3. **Nguyên tắc kỹ thuật Zero-Reflow:**
   * Chỉ animate trên `transform` (`translate`, `scale`, `rotate`) và `opacity`.
   * Tuyệt đối không animate `width`, `height`, `margin`, `top/left` vì sẽ gây giật lag (layout reflow).
   * Luôn hỗ trợ `@media (prefers-reduced-motion: reduce)`.

---

## ❤️ 4. Thiết kế thấu cảm (Empathetic UX)

* **Trạng thái rỗng (Empty States):** Khi không có việc gấp, thay vì hiện một dòng chữ khô khan, hãy đưa ra phản hồi tích cực và lời khen nhẹ nhàng (ví dụ: *"Bạn không có việc gấp hôm nay, cứ thong thả nhé"* kèm icon nảy nhẹ).
* Giao diện phục vụ con người làm việc sáng tạo, phải tạo cảm hứng tích cực thay vì cảm giác bị giám sát.
