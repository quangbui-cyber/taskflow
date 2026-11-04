# myCreative Recorder - Chrome Extension

Extension "1 click ghi biên bản" cho cuộc họp Google Meet, Microsoft Teams và Zoom chạy trong tab Chrome/Edge, tích hợp trực tiếp vào hệ thống myCreative.

## Tính năng chính
1. **1 Click thu âm**: Thu trực tiếp âm thanh tab cuộc họp + micro mà không cần bảng chọn tab màn hình rườm rà.
2. **Tự động bắt lịch**: Tự nhận diện phòng Google Meet (`abc-defg-hij`), Microsoft Teams và Zoom; dùng danh tính phòng để khớp với cuộc họp trong lịch myCreative.
3. **Loopback âm thanh**: Giữ âm thanh tab phát ra loa bình thường (không bị tắt tiếng).
4. **Lọc ồn & chống vọng âm**: Tự động kích hoạt `echoCancellation` & `noiseSuppression`.
5. **Lưu đệm an toàn**: Cắt đoạn 5 giây lưu IndexedDB phòng trường hợp mất mạng hoặc sập nguồn.
6. **Tải lên & tạo biên bản tự động**: Đẩy thẳng lên kho Vercel Blob để myCreative chép lời, tóm tắt và soạn biên bản cho bạn.
7. **Minh bạch**: Tự động gửi thông báo lịch sự vào khung chat Google Meet. Với Teams/Zoom, hãy tự thông báo cho người tham gia trước khi bấm ghi; extension chưa tự gửi chat trên hai nền tảng này.
8. **Tự kết thúc & tạo biên bản trên Google Meet**: Đang ghi mà đóng tab, chuyển sang trang khác, bấm **Rời khỏi cuộc gọi** / **Kết thúc cuộc gọi cho tất cả**, hoặc host kết thúc cuộc họp thì Extension tự dừng ghi, tải lên và tạo biên bản (chi tiết bên dưới).
9. **Thông báo & tải lại**: Có thông báo khi gửi xong hoặc lỗi. Nếu tải lên lỗi (mất mạng, trình duyệt tắt giữa chừng), bản ghi vẫn nằm trên máy, mở popup bấm **Thử tải lại**.

## Khi nào Extension tự dừng ghi trên Google Meet?

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

2. **Ghi biên bản khi họp Google Meet / Teams / Zoom**:
   - Mở cuộc họp trong tab trình duyệt. Với Teams chọn tiếp tục trên trình duyệt; với Zoom chọn **Join from your browser**. Extension không thu âm ứng dụng Teams/Zoom cài riêng trên máy.
   - Bấm icon Extension (hoặc nhấn phím tắt **`Alt + Shift + R`**).
   - Extension sẽ tự động nhận diện cuộc họp khớp với lịch hôm nay.
   - Bấm **Bắt đầu ghi biên bản**.
   - Khi kết thúc: Google Meet tự dừng khi rời họp; Teams/Zoom tự dừng khi đóng tab, đổi sang link phòng khác hoặc nhận ra tiêu đề màn hình kết thúc (tiếng Việt/Anh). Nếu vẫn ở tab cũ mà chưa tự dừng, bấm **Dừng & Lưu biên bản**. Muốn dừng sớm: bấm **Dừng & Lưu biên bản** (hoặc nhấn lại `Alt + Shift + R`).
   - Bản ghi sẽ tự động được tải lên myCreative để myCreative chép lời và soạn biên bản cho bạn.


## Link Teams / Zoom được nhận diện (v1.3.1)

- Teams: `teams.microsoft.com`, `teams.live.com`, `teams.cloud.microsoft`; link `/l/meetup-join/<thread-id>/0`, `/meet/<meeting-id>`, và trang web có `#/meet/<id>` hoặc tham số `threadId`.
- Zoom: `zoom.us`, `zoom.com` và các tên miền con; link `/j/<id>`, `/s/<id>`, `/wc/<id>/join`, `/wc/join/<id>` và `/wc/<id>/start`.
- Các tham số như `pwd`, `p`, `context`, `authuser` không làm đổi danh tính phòng. Link gốc vẫn được giữ để mở lại phòng.
- Khớp lịch chỉ trong các cuộc họp người dùng có quyền tham gia, với khung thời gian ±3 giờ như trước. Teams link ngắn dùng meeting ID và link dài dùng thread ID không thể tự đối chiếu chéo nếu không có thông tin ánh xạ từ Microsoft; hãy dùng cùng dạng link khi lên lịch và mở tab.
- Link Zoom cá nhân dạng `/my/<name>` cần mở vào phòng có ID số trước khi ghi. Trang chủ, chat Teams và link mở ứng dụng riêng không được coi là phòng đang ghi.
- Sau khi cập nhật, bấm **Reload** extension ở `chrome://extensions` / `edge://extensions`, chấp nhận quyền trang mới nếu trình duyệt yêu cầu, rồi F5 tab cuộc họp. Thư mục `extension/` và file `mycreative-meet-extension.zip` cùng chứa bản 1.3.1.
- Triển khai kèm API mới để khớp lịch Teams/Zoom; extension vẫn có thể tạo cuộc họp nhanh nếu server cũ chưa khớp được link. Không cần migration cơ sở dữ liệu.
