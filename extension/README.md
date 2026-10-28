# myCreative Recorder - Chrome Extension

Extension "1 click ghi biên bản" cho cuộc họp Google Meet, tích hợp trực tiếp vào hệ thống myCreative.

## Tính năng chính
1. **1 Click thu âm**: Thu trực tiếp âm thanh tab cuộc họp + micro mà không cần bảng chọn tab màn hình rườm rà.
2. **Tự động bắt lịch**: Tự nhận diện mã phòng Google Meet (`abc-defg-hij`) và khớp với cuộc họp trong lịch myCreative.
3. **Loopback âm thanh**: Giữ âm thanh tab phát ra loa bình thường (không bị tắt tiếng).
4. **Lọc ồn & chống vọng âm**: Tự động kích hoạt `echoCancellation` & `noiseSuppression`.
5. **Lưu đệm an toàn**: Cắt đoạn 5 giây lưu IndexedDB phòng trường hợp mất mạng hoặc sập nguồn.
6. **Tải lên & tạo biên bản tự động**: Đẩy thẳng lên kho Vercel Blob và kích hoạt AI Groq + Gemini chép lời, tóm tắt biên bản.
7. **Minh bạch**: Tự động gửi thông báo lịch sự vào khung chat Google Meet.

---

## Hướng dẫn cài đặt thử nghiệm (Load Unpacked)

1. Mở trình duyệt Chrome hoặc Edge:
   - Chrome: gõ vào thanh địa chỉ `chrome://extensions`
   - Edge: gõ vào thanh địa chỉ `edge://extensions`
2. Bật công tắc **Developer mode (Chế độ cho nhà phát triển)** ở góc trên bên phải.
3. Bấm nút **Load unpacked (Tải tiện ích đã giải nén)**.
4. Chọn thư mục `extension` trong mã nguồn dự án này.
5. Icon **myCreative Recorder** sẽ xuất hiện trên thanh tiện ích của trình duyệt!

---

## Cách sử dụng

1. **Kết nối tài khoản (1 lần duy nhất)**:
   - Bấm icon Extension → **Kết nối ngay** → hệ thống mở trang `/profile/extension` trên myCreative (đăng nhập nếu được hỏi).
   - Bấm **Cho phép kết nối Extension**. Extension tự nhận và lưu token, trang hiện "Đã kết nối Extension".
   - Lần đầu, Extension tự mở trang cài đặt để xin quyền micro: bấm **Cho phép** ở hộp thoại của Chrome.
   - Nếu trang báo "Chưa thấy Extension trả lời" (chưa cài, hoặc Extension bản cũ): bấm **Sao chép**, rồi dán token vào ô Token trong trang cài đặt của Extension và bấm **Lưu**.

2. **Ghi biên bản khi họp Google Meet**:
   - Mở tab cuộc họp Google Meet.
   - Bấm icon Extension (hoặc nhấn phím tắt **`Alt + Shift + R`**).
   - Extension sẽ tự động nhận diện cuộc họp khớp với lịch hôm nay.
   - Bấm **Bắt đầu ghi biên bản**.
   - Khi kết thúc cuộc họp: bấm **Dừng & Lưu biên bản** (hoặc nhấn lại `Alt + Shift + R`).
   - Bản ghi sẽ tự động được tải lên myCreative và chuyển sang AI để chép lời + tóm tắt biên bản!
