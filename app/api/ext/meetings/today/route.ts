import { verifyExtensionToken } from "@/lib/extensionAuth";
import { handleCorsPreflight, jsonWithCors } from "@/lib/extensionCors";
import { vnDayRange } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/** Lấy danh sách cuộc họp hôm nay của người dùng để chọn thủ công khi không khớp mã phòng */
export async function GET(request: Request) {
  const user = await verifyExtensionToken(request.headers.get("authorization"));
  if (!user) {
    return jsonWithCors({ error: "Token không hợp lệ hoặc đã bị thu hồi." }, { status: 401 }, request);
  }

  const { start, end } = vnDayRange(new Date());

  const meetings = await prisma.meeting.findMany({
    where: {
      status: "SCHEDULED",
      startAt: { gte: start, lte: end },
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

  return jsonWithCors(
    {
      meetings: meetings.map((m) => ({
        id: m.id,
        title: m.title,
        startAt: m.startAt.toISOString(),
        endAt: m.endAt.toISOString(),
        meetCode: m.meetCode,
        meetingUrl: m.meetingUrl,
        isOrganizer: m.organizerId === user.id,
        isRecorder: m.recorderId === user.id || (!m.recorderId && m.organizerId === user.id),
        hasRecap: Boolean(m.recap),
        recapStatus: m.recap?.status ?? null,
      })),
    },
    { status: 200 },
    request
  );
}
