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
8. **Tự kết thúc & tạo biên bản**: Đang ghi mà đóng tab, chuyển sang trang khác, bấm **Rời khỏi cuộc gọi** / **Kết thúc cuộc gọi cho tất cả**, hoặc host kết thúc cuộc họp thì Extension tự dừng ghi, tải lên và tạo biên bản (chi tiết bên dưới).
9. **Thông báo & tải lại**: Có thông báo khi gửi xong hoặc lỗi. Nếu tải lên lỗi (mất mạng, trình duyệt tắt giữa chừng), bản ghi vẫn nằm trên máy, mở popup bấm **Thử tải lại**.

## Khi nào Extension tự dừng ghi?

| Tình huống | Cách phát hiện | Độ trễ |
| --- | --- | --- |
| Đóng tab Meet | `tabs.onRemoved`, và track âm thanh tab kết thúc ngay trong offscreen | Tức thì |
| Tab chuyển sang trang khác (không còn ở phòng này) | `tabs.onUpdated` | Tức thì |
| Bấm **Rời khỏi cuộc gọi** / **Kết thúc cuộc gọi cho tất cả** | Bắt cú bấm nút + tất cả kết nối cuộc gọi (RTCPeerConnection) đã đóng | ~2s + 5s chờ |
| Host kết thúc họp, bị mời ra, hoặc màn hình "Bạn đã rời khỏi cuộc họp" | Kết nối đóng hết (không phụ thuộc ngôn ngữ) hoặc nhận ra màn hình sau cuộc gọi | ~10s + 5s chờ |
| Đủ 225 phút | Đồng hồ | Tức thì |

5 giây chờ cuối là để bấm nhầm "Rời" rồi "Tham gia lại" thì không bị cắt bản ghi. Mất mạng thoáng qua (Meet tự nối lại) không bị tính là rời họp vì cần mất kết nối liên tục ≥ 10s.

> Sau khi cập nhật Extension, **tải lại (F5) tab Meet đang mở** để bật nhận diện kết nối. Tab chưa tải lại vẫn dùng được đóng tab và nhận diện màn hình "đã rời khỏi cuộc họp".

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
   - Khi kết thúc cuộc họp: chỉ cần rời cuộc họp hoặc đóng tab, Extension tự dừng và lưu biên bản. Muốn dừng sớm: bấm **Dừng & Lưu biên bản** (hoặc nhấn lại `Alt + Shift + R`).
   - Bản ghi sẽ tự động được tải lên myCreative và chuyển sang AI để chép lời + tóm tắt biên bản!
