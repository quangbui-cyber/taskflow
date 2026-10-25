import { googleClientCredentials } from "@/lib/googleAuth";
import { decryptToken } from "@/lib/googleMeet";
import { prisma } from "@/lib/prisma";

/**
 * Gọi Google Drive API bằng kết nối chung của app (tài khoản noreply).
 * Mọi file và thư mục nằm trong một Shared Drive của công ty.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DEFAULT_SHARED_DRIVE_ID = "0AL-5HJ8czOkOUk9PVA";
const DEFAULT_DRIVE_ACCOUNT = "noreply@creativestation.vn";

export function sharedDriveId() {
  return process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID?.trim() || DEFAULT_SHARED_DRIVE_ID;
}

/** Tài khoản Google duy nhất được dùng làm kho lưu trữ. */
export function expectedDriveAccount() {
  return (process.env.GOOGLE_DRIVE_ACCOUNT?.trim() || DEFAULT_DRIVE_ACCOUNT).toLowerCase();
}

export class DriveNotConnectedError extends Error {}

/** Lỗi do Google trả về, có mã HTTP để biết có nên thử lại không. */
export class DriveApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// ---------- Access token ----------

let cached: { token: string; expiresAt: number } | null = null;

export function forgetDriveAccessToken() {
  cached = null;
}

export async function driveConnected() {
  const row = await prisma.googleDriveConnection.findUnique({ where: { id: "default" }, select: { id: true } });
  return Boolean(row) && Boolean(googleClientCredentials());
}

async function driveAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const client = googleClientCredentials();
  const row = await prisma.googleDriveConnection.findUnique({ where: { id: "default" } });
  const refreshToken = row ? decryptToken(row.token) : null;
  if (!client || !row || !refreshToken) throw new DriveNotConnectedError();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
  };
  if (!response.ok || typeof body.access_token !== "string") {
    if (body.error === "invalid_grant") {
      // Tài khoản đổi mật khẩu hoặc thu hồi quyền: báo Admin kết nối lại.
      await recordDriveError("Google đã thu hồi quyền của app. Admin cần kết nối lại Google Drive.");
      throw new DriveNotConnectedError();
    }
    throw new DriveApiError(`Google token refresh failed (${response.status}).`, response.status);
  }
  const ttl = typeof body.expires_in === "number" ? body.expires_in : 3000;
  cached = { token: body.access_token, expiresAt: Date.now() + ttl * 1000 };
  return body.access_token;
}

export async function recordDriveError(message: string) {
  await prisma.googleDriveConnection
    .update({ where: { id: "default" }, data: { lastError: message.slice(0, 500), lastErrorAt: new Date() } })
    .catch(() => undefined);
}

async function driveFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const token = await driveAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 30_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DriveApiError(`Drive ${response.status}: ${detail.slice(0, 300)}`, response.status);
  }
  return response;
}

function withAllDrives(path: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams({ supportsAllDrives: "true", ...params });
  return `${path}?${search.toString()}`;
}

// ---------- Thư mục ----------

/** Tên thư mục an toàn cho Drive: bỏ ký tự điều khiển, gọn khoảng trắng, tối đa 120 ký tự. */
export function driveFolderName(value: string) {
  const name = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return name || "Không tên";
}

export async function createDriveFolder(name: string, parentId: string): Promise<string> {
  const response = await driveFetch(withAllDrives(`${API}/files`, { fields: "id" }), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name: driveFolderName(name), mimeType: FOLDER_MIME_TYPE, parents: [parentId] }),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

export async function renameDriveItem(fileId: string, name: string) {
  await driveFetch(withAllDrives(`${API}/files/${encodeURIComponent(fileId)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name }),
  });
}

/** Đưa file/thư mục vào thùng rác của Shared Drive (khôi phục được trong 30 ngày). */
export async function trashDriveItem(fileId: string) {
  try {
    await driveFetch(withAllDrives(`${API}/files/${encodeURIComponent(fileId)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ trashed: true }),
    });
  } catch (error) {
    // File đã bị xoá tay trên Drive thì coi như xong.
    if (error instanceof DriveApiError && error.status === 404) return;
    throw error;
  }
}

/** Kiểm tra tài khoản đã kết nối có vào được Shared Drive không (dùng ngay sau khi kết nối). */
export async function sharedDriveName(): Promise<string> {
  const response = await driveFetch(`${API}/drives/${encodeURIComponent(sharedDriveId())}?fields=name`);
  const body = (await response.json()) as { name: string };
  return body.name;
}

// ---------- File ----------

export type DriveFileMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  parents: string[];
  trashed: boolean;
};

export async function driveFileMeta(fileId: string): Promise<DriveFileMeta> {
  const response = await driveFetch(
    withAllDrives(`${API}/files/${encodeURIComponent(fileId)}`, { fields: "id,name,mimeType,size,parents,trashed" })
  );
  const body = (await response.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    parents?: string[];
    trashed?: boolean;
  };
  return {
    id: body.id,
    name: body.name,
    mimeType: body.mimeType,
    size: body.size ? Number(body.size) : null,
    parents: body.parents ?? [],
    trashed: Boolean(body.trashed),
  };
}

