import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  googleWorkspaceConfigured,
  googleWorkspaceCookieName,
  googleWorkspaceCookieOptions,
  newGoogleWorkspaceAttempt,
  safeReturnPath,
} from "@/lib/googleWorkspace";

// Đường dẫn giữ tên "gmail" vì đã khai báo địa chỉ quay về này với Google.

/** Mở trang xin quyền Google Workspace (gửi email, tạo nhóm Chat) cho người đang đăng nhập. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));
  if (!googleWorkspaceConfigured()) {
    return NextResponse.redirect(new URL(withResult(returnTo, "unavailable"), request.url));
  }

  const redirectUri = new URL("/api/google/gmail/callback", request.url).toString();
  const { authorizationUrl, cookie } = await newGoogleWorkspaceAttempt(user, redirectUri, returnTo);
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(googleWorkspaceCookieName(), cookie, googleWorkspaceCookieOptions());
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function withResult(path: string, result: string) {
  const url = new URL(path, "http://app.local");
  url.searchParams.set("google", result);
  return `${url.pathname}${url.search}`;
}
