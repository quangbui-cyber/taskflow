import { type GoogleChatMessage, type GoogleChatResult } from "@/lib/googleChat";
import { chatAppConfigured, sendChatAppMessage } from "@/lib/googleChatApp";

export type ProjectChatTarget = {
  googleChatSpaceName: string | null;
};

/** Dự án có nhóm Chat nhận được thông báo không (có nhóm và máy chủ đã cài Chat app). */
export function hasProjectChat(project: ProjectChatTarget) {
  return Boolean(project.googleChatSpaceName && chatAppConfigured());
}

/** Gửi thông báo vào nhóm Google Chat của dự án, dưới tên Chat app "myCreative". */
export async function sendProjectChat(
  project: ProjectChatTarget,
  message: string | GoogleChatMessage
): Promise<GoogleChatResult | null> {
  if (!hasProjectChat(project) || !project.googleChatSpaceName) return null;
  return sendChatAppMessage(project.googleChatSpaceName, message);
}
