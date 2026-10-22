import { emailAppUrl, emailSenderAddress, sendEmail, type EmailResult } from "@/lib/email";
import { recapContentToHtml, recapExportContent } from "@/lib/meetingRecap";
import { recapActionExportSelect, recapActionOrder, toRecapActionExport } from "@/lib/meetingRecapData";
import { formatMeetingWhen } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Gửi biên bản cho người tổ chức và mọi người được mời (trừ người đã từ chối). */
export async function sendMeetingRecapEmail(meetingId: string): Promise<EmailResult> {
  if (!emailSenderAddress()) return { ok: false, error: "Chưa cấu hình email." };

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      room: { select: { name: true } },
      organizer: { select: { name: true, email: true, isActive: true } },
      attendees: {
        where: { user: { isActive: true }, response: { not: "DECLINED" } },
        select: { user: { select: { name: true, email: true } } },
      },
      recap: {
        select: { content: true, actionItems: { select: recapActionExportSelect, orderBy: recapActionOrder } },
      },
    },
  });
  const recap = meeting?.recap;
  if (!meeting || !recap?.content?.trim()) return { ok: false, error: "Chưa có biên bản để gửi." };
  const content = recapExportContent(recap.content, recap.actionItems.map(toRecapActionExport));

  const to = [
    ...new Set(
      [
        ...(meeting.organizer.isActive ? [meeting.organizer.email] : []),
        ...meeting.attendees.map((attendee) => attendee.user.email),
      ].filter(Boolean)
    ),
  ];
  if (to.length === 0) return { ok: true };

  const when = formatMeetingWhen(meeting.startAt, meeting.endAt);
  const baseUrl = emailAppUrl();
  const link = baseUrl ? `${baseUrl}/meetings/${meeting.id}/recap` : null;
  const details: [string, string][] = [
    ["Thời gian", `${when} (giờ Việt Nam)`],
    ["Phòng họp", meeting.room?.name ?? "Không dùng phòng"],
    ["Người tổ chức", meeting.organizer.name],
  ];

  const text = [
    `Biên bản họp: ${meeting.title}`,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    content.replace(/^#{2,3} /gm, ""),
    "",
    "Biên bản do AI viết từ file ghi âm và đã được người tổ chức đọc lại.",
    ...(link ? [`Xem trong app: ${link}`] : []),
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#27272a;max-width:620px">
<p style="margin:0 0 4px;color:#71717a">Biên bản họp</p>
<h2 style="margin:0 0 16px;font-size:20px;color:#09090b">${escapeHtml(meeting.title)}</h2>
<table style="border-collapse:collapse">${details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#71717a;vertical-align:top;white-space:nowrap">${escapeHtml(
          label
        )}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`
    )
    .join("")}</table>
${recapContentToHtml(content)}
<p style="margin:20px 0 0;color:#71717a;font-size:12px">Biên bản do AI viết từ file ghi âm và đã được người tổ chức đọc lại.</p>
${
  link
    ? `<p style="margin:16px 0 0"><a href="${escapeHtml(
        link
      )}" style="display:inline-block;background:#a8d431;color:#18181b;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:7px">Xem biên bản trong app</a></p>`
    : ""
}
</div>`;

  return sendEmail({ to, subject: `Biên bản họp: ${meeting.title} — ${when}`, text, html });
}
