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

type Result = "connected" | "failed" | "denied" | "mismatch";

function finish(request: NextRequest, result: Result, returnTo = "/profile") {
  const url = new URL(returnTo, request.url);
  url.searchParams.set("google", result);
  const response = NextResponse.redirect(url);
  response.cookies.set(googleWorkspaceCookieName(), "", { ...googleWorkspaceCookieOptions(), maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
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
