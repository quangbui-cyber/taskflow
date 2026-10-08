import { emailSenderAddress, sendEmail, type EmailResult } from "@/lib/email";
import { buildMeetingIcs } from "@/lib/meetingIcs";
import { formatMeetingWhen } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";

export type MeetingMailKind = "INVITED" | "UPDATED" | "CANCELLED" | "REMOVED";

type Recipient = { name: string; email: string };

const HEADLINES: Record<MeetingMailKind, string> = {
  INVITED: "Bạn được mời tham dự một cuộc họp",
  UPDATED: "Lịch họp đã được cập nhật",
  CANCELLED: "Cuộc họp đã bị huỷ",
  REMOVED: "Bạn không còn trong danh sách tham dự",
};

const SUBJECT_PREFIX: Record<MeetingMailKind, string> = {
  INVITED: "Mời họp",
  UPDATED: "Cập nhật lịch họp",
  CANCELLED: "Huỷ họp",
  REMOVED: "Huỷ lời mời họp",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Địa chỉ gốc của app để dẫn link trong email; trống thì email không kèm link */
function appUrl(): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : "";
}

/**
 * Gửi email lời mời / cập nhật / huỷ họp kèm file .ics.
 * Mặc định gửi cho người tổ chức và mọi người được mời; truyền `recipients`
 * để gửi riêng (ví dụ người vừa bị bỏ khỏi danh sách).
 */
export async function sendMeetingEmail({
  meetingId,
  kind,
  recipients,
}: {
  meetingId: string;
  kind: MeetingMailKind;
  recipients?: Recipient[];
}): Promise<EmailResult> {
  const sender = emailSenderAddress();
  if (!sender) return { ok: false, error: "Chưa cấu hình email." };

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      room: { select: { name: true } },
      organizer: { select: { name: true, email: true, isActive: true } },
      attendees: {
        where: { user: { isActive: true } },
        select: {
          response: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!meeting) return { ok: false, error: "Không tìm thấy cuộc họp." };

  const invited = meeting.attendees.map((attendee) => ({
    ...attendee.user,
    accepted: attendee.response === "ACCEPTED",
  }));
  const everyone = [
    ...(meeting.organizer.isActive
      ? [{ name: meeting.organizer.name, email: meeting.organizer.email, accepted: true }]
      : []),
    ...invited,
  ];
  const to = (recipients ?? everyone).map((person) => person.email);
  if (to.length === 0) return { ok: true };

  const method = kind === "CANCELLED" || kind === "REMOVED" ? "CANCEL" : "REQUEST";
  const when = formatMeetingWhen(meeting.startAt, meeting.endAt);
  const location = meeting.room?.name ?? (meeting.meetingUrl ? "Họp online" : null);
  const link = appUrl() ? `${appUrl()}/meetings?focus=${meeting.id}` : null;

  const details: [string, string][] = [
    ["Thời gian", `${when} (giờ Việt Nam)`],
    ["Phòng họp", meeting.room?.name ?? "Không dùng phòng"],
    ...(meeting.meetingUrl ? ([["Link họp", meeting.meetingUrl]] as [string, string][]) : []),
    ["Người tổ chức", meeting.organizer.name],
    ["Người tham dự", invited.map((person) => person.name).join(", ") || "—"],
  ];

  const text = [
    `${HEADLINES[kind]}: ${meeting.title}`,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    ...(meeting.description ? ["", meeting.description] : []),
    ...(link && method === "REQUEST" ? ["", `Xem và phản hồi trong app: ${link}`] : []),
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#27272a;max-width:560px">
<p style="margin:0 0 4px;color:#71717a">${escapeHtml(HEADLINES[kind])}</p>
<h2 style="margin:0 0 16px;font-size:20px;color:#09090b">${escapeHtml(meeting.title)}</h2>
<table style="border-collapse:collapse">${details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#71717a;vertical-align:top;white-space:nowrap">${escapeHtml(
          label
        )}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`
    )
    .join("")}</table>
${
  meeting.description
    ? `<p style="margin:16px 0 0;white-space:pre-wrap">${escapeHtml(meeting.description)}</p>`
    : ""
}
${
  link && method === "REQUEST"
    ? `<p style="margin:20px 0 0"><a href="${escapeHtml(
        link
      )}" style="display:inline-block;background:#a8d431;color:#18181b;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:7px">Xem và phản hồi trong app</a></p>`
    : ""
}
</div>`;

  // ORGANIZER là hộp thư gửi của app chứ không phải email cá nhân người tổ chức:
  // lời mời có ORGANIZER khác địa chỉ gửi thường bị ứng dụng lịch bỏ qua.
  const calendar = buildMeetingIcs(
    {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      location,
      url: meeting.meetingUrl,
      startAt: meeting.startAt,
      endAt: meeting.endAt,
      sequence: meeting.sequence,
      organizer: { name: `${meeting.organizer.name} (myCreative)`, email: sender },
      attendees: recipients && kind === "REMOVED" ? recipients : everyone,
    },
    method
  );

  return sendEmail({
    to,
    subject: `${SUBJECT_PREFIX[kind]}: ${meeting.title} — ${when}`,
    text,
    html,
    calendar: { method, content: calendar },
  });
}
