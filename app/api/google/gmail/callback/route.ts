import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  encryptGoogleToken,
  exchangeGoogleWorkspaceCode,
  googleWorkspaceCookieName,
  googleWorkspaceCookieOptions,
  revokeGoogleToken,
  verifyGoogleWorkspaceAttempt,
} from "@/lib/googleWorkspace";
import { expectedDriveAccount, forgetDriveAccessToken, recordDriveError, sharedDriveName } from "@/lib/googleDrive";
import {
  exchangeGoogleDriveCode,
  googleDriveCookieName,
  googleDriveCookieOptions,
  verifyGoogleDriveAttempt,
} from "@/lib/googleDriveAuth";

type Result = "connected" | "failed" | "denied" | "mismatch";

function finish(request: NextRequest, result: Result, returnTo = "/profile") {
  const url = new URL(returnTo, request.url);
  url.searchParams.set("google", result);
  const response = NextResponse.redirect(url);
  response.cookies.set(googleWorkspaceCookieName(), "", { ...googleWorkspaceCookieOptions(), maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function finishDrive(request: NextRequest, result: string) {
  const url = new URL("/admin", request.url);
  url.searchParams.set("tab", "storage");
  url.searchParams.set("drive", result);
  const response = NextResponse.redirect(url);
  response.cookies.set(googleDriveCookieName(), "", { ...googleDriveCookieOptions(), maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Lượt Admin kết nối Google Drive cho cả app (tài khoản kho lưu trữ). */
async function handleDrive(request: NextRequest, attempt: Awaited<ReturnType<typeof verifyGoogleDriveAttempt>>) {
  const params = request.nextUrl.searchParams;
  if (params.get("error") === "access_denied") return finishDrive(request, "denied");
  const code = params.get("code");
  if (!code || attempt.state !== params.get("state")) return finishDrive(request, "failed");
  if (new URL(attempt.redirectUri).origin !== request.nextUrl.origin) return finishDrive(request, "failed");
  const user = await getCurrentUser();
  if (!user || user.id !== attempt.userId || user.role !== "ADMIN") return finishDrive(request, "failed");

  const granted = await exchangeGoogleDriveCode(code, attempt);
  if (!granted) return finishDrive(request, "denied");
  const token = encryptGoogleToken(granted.refreshToken);
  // Chỉ nhận đúng tài khoản kho lưu trữ, tránh lưu file vào Drive cá nhân của Admin.
  if (granted.email !== expectedDriveAccount()) {
    await revokeGoogleToken(token);
    return finishDrive(request, "mismatch");
  }
  const previous = await prisma.googleDriveConnection.findUnique({ where: { id: "default" }, select: { token: true } });
  await prisma.googleDriveConnection.upsert({
    where: { id: "default" },
    create: { email: granted.email, token, scopes: granted.scopes, connectedById: user.id },
    update: {
      email: granted.email, token, scopes: granted.scopes, connectedById: user.id,
      connectedAt: new Date(), lastError: null, lastErrorAt: null,
    },
  });
  forgetDriveAccessToken();
  if (previous && previous.token !== token) await revokeGoogleToken(previous.token);
  try {
    await sharedDriveName();
  } catch {
    // Kết nối được nhưng tài khoản chưa vào được Shared Drive: giữ kết nối, báo Admin.
    await recordDriveError("Tài khoản đã kết nối nhưng chưa vào được Shared Drive. Kiểm tra tài khoản là thành viên Shared Drive.");
    return finishDrive(request, "no-drive");
  }
  return finishDrive(request, "connected");
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const driveCookie = request.cookies.get(googleDriveCookieName())?.value;
  const driveAttempt = driveCookie ? await verifyGoogleDriveAttempt(driveCookie).catch(() => null) : null;
  if (driveAttempt && driveAttempt.state === params.get("state")) {
    try {
      return await handleDrive(request, driveAttempt);
    } catch {
      return finishDrive(request, "failed");
    }
  }

  const cookie = request.cookies.get(googleWorkspaceCookieName())?.value;
  const attempt = cookie ? await verifyGoogleWorkspaceAttempt(cookie).catch(() => null) : null;
  const returnTo = attempt?.returnTo ?? "/profile";
  if (params.get("error") === "access_denied") return finish(request, "denied", returnTo);
  const code = params.get("code");
  const state = params.get("state");
  if (!attempt || !code || !state) {
    // Google gọi lại lần nữa (tải lại trang, bấm Back) sau khi đã kết nối xong: vẫn báo thành công.
    const user = await getCurrentUser().catch(() => null);
    if (user) {
      const row = await prisma.user.findUnique({ where: { id: user.id }, select: { googleToken: true } });
      if (row?.googleToken) return finish(request, "connected", returnTo);
    }
    return finish(request, "failed", returnTo);
  }

  try {
    if (attempt.state !== state) return finish(request, "failed", returnTo);
    if (new URL(attempt.redirectUri).origin !== request.nextUrl.origin) return finish(request, "failed", returnTo);
    // Quyền phải về đúng người đã bấm kết nối.
    const user = await getCurrentUser();
    if (!user || user.id !== attempt.userId) return finish(request, "failed", returnTo);

    const granted = await exchangeGoogleWorkspaceCode(code, attempt);
    if (!granted) return finish(request, "denied", returnTo);
    const token = encryptGoogleToken(granted.refreshToken);
    // Chỉ nhận đúng tài khoản công ty trùng email đăng nhập, không nhận Gmail cá nhân.
    if (granted.email !== user.email.toLowerCase()) {
      await revokeGoogleToken(token);
      return finish(request, "mismatch", returnTo);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { googleToken: token, googleEmail: granted.email, googleScopes: granted.scopes },
    });
    return finish(request, "connected", returnTo);
  } catch {
    return finish(request, "failed", returnTo);
  }
}
