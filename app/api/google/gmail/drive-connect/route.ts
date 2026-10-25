import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { googleAuthConfigured } from "@/lib/googleAuth";
import { googleDriveCookieName, googleDriveCookieOptions, newGoogleDriveAttempt } from "@/lib/googleDriveAuth";

// Nằm dưới /api/google/gmail để dùng chung địa chỉ quay về đã khai báo với Google.

/** Admin mở trang xin quyền Google Drive cho tài khoản kho lưu trữ của app. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (user.role !== "ADMIN") return NextResponse.redirect(new URL("/", request.url));
  if (!googleAuthConfigured()) return NextResponse.redirect(new URL("/admin?tab=storage&drive=unavailable", request.url));

  const redirectUri = new URL("/api/google/gmail/callback", request.url).toString();
  const { authorizationUrl, cookie } = await newGoogleDriveAttempt(user.id, redirectUri);
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(googleDriveCookieName(), cookie, googleDriveCookieOptions());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
