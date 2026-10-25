import { sendGoogleChat, type GoogleChatMessage, type GoogleChatResult } from "@/lib/googleChat";
import { chatAppConfigured, sendChatAppMessage } from "@/lib/googleChatApp";

export type ProjectChatTarget = {
  googleChatSpaceName: string | null;
  googleChatWebhookUrl: string | null;
};

/** Dự án có chỗ nhận thông báo Chat không (nhóm Chat của app, hoặc webhook cũ còn sót). */
export function hasProjectChat(project: ProjectChatTarget) {
  return Boolean((project.googleChatSpaceName && chatAppConfigured()) || project.googleChatWebhookUrl);
}

/**
 * Gửi thông báo vào Google Chat của dự án: qua Chat app "myCreative" nếu dự án có nhóm Chat.
 * Dự án cũ chỉ có webhook (chưa tạo nhóm) thì vẫn gửi qua webhook cho tới khi tạo nhóm.
 */
export async function sendProjectChat(
  project: ProjectChatTarget,
  message: string | GoogleChatMessage
): Promise<GoogleChatResult | null> {
  if (project.googleChatSpaceName && chatAppConfigured()) {
    return sendChatAppMessage(project.googleChatSpaceName, message);
  }
  if (project.googleChatWebhookUrl) return sendGoogleChat(project.googleChatWebhookUrl, message);
  return null;
}
