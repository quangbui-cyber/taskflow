import type { Prisma } from "@prisma/client";
import type { GoogleChatMessage } from "./googleChat";
import { ARCHIVED_PROJECT_STATUS_KEYS } from "./types";
import { escapeHtml } from "./taskGoogleChat";

export const PROJECT_WISH_MAX_LENGTH = 500;

/** Phần chúc chương trình là thông tin văn hoá chung cho nhân sự đã đăng nhập. */
export function executionWishWhere(now = new Date()): Prisma.ProjectWhereInput {
  const offset = 7 * 60 * 60 * 1000;
  const vn = new Date(now.getTime() + offset);
  const start = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - offset);
  const end = new Date(start.getTime() + 86400000);
  return {
    status: { notIn: [...ARCHIVED_PROJECT_STATUS_KEYS] },
    executionStartAt: { lt: end },
    OR: [
      { executionEndAt: { gte: start } },
      { executionEndAt: null, executionStartAt: { gte: start } },
    ],
  };
}

export function readProjectWish(body: unknown): { body: string } | { error: string } {
  if (typeof body !== "string") return { error: "Vui lòng nhập lời chúc." };
  const clean = body.trim();
  if (clean.length < 2) return { error: "Lời chúc cần ít nhất 2 ký tự." };
  if (clean.length > PROJECT_WISH_MAX_LENGTH) return { error: "Lời chúc tối đa 500 ký tự." };
  return { body: clean };
}

export function projectWishChatMessage(projectName: string, authorName: string, body: string): GoogleChatMessage {
  return {
    fallbackText: `${authorName} gửi lời chúc đến team ${projectName}: ${body}`,
    cardsV2: [{
      cardId: "project-wish",
      card: {
        header: { title: "🌿 Lời chúc cho chương trình", subtitle: projectName },
        sections: [{ widgets: [
          { textParagraph: { text: `<b>${escapeHtml(authorName)}</b> gửi lời chúc đến team:` } },
          { textParagraph: { text: escapeHtml(body).replace(/\r?\n/g, "<br>") } },
        ] }],
      },
    }],
  };
}
