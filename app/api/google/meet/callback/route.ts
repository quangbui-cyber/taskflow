import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  encryptToken,
  exchangeGoogleMeetCode,
  googleMeetCookieName,
  googleMeetCookieOptions,
  verifyGoogleMeetAttempt,
} from "@/lib/googleMeet";

function finish(request: NextRequest, result: "connected" | "failed" | "denied") {
  const response = NextResponse.redirect(new URL(`/google-meet-connected?result=${result}`, request.url));
  response.cookies.set(googleMeetCookieName(), "", { ...googleMeetCookieOptions(), maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get("error") === "access_denied") return finish(request, "denied");
  const cookie = request.cookies.get(googleMeetCookieName())?.value;
  const code = params.get("code");
  const state = params.get("state");
  if (!cookie || !code || !state) {
    // Google gọi lại lần nữa (tải lại trang, bấm Back) sau khi đã kết nối xong: vẫn báo thành công.
    const user = await getCurrentUser().catch(() => null);
    if (user) {
      const row = await prisma.user.findUnique({ where: { id: user.id }, select: { googleMeetToken: true } });
      if (row?.googleMeetToken) return finish(request, "connected");
    }
    return finish(request, "failed");
  }

  try {
    const attempt = await verifyGoogleMeetAttempt(cookie);
    if (attempt.state !== state) return finish(request, "failed");
    if (new URL(attempt.redirectUri).origin !== request.nextUrl.origin) return finish(request, "failed");
    // Quyền phải về đúng người đã bấm kết nối.
    const user = await getCurrentUser();
    if (!user || user.id !== attempt.userId) return finish(request, "failed");

    const refreshToken = await exchangeGoogleMeetCode(code, attempt);
    if (!refreshToken) return finish(request, "denied");
    await prisma.user.update({ where: { id: user.id }, data: { googleMeetToken: encryptToken(refreshToken) } });
    return finish(request, "connected");
  } catch {
    return finish(request, "failed");
  }
}
