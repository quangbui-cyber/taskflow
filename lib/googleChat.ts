export type GoogleChatResult = { ok: true } | { ok: false; error: string };

type OpenLink = { openLink: { url: string } };

/** Biểu tượng có sẵn của Google Chat (knownIcon). */
export type GoogleChatIcon = "BOOKMARK" | "PERSON" | "CLOCK" | "MEMBERSHIP" | "DESCRIPTION" | "MULTIPLE_PEOPLE";

export type GoogleChatButton = {
  text: string;
  onClick: OpenLink;
  type?: "FILLED" | "OUTLINED" | "BORDERLESS";
};

export type GoogleChatWidget =
  | { textParagraph: { text: string } }
  | {
      decoratedText: {
        topLabel?: string;
        text: string;
        bottomLabel?: string;
        wrapText: boolean;
        startIcon?: { knownIcon: GoogleChatIcon };
        onClick?: OpenLink;
      };
    }
  | { buttonList: { buttons: GoogleChatButton[] } }
  | { divider: Record<string, never> };

export type GoogleChatSection = { header?: string; widgets: GoogleChatWidget[] };

export type GoogleChatMessage = {
  text?: string;
  fallbackText?: string;
  cardsV2?: {
    cardId: string;
    card: {
      header: { title: string; subtitle: string };
      sections: GoogleChatSection[];
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
