"use server";

import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  clearLoginRateLimit,
  loginClientIp,
  loginRateLimitStatus,
  recordFailedLogin,
} from "@/lib/loginRateLimit";
import { createSession, destroySession, getSession } from "@/lib/session";
import { googleLinkCookieName, verifyGoogleLink } from "@/lib/googleAuth";

export type AuthState = { error?: string };

// Giữ thời gian bcrypt gần như nhau dù email có tồn tại hay không, hạn chế dò
// danh sách tài khoản qua chênh lệch thời gian phản hồi.
const DUMMY_PASSWORD_HASH =
  "$2b$10$7EqJtq98hPqEX7fNZaFWoO5nZQH6sKpWRbY8oBRlzP3V1Qh7xwY2K";

export async function login(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const clientIp = loginClientIp(await headers());
  const rateLimitKeys = { email, ip: clientIp };
  const rateLimit = await loginRateLimitStatus(rateLimitKeys);
  if (rateLimit.blocked) {
    const minutes = Math.max(1, Math.ceil(rateLimit.retryAfterSeconds / 60));
    return {
      error: `Đã có quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ${minutes} phút.`,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await bcrypt.compare(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH
  );
  if (!user || !passwordMatches) {
    await recordFailedLogin(rateLimitKeys);
    return { error: "Email hoặc mật khẩu không đúng." };
  }
  if (!user.isActive) {
    return { error: "Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ Admin." };
  }

  await clearLoginRateLimit(rateLimitKeys);
  const cookieStore = await cookies();
  const pendingLink = cookieStore.get(googleLinkCookieName())?.value;
  if (pendingLink) {
    cookieStore.delete(googleLinkCookieName());
    try {
      const link = await verifyGoogleLink(pendingLink);
      if (link.email === email) {
        await prisma.user.updateMany({
          where: { id: user.id, googleSub: null, isActive: true },
          data: { googleSub: link.sub },
        });
      }
    } catch {
      // A stale or invalid link never prevents normal password sign-in.
    }
  }
  await createSession(user.id, user.sessionVersion);
  redirect("/");
}

export async function logout(formData?: FormData) {
  const endpoint = formData?.get("pushEndpoint");
  const session = await getSession();
  if (session && typeof endpoint === "string" && endpoint.length <= 4096) {
    try {
      await prisma.pushSubscription.deleteMany({ where: { userId: session.userId, endpoint } });
    } catch {
      console.warn("Could not remove the device registration during logout.");
    }
  }
  await destroySession();
  redirect("/login");
}
