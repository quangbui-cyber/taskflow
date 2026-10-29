import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

const TOKEN_PREFIX = "mcr_";

export function generateRawToken(): string {
  return `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("hex")}`;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

export async function createExtensionToken(input: {
  userId: string;
  label?: string | null;
}) {
  const token = generateRawToken();
  const tokenHash = hashToken(token);
  const label = (input.label ?? "").trim().slice(0, 100) || "Chrome Extension";

  const record = await prisma.extensionToken.create({
    data: {
      userId: input.userId,
      tokenHash,
      label,
    },
    select: {
      id: true,
      label: true,
      createdAt: true,
    },
  });

  return {
    token, // Trả token gốc một lần duy nhất cho extension lưu trữ
    ...record,
  };
}

/** Tách token từ header Authorization ("Bearer mcr_...") hoặc query string */
export function extractBearerToken(headerOrToken: string | null | undefined): string | null {
  if (!headerOrToken) return null;
  const trimmed = headerOrToken.trim();
  if (trimmed.startsWith("Bearer ")) {
    const candidate = trimmed.slice(7).trim();
    return candidate.startsWith(TOKEN_PREFIX) ? candidate : null;
  }
  if (trimmed.startsWith(TOKEN_PREFIX)) {
    return trimmed;
  }
  return null;
}

/**
 * Xác thực token từ extension.
 * Kiểm tra token còn hiệu lực, người dùng còn active, chưa bị xoá/khoá.
 * Tự động cập nhật `lastUsedAt`.
 */
export async function verifyExtensionToken(
  headerOrToken: string | null | undefined
): Promise<User | null> {
  const token = extractBearerToken(headerOrToken);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const record = await prisma.extensionToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record) return null;
  if (record.revokedAt) return null;

  const user = record.user;
  if (!user.isActive || user.deletedAt) return null;

  // Cập nhật lastUsedAt không đồng bộ (fire-and-forget, không đợi)
  void prisma.extensionToken
    .update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => undefined);

  return user;
}

/** Thu hồi token của người dùng */
export async function revokeExtensionToken(tokenId: string, userId: string): Promise<boolean> {
  const updated = await prisma.extensionToken.updateMany({
    where: { id: tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return updated.count > 0;
}

/** Lấy danh sách các extension đã kết nối của người dùng */
export async function listUserExtensionTokens(userId: string) {
  return prisma.extensionToken.findMany({
    where: { userId },
    select: {
      id: true,
      label: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
