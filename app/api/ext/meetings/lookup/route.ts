import { verifyExtensionToken } from "@/lib/extensionAuth";
import { handleCorsPreflight, jsonWithCors } from "@/lib/extensionCors";
import { parseMeetCode } from "@/lib/meetLink";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/** Tìm cuộc họp khớp mã phòng Google Meet trong khung giờ ±3 tiếng */
export async function GET(request: Request) {
  const user = await verifyExtensionToken(request.headers.get("authorization"));
  if (!user) {
    return jsonWithCors({ error: "Token không hợp lệ hoặc đã bị thu hồi." }, { status: 401 }, request);
  }

  const { searchParams } = new URL(request.url);
  const rawCode = searchParams.get("code") ?? searchParams.get("url") ?? "";
  const meetCode = parseMeetCode(rawCode);

  if (!meetCode) {
    return jsonWithCors({ meeting: null, reason: "Mã phòng không hợp lệ." }, { status: 200 }, request);
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  const meeting = await prisma.meeting.findFirst({
    where: {
      meetCode,
      status: "SCHEDULED",
      startAt: { lte: windowEnd },
      endAt: { gte: windowStart },
      OR: [
        { organizerId: user.id },
        { recorderId: user.id },
        { attendees: { some: { userId: user.id } } },
      ],
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      meetCode: true,
      meetingUrl: true,
      organizerId: true,
      recorderId: true,
      recap: { select: { id: true, status: true } },
    },
    orderBy: { startAt: "asc" },
  });

  if (!meeting) {
    return jsonWithCors({ meeting: null }, { status: 200 }, request);
  }

  return jsonWithCors(
    {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        startAt: meeting.startAt.toISOString(),
        endAt: meeting.endAt.toISOString(),
        meetCode: meeting.meetCode,
        meetingUrl: meeting.meetingUrl,
        isOrganizer: meeting.organizerId === user.id,
        isRecorder: meeting.recorderId === user.id || (!meeting.recorderId && meeting.organizerId === user.id),
        hasRecap: Boolean(meeting.recap),
        recapStatus: meeting.recap?.status ?? null,
      },
    },
    { status: 200 },
    request
  );
}
