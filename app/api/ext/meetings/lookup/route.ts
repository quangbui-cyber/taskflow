import { parseMeetingLink } from "@/extension/meeting-link.js";
import { verifyExtensionToken } from "@/lib/extensionAuth";
import { handleCorsPreflight, jsonWithCors } from "@/lib/extensionCors";
import { parseMeetCode } from "@/lib/meetLink";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/** Match supported meeting rooms within ±3 hours, limited to this user’s meetings. */
export async function GET(request: Request) {
  const user = await verifyExtensionToken(request.headers.get("authorization"));
  if (!user) {
    return jsonWithCors({ error: "Token không hợp lệ hoặc đã bị thu hồi." }, { status: 401 }, request);
  }

  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");
  const meetCode = rawUrl ? null : parseMeetCode(searchParams.get("code"));
  const link = parseMeetingLink(rawUrl || (meetCode ? `https://meet.google.com/${meetCode}` : ""));

  if (!link) {
    return jsonWithCors({ meeting: null, reason: "Link hoặc mã phòng không hợp lệ." }, { status: 200 }, request);
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  const candidates = await prisma.meeting.findMany({
    where: {
      ...(link.provider === "google" ? { meetCode: link.id } : { meetingUrl: { not: null } }),
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

  const meeting = candidates.find((candidate) => link.provider === "google"
    ? candidate.meetCode === link.id
    : parseMeetingLink(candidate.meetingUrl)?.key === link.key);

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
