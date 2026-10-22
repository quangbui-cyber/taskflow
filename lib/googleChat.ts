export type GoogleChatResult = { ok: true } | { ok: false; error: string };

export type GoogleChatWidget =
  | { textParagraph: { text: string } }
  | { decoratedText: { topLabel: string; text: string; wrapText: boolean } }
  | { buttonList: { buttons: { text: string; onClick: { openLink: { url: string } } }[] } };

export type GoogleChatMessage = {
  text?: string;
  fallbackText?: string;
  cardsV2?: {
    cardId: string;
    card: {
      header: { title: string; subtitle: string };
      sections: { widgets: GoogleChatWidget[] }[];
    };
  }[];
};

export function validateGoogleChatWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "chat.googleapis.com" &&
      url.pathname.startsWith("/v1/spaces/") &&
      url.pathname.endsWith("/messages") &&
      Boolean(url.searchParams.get("key")) &&
      Boolean(url.searchParams.get("token"))
    );
  } catch {
    return false;
  }
}

/** Gửi một chiều tới Space đã cấu hình; lỗi Chat không làm hỏng thao tác chính. */
export async function sendGoogleChat(
  webhookUrl: string,
  message: string | GoogleChatMessage
): Promise<GoogleChatResult> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(typeof message === "string" ? { text: message } : message),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      console.error("Google Chat webhook error:", response.status);
      return {
        ok: false,
        error: "Google Chat từ chối webhook. Hãy kiểm tra lại URL hoặc Space.",
      };
    }

    return { ok: true };
  } catch (error) {
    console.error("Google Chat webhook error:", error);
    return {
      ok: false,
      error: "Không thể kết nối Google Chat. Hãy thử lại sau.",
    };
  }
}
