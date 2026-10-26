"use server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  GoogleMeetApiDisabledError,
  GoogleMeetNotConnectedError,
  createGoogleMeetSpace,
  googleMeetConfigured,
} from "@/lib/googleMeet";

export type GoogleMeetStatus = { configured: boolean; connected: boolean };

export async function getGoogleMeetStatus(): Promise<GoogleMeetStatus> {
  const user = await requireUser();
  if (!googleMeetConfigured()) return { configured: false, connected: false };
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { googleMeetToken: true } });
  return { configured: true, connected: Boolean(row?.googleMeetToken) };
}

export type GoogleMeetLinkResult = { url: string } | { error: string; needsConnect?: boolean };

/** Tạo phòng Google Meet mới bằng tài khoản Google đã kết nối của người đặt lịch. */
export async function createGoogleMeetLink(): Promise<GoogleMeetLinkResult> {
  const user = await requireUser();
  if (!googleMeetConfigured()) return { error: "Chức năng Google chưa được cấu hình." };
  try {
    return { url: await createGoogleMeetSpace(user.id) };
  } catch (err) {
    if (err instanceof GoogleMeetNotConnectedError) {
      return { error: "Cần kết nối tài khoản Google trước khi tạo link Meet.", needsConnect: true };
    }
    if (err instanceof GoogleMeetApiDisabledError) {
      return { error: "Google Meet API chưa được bật cho app. Nhờ quản trị viên xem mục Google Meet trong DEPLOY.md." };
    }
    console.error("createGoogleMeetLink failed", err);
    return { error: "Google chưa tạo được link họp. Thử lại sau ít phút hoặc dán link thủ công." };
  }
}
