export type IcsPerson = { name: string; email: string };

export type IcsMeeting = {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  startAt: Date;
  endAt: Date;
  sequence: number;
  /** Hộp thư gửi lời mời — phải trùng địa chỉ gửi email thì Gmail/Outlook mới nhận là lời mời hợp lệ */
  organizer: IcsPerson;
  attendees: (IcsPerson & { accepted?: boolean })[];
};

export type IcsMethod = "REQUEST" | "CANCEL";

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Tên trong tham số CN: bỏ các ký tự làm vỡ cú pháp tham số */
function paramValue(value: string): string {
  return `"${value.replace(/["\r\n]/g, " ").trim()}"`;
}

/** RFC 5545: mỗi dòng tối đa 75 octet; dòng nối bắt đầu bằng một dấu cách. Gập theo byte UTF-8 và không cắt giữa ký tự. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
      limit = 74; // dòng nối đã tốn 1 octet cho dấu cách đầu dòng
    }
    current += char;
    currentBytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Tạo nội dung .ics cho lời mời (REQUEST) hoặc thông báo huỷ (CANCEL) */
export function buildMeetingIcs(
  meeting: IcsMeeting,
  method: IcsMethod,
  now = new Date()
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//myCreative//Lich hop//VI",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:meeting-${meeting.id}@mycreative`,
    `SEQUENCE:${meeting.sequence}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(meeting.startAt)}`,
    `DTEND:${icsDate(meeting.endAt)}`,
    `SUMMARY:${escapeText(meeting.title)}`,
  ];

  if (meeting.description) {
    lines.push(`DESCRIPTION:${escapeText(meeting.description)}`);
  }
  if (meeting.location) lines.push(`LOCATION:${escapeText(meeting.location)}`);
  if (meeting.url) lines.push(`URL:${meeting.url.replace(/[\r\n]/g, "")}`);

  lines.push(
    `ORGANIZER;CN=${paramValue(meeting.organizer.name)}:mailto:${meeting.organizer.email}`
  );
  for (const attendee of meeting.attendees) {
    const partstat = attendee.accepted ? "ACCEPTED" : "NEEDS-ACTION";
    lines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=${partstat};CN=${paramValue(
        attendee.name
      )}:mailto:${attendee.email}`
    );
  }

  lines.push(`STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`);
  if (method === "REQUEST") {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Nhắc lịch họp",
      "TRIGGER:-PT15M",
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
