"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { parseAvatarDataUrl } from "@/lib/avatarImage";
import { parseBirthdayInput } from "@/lib/birthdays";
import {
  clearLoginRateLimit,
  loginRateLimitStatus,
  recordFailedLogin,
} from "@/lib/loginRateLimit";
import { passwordLengthError } from "@/lib/password";
import { normalizeProfileName } from "@/lib/profile";
import { createSession } from "@/lib/session";
import {
  assertSixDigitSignaturePin,
  deleteOwnSignatureAsset,
  replaceOwnSignatureAsset,
} from "@/lib/workflow/signatureAssets";

export type ProfileState = { error?: string; success?: string };

export async function saveOwnSignature(formData: FormData): Promise<ProfileState> {
  const user = await requireUser();
  try {
    await replaceOwnSignatureAsset(user.id, formData.get("signatureData"));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Ảnh chữ ký không hợp lệ.",
    };
  }
  revalidatePath("/profile");
  return { success: "Đã lưu chữ ký mẫu cá nhân." };
}

export async function deleteOwnSignature(): Promise<ProfileState> {
  const user = await requireUser();
  await deleteOwnSignatureAsset(user.id);
  revalidatePath("/profile");
  return { success: "Đã xóa chữ ký mẫu cá nhân." };
}

export async function updateSignaturePin(formData: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const confirmPin = String(formData.get("confirmPin") ?? "");
  let newPin: string;
  try {
    newPin = assertSixDigitSignaturePin(formData.get("newPin"));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Mã PIN không hợp lệ." };
  }
  if (newPin !== confirmPin) return { error: "Mã PIN xác nhận không khớp." };

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, signaturePinHash: true },
  });
  if (!account) return { error: "Không tìm thấy tài khoản." };
  if (
    account.signaturePinHash &&
    !(await bcrypt.compare(currentPassword, account.passwordHash))
  ) {
    return { error: "Mật khẩu tài khoản hiện tại không đúng." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { signaturePinHash: await bcrypt.hash(newPin, 10) },
  });
  revalidatePath("/profile");
  return {
    success: account.signaturePinHash
      ? "Đã cập nhật mã PIN chữ ký."
      : "Đã thiết lập mã PIN chữ ký.",
  };
}

/** Người dùng tự đổi tên hiển thị và ảnh đại diện của chính mình. */
export async function updateOwnProfile(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const user = await requireUser();
  const name = normalizeProfileName(formData.get("name"));
  if (!name) return { error: "Tên không được để trống." };
  const avatar = parseAvatarDataUrl(String(formData.get("avatarUrl") ?? ""));
  if (avatar.error) return { error: avatar.error };
  const birthdayInput = parseBirthdayInput(
    formData.get("birthdayDay"),
    formData.get("birthdayMonth")
  );
  if ("error" in birthdayInput) return { error: birthdayInput.error };

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { name, avatarUrl: avatar.avatarUrl, birthday: birthdayInput.birthday },
    }),
    // Hồ sơ Account (nếu có) hiển thị cùng tên với người dùng.
    prisma.account.updateMany({ where: { userId: user.id }, data: { name } }),
  ]);

  revalidatePath("/", "layout");
  return { success: "Đã cập nhật thông tin cá nhân." };
}

/** Người dùng tự đổi mật khẩu: phải nhập đúng mật khẩu hiện tại. */
export async function changeOwnPassword(
  _prev: ProfileState,
  formData: FormData
): Promise<ProfileState> {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  // Khoá riêng cho việc đổi mật khẩu: chặn dò mật khẩu hiện tại từ một phiên
  // bị lộ mà không khoá luôn việc đăng nhập bình thường của người dùng.
  const rateLimitKeys = { email: `password-change:${user.email}`, ip: null };
  const rateLimit = await loginRateLimitStatus(rateLimitKeys);
  if (rateLimit.blocked) {
    const minutes = Math.max(1, Math.ceil(rateLimit.retryAfterSeconds / 60));
    return {
      error: `Bạn đã nhập sai mật khẩu hiện tại quá nhiều lần. Vui lòng thử lại sau ${minutes} phút.`,
    };
  }

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (
    !account ||
    !(await bcrypt.compare(currentPassword, account.passwordHash))
  ) {
    await recordFailedLogin(rateLimitKeys);
    return { error: "Mật khẩu hiện tại không đúng." };
  }

  const passwordError = passwordLengthError(newPassword);
  if (passwordError) return { error: passwordError };
  if (newPassword !== confirmPassword) {
    return { error: "Mật khẩu nhập lại không khớp." };
  }
  if (newPassword === currentPassword) {
    return { error: "Mật khẩu mới phải khác mật khẩu hiện tại." };
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      // Đăng xuất mọi thiết bị khác: JWT cũ mang version cũ sẽ bị từ chối.
      sessionVersion: { increment: 1 },
    },
    select: { sessionVersion: true },
  });
  // Giữ thiết bị này đăng nhập bằng phiên mới.
  await createSession(user.id, updated.sessionVersion);
  await clearLoginRateLimit(rateLimitKeys);

  return {
    success: "Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.",
  };
}
