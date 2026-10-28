import "server-only";

import { sendGoogleChat, type GoogleChatMessage } from "@/lib/googleChat";
import { estimateReadingMinutes } from "@/lib/creative";
import { emailAppUrl } from "@/lib/email";

export async function sendCreativeDropToGoogleChat(article: {
  slug: string;
  originalTitle: string;
  titleVi: string | null;
  wordCount: number;
  excerpt: string;
}) {
  const webhookUrl =
    process.env.CREATIVE_GOOGLE_CHAT_WEBHOOK_URL ||
    process.env.GOOGLE_CHAT_RECOGNITION_WEBHOOK_URL;

  if (!webhookUrl) {
    return { ok: false, message: "Chưa cấu hình webhook Google Chat cho Góc Đọc." };
  }

  const appUrl = emailAppUrl();
  const articleUrl = `${appUrl}/creative/${article.slug}`;
  const minutes = estimateReadingMinutes(article.wordCount);
  const subtitle = article.titleVi
    ? `${article.titleVi} · ⏱ ${minutes} phút đọc`
    : `⏱ ${minutes} phút đọc`;

  const message: GoogleChatMessage = {
    fallbackText: `📚 Bài viết mới trên Góc Đọc & Cảm Hứng: ${article.originalTitle} - ${article.titleVi || ""}`,
    cardsV2: [
      {
        cardId: `creative-drop-${article.slug}`,
        card: {
          header: {
            title: "📚 GÓC ĐỌC & CẢM HỨNG · DAVE TROTT",
            subtitle,
          },
          sections: [
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: "BÀI VIẾT HÔM NAY",
                    text: `<b>${article.originalTitle}</b>`,
                    bottomLabel: article.titleVi || undefined,
                    wrapText: true,
                  },
                },
                {
                  textParagraph: {
                    text: `<i>"${article.excerpt}"</i>`,
                  },
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: "Khám phá bài đọc →",
                        type: "FILLED",
                        onClick: {
                          openLink: { url: articleUrl },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };

  return sendGoogleChat(webhookUrl, message);
}

