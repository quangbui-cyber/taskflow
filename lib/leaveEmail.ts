import type { EmailMessage } from "@/lib/email";
import {
  HALF_DAY_OPTIONS,
  formatLeaveDate,
  formatLeaveDays,
  leaveTypeInfo,
} from "@/lib/leave";

export type LeaveEmailEvent = {
  kind: "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED";
  requesterName: string;
  actorName?: string;
  decisionNote?: string | null;
  request: {
    type: string;
    startDate: Date;
    endDate: Date;
    halfDay: string | null;
    days: number;
    reason: string | null;
  };
};

const HEADLINES: Record<LeaveEmailEvent["kind"], string> = {
  REQUESTED: "Đơn xin nghỉ mới",
  APPROVED: "Đơn nghỉ đã được duyệt",
  REJECTED: "Đơn nghỉ bị từ chối",
  CANCELLED: "Đơn nghỉ đã được hủy",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildLeaveEmail(
  event: LeaveEmailEvent,
  recipient: string,
  baseUrl: string
): EmailMessage {
  const { request, kind } = event;
  const range = request.startDate.getTime() === request.endDate.getTime()
    ? formatLeaveDate(request.startDate)
    : `${formatLeaveDate(request.startDate)} - ${formatLeaveDate(request.endDate)}`;
  const halfDay = HALF_DAY_OPTIONS.find((option) => option.key === request.halfDay);
  const isDecision = kind === "APPROVED" || kind === "REJECTED";
  const details: [string, string][] = [
    ["Người xin nghỉ", event.requesterName],
    ["Loại nghỉ", leaveTypeInfo(request.type).label],
    ["Thời gian", `${range}${halfDay ? ` (${halfDay.label.toLowerCase()})` : ""}`],
    ["Số ngày", `${formatLeaveDays(request.days)} ngày`],
    ...(request.reason ? [["Lý do", request.reason] as [string, string]] : []),
    ...(isDecision && event.actorName
      ? [["Người xử lý", event.actorName] as [string, string]] : []),
    ...(isDecision && event.decisionNote
      ? [["Ghi chú", event.decisionNote] as [string, string]] : []),
  ];
  const headline = HEADLINES[kind];
  const link = baseUrl ? `${baseUrl}/leave` : "";
  const text = [
    headline,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    ...(kind === "REQUESTED" ? ["", "Trạng thái: Chờ duyệt."] : []),
    ...(link ? ["", `Xem đơn trong ứng dụng: ${link}`] : []),
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#27272a;max-width:560px">
<p style="margin:0 0 4px;color:#71717a">Nghỉ phép</p>
<h2 style="margin:0 0 16px;font-size:20px;color:#09090b">${escapeHtml(headline)}</h2>
<table style="border-collapse:collapse">${details.map(([label, value]) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#71717a;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`
  ).join("")}</table>
${kind === "REQUESTED" ? "<p>Trạng thái: Chờ duyệt.</p>" : ""}
${link ? `<p style="margin:20px 0 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:6px">Xem đơn nghỉ</a></p>` : ""}
</div>`;
  return {
    to: [recipient],
    subject: `${headline}: ${event.requesterName} (${range})`,
    text,
    html,
  };
}
