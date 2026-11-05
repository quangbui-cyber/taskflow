import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { daysSinceBirthday, vietnamToday } from "@/lib/birthdays";
import { buildBirthdayEmail } from "@/lib/birthdayEmail";
import { isEmailConfigured, sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Chạy 09:00 giờ Việt Nam mỗi ngày: gửi thư chúc mừng cho người có sinh nhật hôm nay.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ ok: false, message: "Chưa cấu hình SMTP." });
  }

  const now = new Date();
  const dateKey = new Date(vietnamToday(now)).toISOString().slice(0, 10);
  const people = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, birthday: { not: null } },
    select: { id: true, name: true, email: true, birthday: true },
  });
  const today = people.filter(
    (person) => person.birthday && daysSinceBirthday(person.birthday, now) === 0
  );
  if (today.length === 0) return NextResponse.json({ ok: true, sent: 0, date: dateKey });

  // Dòng thông báo trong app cũng là khoá chống gửi trùng: chạy lại cron không gửi lần hai.
  const created = await prisma.notification.createManyAndReturn({
    data: today.map((person) => ({
      dedupeKey: `birthday-email:${dateKey.slice(0, 4)}:${person.id}`,
      userId: person.id,
      type: "BIRTHDAY_GREETING",
      message: "Cả nhà Ga chúc mừng sinh nhật bạn.",
    })),
    skipDuplicates: true,
  });
  const fresh = new Set(created.map((row) => row.userId));

  let sent = 0;
  for (const person of today.filter((item) => fresh.has(item.id))) {
    const result = await sendEmail(buildBirthdayEmail(person.name, person.email));
    if (result.ok) sent += 1;
    else console.warn("Birthday email delivery could not be completed.");
  }
  return NextResponse.json({ ok: true, sent, date: dateKey });
}
