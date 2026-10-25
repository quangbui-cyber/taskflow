import {
  canAddChatApp,
  canManageChatSpaces,
  clearGoogleConnection,
  googleAccessToken,
  GoogleNotConnectedError,
  isGoogleApiSetupError,
} from "@/lib/googleWorkspace";

/**
 * Tạo nhóm Google Chat cho dự án và thêm thành viên, bằng tài khoản Google của người bấm
 * (Google Chat API, quyền tạo nhóm + quản lý thành viên; không đọc tin nhắn).
 */

const CHAT_API = "https://chat.googleapis.com/v1";
/** spaces:setup nhận tối đa 49 người ngoài người tạo; còn lại thêm từng người. */
const SETUP_MEMBER_LIMIT = 49;

/** Project Google Cloud chưa bật / chưa cấu hình Google Chat API. */
export class GoogleChatSetupError extends Error {}

export type ChatSpace = { name: string; uri: string };

/** Tên nhóm: tên dự án, tối đa 128 ký tự theo giới hạn của Google Chat. */
export function chatSpaceDisplayName(projectName: string, suffix?: string) {
  const base = projectName.normalize("NFC").replace(/\s+/g, " ").trim() || "Dự án";
  const tail = suffix ? ` (${suffix})` : "";
  return `${base.slice(0, 128 - tail.length).trim()}${tail}`;
}

/** Bỏ trùng, bỏ người tạo (Google tự thêm), chỉ nhận email hợp lệ. */
export function chatMemberEmails(emails: readonly string[], creatorEmail: string) {
  const creator = creatorEmail.toLowerCase();
  return [
    ...new Set(
      emails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) && email !== creator),
    ),
  ];
}

export function isChatSpaceName(value: string) {
  return /^spaces\/[A-Za-z0-9_-]{1,100}$/.test(value);
}

function membership(email: string) {
  return { member: { name: `users/${email}`, type: "HUMAN" } };
}

async function chatFetch(userId: string, accessToken: string, path: string, body: unknown) {
  const response = await fetch(`${CHAT_API}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) {
    const detail = await response.text().catch(() => "");
    if (isGoogleApiSetupError(detail)) throw new GoogleChatSetupError();
    if (response.status === 401) {
      await clearGoogleConnection(userId);
      throw new GoogleNotConnectedError();
    }
    // 403 khác (vd không có quyền quản lý nhóm này): trả về cho nơi gọi xử lý.
    return { response, detail };
  }
  return { response, detail: "" };
}

/** Tạo nhóm mới kèm thành viên. Trùng tên nhóm có sẵn thì thêm hậu tố. */
export async function createChatSpace(
  userId: string,
  options: { displayName: string; fallbackSuffix: string; memberEmails: string[] },
): Promise<ChatSpace & { pending: string[] }> {
  const { accessToken, email } = await googleAccessToken(userId, canManageChatSpaces);
  const members = chatMemberEmails(options.memberEmails, email);
  const first = members.slice(0, SETUP_MEMBER_LIMIT);

  let displayName = options.displayName;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { response } = await chatFetch(userId, accessToken, "spaces:setup", {
      space: { spaceType: "SPACE", displayName },
      memberships: first.map(membership),
    });
    if (response.status === 409 && attempt === 0) {
      displayName = chatSpaceDisplayName(options.displayName, options.fallbackSuffix);
      continue;
    }
    if (!response.ok) throw new Error(`Google Chat space setup failed (${response.status}).`);
    const space = (await response.json()) as { name?: unknown; spaceUri?: unknown };
    if (typeof space.name !== "string" || !isChatSpaceName(space.name)) {
      throw new Error("Google Chat returned no space.");
    }
    const uri =
      typeof space.spaceUri === "string" && space.spaceUri.startsWith("https://")
        ? space.spaceUri
        : `https://chat.google.com/room/${space.name.slice("spaces/".length)}`;
    return { name: space.name, uri, pending: members.slice(SETUP_MEMBER_LIMIT) };
  }
  throw new Error("Google Chat space name is taken.");
}

/** Thêm người vào nhóm có sẵn; ai đã có trong nhóm thì bỏ qua. Trả về số người thêm được / lỗi. */
export async function addChatMembers(userId: string, spaceName: string, memberEmails: string[]) {
  if (!isChatSpaceName(spaceName)) throw new Error("Invalid Google Chat space.");
  const { accessToken, email } = await googleAccessToken(userId, canManageChatSpaces);
  let added = 0;
  let already = 0;
  const failed: string[] = [];
  for (const member of chatMemberEmails(memberEmails, email)) {
    const { response } = await chatFetch(userId, accessToken, `${spaceName}/members`, membership(member));
    if (response.ok) added += 1;
    else if (response.status === 409) already += 1;
    else failed.push(member);
  }
  return { added, already, failed };
}

/**
 * Thêm Chat app "myCreative" vào nhóm (bằng tài khoản Google của người quản lý nhóm), để app gửi
 * thông báo task vào nhóm. Đã có trong nhóm thì coi như xong.
 */
export async function addChatAppToSpace(userId: string, spaceName: string): Promise<void> {
  if (!isChatSpaceName(spaceName)) throw new Error("Invalid Google Chat space.");
  const { accessToken } = await googleAccessToken(userId, canAddChatApp);
  const { response } = await chatFetch(userId, accessToken, `${spaceName}/members`, {
    member: { name: "users/app", type: "BOT" },
  });
  if (response.ok || response.status === 409) return;
  throw new Error(`Adding the Chat app failed (${response.status}).`);
}