function multipartBody(metadata: Record<string, unknown>, mimeType: string, data: Uint8Array) {
  const boundary = `mycreative-${crypto.randomUUID()}`;
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head, 0);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/**
 * Tải nội dung lên Drive. `convertTo` = GOOGLE_DOC_MIME_TYPE để Drive chuyển .docx thành Google Doc.
 * Có `fileId` thì ghi đè nội dung file cũ (giữ link, Drive giữ lịch sử phiên bản).
 */
export async function uploadDriveFile(input: {
  name: string;
  mimeType: string;
  data: Uint8Array;
  parentId?: string;
  fileId?: string;
  convertTo?: string;
}): Promise<string> {
  const metadata: Record<string, unknown> = { name: input.name };
  if (input.convertTo) metadata.mimeType = input.convertTo;
  if (!input.fileId && input.parentId) metadata.parents = [input.parentId];
  const { body, contentType } = multipartBody(metadata, input.mimeType, input.data);
  const url = input.fileId
    ? withAllDrives(`${UPLOAD_API}/files/${encodeURIComponent(input.fileId)}`, { uploadType: "multipart", fields: "id" })
    : withAllDrives(`${UPLOAD_API}/files`, { uploadType: "multipart", fields: "id" });
  const response = await driveFetch(url, {
    method: input.fileId ? "PATCH" : "POST",
    headers: { "Content-Type": contentType },
    body,
    timeoutMs: 120_000,
  });
  const result = (await response.json()) as { id: string };
  return result.id;
}

/**
 * Mở phiên tải lên nối tiếp để trình duyệt đẩy file thẳng lên Drive (không qua máy chủ app,
 * nên không vướng giới hạn 4,5 MB của Vercel). `origin` phải là địa chỉ app để Google cho phép CORS.
 */
export async function createResumableUpload(input: {
  name: string;
  mimeType: string;
  size: number;
  parentId: string;
  origin: string;
  appProperties: Record<string, string>;
}): Promise<string> {
  const response = await driveFetch(
    withAllDrives(`${UPLOAD_API}/files`, { uploadType: "resumable", fields: "id,size,parents" }),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.size),
        Origin: input.origin,
      },
      body: JSON.stringify({ name: input.name, parents: [input.parentId], appProperties: input.appProperties }),
    }
  );
  const location = response.headers.get("location");
  if (!location) throw new DriveApiError("Drive did not return an upload URL.", 502);
  return location;
}

/** Nội dung file để trả về cho người tải. Google Doc thì xuất ra .docx. */
export async function downloadDriveFile(fileId: string, mimeType: string) {
  const url =
    mimeType === GOOGLE_DOC_MIME_TYPE
      ? `${API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(DOCX_MIME)}`
      : withAllDrives(`${API}/files/${encodeURIComponent(fileId)}`, { alt: "media" });
  return driveFetch(url, { timeoutMs: 120_000 });
}

/** Link mở file trên Google Drive (người xem phải được share thư mục). */
export function driveViewUrl(fileId: string, mimeType: string) {
  if (mimeType === GOOGLE_DOC_MIME_TYPE) return `https://docs.google.com/document/d/${fileId}/edit`;
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// ---------- Quyền chia sẻ ----------

export type DrivePermission = { id: string; email: string; role: string; inherited: boolean };

export async function listDirectPermissions(fileId: string): Promise<DrivePermission[]> {
  const response = await driveFetch(
    withAllDrives(`${API}/files/${encodeURIComponent(fileId)}/permissions`, {
      fields: "permissions(id,type,emailAddress,role,permissionDetails(inherited))",
      pageSize: "100",
    })
  );
  const body = (await response.json()) as {
    permissions?: {
      id: string;
      type: string;
      emailAddress?: string;
      role: string;
      permissionDetails?: { inherited?: boolean }[];
    }[];
  };
  return (body.permissions ?? [])
    .filter((permission) => permission.type === "user" && permission.emailAddress)
    .map((permission) => ({
      id: permission.id,
      email: permission.emailAddress!.toLowerCase(),
      role: permission.role,
      // Quyền thừa hưởng từ thành viên Shared Drive (noreply) thì không đụng tới.
      inherited: (permission.permissionDetails ?? []).length > 0 &&
        (permission.permissionDetails ?? []).every((detail) => detail.inherited),
    }));
}

export async function shareDriveItem(fileId: string, email: string, role: "reader" | "writer" = "reader") {
  await driveFetch(
    withAllDrives(`${API}/files/${encodeURIComponent(fileId)}/permissions`, { sendNotificationEmail: "false" }),
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ type: "user", role, emailAddress: email }),
    }
  );
}

export async function unshareDriveItem(fileId: string, permissionId: string) {
  try {
    await driveFetch(withAllDrives(`${API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`), {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof DriveApiError && error.status === 404) return;
    throw error;
  }
}
