import "server-only";

import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const EMAIL_FAILURE_LIMIT = 5;
const IP_FAILURE_LIMIT = 20;

type LoginKeys = {
  email: string;
  ip: string | null;
};

type LimitKey = {
  key: string;
  maxFailures: number;
};

function signingSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Thiếu SESSION_SECRET để bảo vệ rate limit.");
  return secret;
}

function digest(scope: "email" | "ip", value: string) {
  return `${scope}:${createHmac("sha256", signingSecret())
    .update(value)
    .digest("hex")}`;
}

function limitKeys({ email, ip }: LoginKeys): LimitKey[] {
  const keys: LimitKey[] = [
    {
      key: digest("email", email.trim().toLowerCase()),
      maxFailures: EMAIL_FAILURE_LIMIT,
    },
  ];
  if (ip) {
    keys.push({ key: digest("ip", ip), maxFailures: IP_FAILURE_LIMIT });
  }
  return keys;
}

export function loginClientIp(headerList: Headers) {
  const forwarded = headerList.get("x-forwarded-for")?.split(",")[0]?.trim();
  const value = forwarded || headerList.get("x-real-ip")?.trim();
  if (!value || value.length > 128) return null;
  return value;
}

export async function loginRateLimitStatus(keys: LoginKeys) {
  const now = new Date();
  const records = await prisma.loginRateLimit.findMany({
    where: { key: { in: limitKeys(keys).map((item) => item.key) } },
    select: { blockedUntil: true },
  });
  const blockedUntil = records.reduce<Date | null>((latest, record) => {
    if (!record.blockedUntil || record.blockedUntil <= now) return latest;
    return !latest || record.blockedUntil > latest ? record.blockedUntil : latest;
  }, null);

  return blockedUntil
    ? { blocked: true as const, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000)) }
    : { blocked: false as const };
}

export async function recordFailedLogin(keys: LoginKeys) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  const blockedUntil = new Date(now.getTime() + BLOCK_MS);

  await prisma.$transaction(async (tx) => {
    for (const item of limitKeys(keys)) {
      await tx.loginRateLimit.upsert({
        where: { key: item.key },
        update: {},
        create: { key: item.key, failures: 0, windowStartedAt: now },
      });
      await tx.loginRateLimit.updateMany({
        where: { key: item.key, windowStartedAt: { lt: cutoff } },
        data: { failures: 0, windowStartedAt: now, blockedUntil: null },
      });
      const record = await tx.loginRateLimit.update({
        where: { key: item.key },
        data: { failures: { increment: 1 } },
        select: { failures: true },
      });
      if (record.failures >= item.maxFailures) {
        await tx.loginRateLimit.update({
          where: { key: item.key },
          data: { blockedUntil },
        });
      }
    }
  });

  // Dọn các khóa cũ để email/IP rác không làm bảng tăng mãi theo thời gian.
  await prisma.loginRateLimit.deleteMany({
    where: { updatedAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } },
  });
}

export async function clearLoginRateLimit(keys: LoginKeys) {
  await prisma.loginRateLimit.deleteMany({
    where: { key: { in: limitKeys(keys).map((item) => item.key) } },
  });
}
