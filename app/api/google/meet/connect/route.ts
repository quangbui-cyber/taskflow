import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  googleMeetConfigured,
  googleMeetCookieName,
  googleMeetCookieOptions,
  newGoogleMeetAttempt,
} from "@/lib/googleMeet";

/** Mở trang xin quyền "tạo phòng Google Meet" của Google cho người đang đăng nhập. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!googleMeetConfigured()) {
    return NextResponse.redirect(new URL("/google-meet-connected?result=unavailable", request.url));
  }

  const redirectUri = new URL("/api/google/meet/callback", request.url).toString();
  const { authorizationUrl, cookie } = await newGoogleMeetAttempt(user.id, redirectUri);
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(googleMeetCookieName(), cookie, googleMeetCookieOptions());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
