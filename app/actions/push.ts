"use server";

import { getCurrentUser, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePushRegistration } from "@/lib/pushPolicy";
import { deliverPush, pushConfiguration } from "@/lib/webPush";

export async function subscribePush(value: unknown) {
  const user = await requireUser();
  if (!pushConfiguration()) return { error: "Thông báo đẩy chưa được cấu hình. Vui lòng liên hệ Admin." };
  const sub = parsePushRegistration(value);
  if (!sub) return { error: "Đăng ký thiết bị không hợp lệ. Hãy thử bật lại thông báo." };
  const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { sessionVersion: true } });
  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: sub.endpoint }, select: { userId: true } });
  if (existing?.userId !== user.id && await prisma.pushSubscription.count({ where: { userId: user.id } }) >= 20) {
    return { error: "Bạn đã đăng ký quá nhiều thiết bị. Hãy tắt thông báo trên thiết bị không còn dùng." };
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, ...sub.keys, userId: user.id, sessionVersion: current.sessionVersion },
    update: { ...sub.keys, userId: user.id, sessionVersion: current.sessionVersion },
  });
  return { success: "Đã bật thông báo trên thiết bị này." };
}

export async function unsubscribePush(endpoint: string) {
  const user = await getCurrentUser();
  if (user && typeof endpoint === "string") {
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  }
  return { success: "Đã tắt thông báo trên thiết bị này." };
}

export async function sendTestPush(endpoint: string) {
  const user = await requireUser();
  if (!pushConfiguration()) return { error: "Thông báo đẩy chưa được cấu hình." };
  if (typeof endpoint !== "string" || endpoint.length > 4096) return { error: "Thiết bị không hợp lệ." };
  const reserved = await prisma.pushSubscription.updateMany({
    where: { endpoint, userId: user.id, OR: [{ lastTestAt: null }, { lastTestAt: { lt: new Date(Date.now() - 60_000) } }] },
    data: { lastTestAt: new Date() },
  });
  if (reserved.count === 0) return { error: "Hãy bật thông báo trước hoặc đợi 1 phút rồi gửi thử lại." };
  const result = await deliverPush([user.id], { type: "TEST", message: `Xin chào ${user.name}! Thiết bị của bạn đã nhận được thông báo thử từ myCreative.` }, endpoint);
  return result.sent > 0
    ? { success: "Đã gửi thông báo thử. Nếu chưa thấy, hãy kiểm tra quyền thông báo và chế độ Không làm phiền." }
    : { error: "Không gửi được thông báo. Hãy tắt rồi bật lại thông báo trên thiết bị này." };
}
