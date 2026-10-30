import { verifyExtensionToken } from "@/lib/extensionAuth";
import { handleCorsPreflight, jsonWithCors } from "@/lib/extensionCors";
import { parseMeetCode } from "@/lib/meetLink";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/** Tạo nhanh một cuộc họp khi người dùng đang họp mà chưa có lịch trong app */
export async function POST(request: Request) {
  const user = await verifyExtensionToken(request.headers.get("authorization"));
  if (!user) {
    return jsonWithCors({ error: "Token không hợp lệ hoặc đã bị thu hồi." }, { status: 401 }, request);
  }

  let title = "";
  let meetingUrl: string | null = null;
  try {
    const body = (await request.json()) as { title?: unknown; meetingUrl?: unknown };
    title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
    meetingUrl = typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : null;
  } catch {
    // Body rỗng được chấp nhận
  }

  const now = new Date();
  const startAt = new Date(Math.floor(now.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000));
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  const meetCode = parseMeetCode(meetingUrl);

  const fallbackTitle = meetCode
    ? `Họp Google Meet (${meetCode})`
    : `Cuộc họp nhanh ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(now)}`;

  const meeting = await prisma.meeting.create({
    data: {
      title: title || fallbackTitle,
      startAt,
      endAt,
      meetingUrl,
      meetCode,
      organizerId: user.id,
      recorderId: user.id,
      status: "SCHEDULED",
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      meetCode: true,
      meetingUrl: true,
    },
  });

  return jsonWithCors(
    {
      meeting: {
        ...meeting,
        startAt: meeting.startAt.toISOString(),
        endAt: meeting.endAt.toISOString(),
        isOrganizer: true,
        isRecorder: true,
      },
    },
    { status: 201 },
    request
  );
}
