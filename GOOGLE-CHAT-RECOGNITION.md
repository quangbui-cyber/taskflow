# Kết nối Góc cảm ơn với Google Chat

## Tạo incoming webhook

Trong Google Chat trên máy tính:

1. Mở Space/nhóm muốn nhận lời cảm ơn.
2. Mở **Apps & integrations**.
3. Chọn **Add webhooks** và tạo webhook mới.
4. Sao chép URL webhook. URL này là thông tin bí mật, không đưa vào mã nguồn.

## Cấu hình trong app

Đăng nhập bằng tài khoản **Admin**, mở **Góc cảm ơn → Webhook**, dán URL rồi chọn **Lưu và kiểm tra**. App sẽ gửi một tin thử trước khi lưu. URL được mã hóa trong cơ sở dữ liệu và không hiển thị lại trên trình duyệt.

## Cấu hình bằng biến môi trường (dự phòng)

Nếu không muốn cấu hình qua giao diện, có thể thêm biến môi trường sau:

```env
GOOGLE_CHAT_RECOGNITION_WEBHOOK_URL="https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=..."
```

Khởi động lại app sau khi thêm biến môi trường. Cấu hình đã lưu trong giao diện được ưu tiên hơn biến môi trường.

## Quy tắc gửi

- Chỉ lời cảm ơn có phạm vi **Mọi người trong công ty** được gửi sang Google Chat.
- Lời cảm ơn **Chỉ người nhận** không bao giờ được gửi ra webhook.
- Nếu Google Chat tạm lỗi, lời cảm ơn vẫn được lưu trong app và người dùng vẫn nhận thông báo nội bộ.
- Nội dung nhập được vô hiệu hóa cú pháp mention/link đặc biệt trước khi gửi, tránh vô tình nhắc cả Space.
