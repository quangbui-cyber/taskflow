/**
 * Gửi tin nhắn lên Google Chat qua Incoming Webhook.
 *
 * Cách lấy URL webhook:
 *   Mở Space (group chat) trên Google Chat → tên Space ▸ Apps & integrations
 *   → Webhooks → Add webhook → đặt tên → Copy URL.
 * Rồi đặt biến môi trường GOOGLE_CHAT_WEBHOOK_URL = URL đó.
 *
 * Nếu chưa cấu hình biến này thì hàm bỏ qua (app vẫn chạy bình thường).
 * Lỗi mạng khi gửi không bao giờ làm hỏng thao tác chính (đã bọc try/catch).
 */
export function googleChatEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CHAT_WEBHOOK_URL);
}

export async function sendGoogleChat(text: string): Promise<void> {
  const url = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    // Không để lỗi gửi chat ảnh hưởng tới việc tạo/hoàn thành task
    console.error("Google Chat webhook error:", error);
  }
}
