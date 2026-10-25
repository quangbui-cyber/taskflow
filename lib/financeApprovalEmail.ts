import { formatMargin, formatVndNumber } from "./financeCalc";

// Nội dung email cho luồng duyệt IC (Q17). Thư gửi duyệt là thư gốc; thư duyệt,
// từ chối, rút lại trả lời trong cùng luồng nên dùng chung tiêu đề với "Re:".

export type FinanceEmailKind = "SUBMITTED" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export type FinanceEmailEvent = {
  kind: FinanceEmailKind;
  projectName: string;
  clientName: string | null;
  version: number;
  submitterName: string;
  /** Người duyệt / từ chối / rút lại. */
  actorName: string;
  /** Lời nhắn khi gửi duyệt. */
  message: string | null;
  /** Lý do từ chối. */
  reason: string | null;
  selfApproval: boolean;
  costSubtotal: number;
  /** Chỉ có khi mọi người nhận đều được xem số liệu bán (null = ẩn). */
  sell: { gross: number; profit: number; margin: number | null } | null;
  link: string | null;
};

export function financeEmailSubject(projectName: string, version: number) {
  return `[Duyệt IC] ${projectName} – v${version}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

const HEADLINE: Record<FinanceEmailKind, (event: FinanceEmailEvent) => string> = {
  SUBMITTED: (event) => `${event.submitterName} gửi IC v${event.version} của dự án "${event.projectName}" và cần duyệt.`,
  APPROVED: (event) => `${event.actorName} đã duyệt IC v${event.version} của dự án "${event.projectName}".`,
  REJECTED: (event) => `${event.actorName} đã từ chối IC v${event.version} của dự án "${event.projectName}". IC chuyển về bản nháp để sửa.`,
  WITHDRAWN: (event) => `${event.actorName} đã rút lại IC v${event.version} của dự án "${event.projectName}", chưa cần duyệt nữa.`,
};

const BUTTON: Record<FinanceEmailKind, string> = {
  SUBMITTED: "Mở IC để duyệt",
  APPROVED: "Xem IC",
  REJECTED: "Mở IC để sửa",
  WITHDRAWN: "Xem IC",
};

export function buildFinanceApprovalEmail(event: FinanceEmailEvent) {
  const baseSubject = financeEmailSubject(event.projectName, event.version);
  const subject = event.kind === "SUBMITTED" ? baseSubject : `Re: ${baseSubject}`;

  const rows: [string, string][] = [
    ["Dự án", event.projectName],
    ...(event.clientName ? [["Khách hàng", event.clientName] as [string, string]] : []),
    ["Phiên bản", `IC v${event.version}`],
    ["Người gửi", event.submitterName],
    ["Giá vốn (trước VAT)", `${formatVndNumber(event.costSubtotal)} đ`],
    ...(event.sell
      ? ([
          ["Giá bán (gồm VAT)", `${formatVndNumber(event.sell.gross)} đ`],
          ["Lợi nhuận", `${formatVndNumber(event.sell.profit)} đ`],
          ["Margin", formatMargin(event.sell.margin)],
        ] as [string, string][])
      : []),
  ];
  const notes: string[] = [];
  if (event.kind === "SUBMITTED" && event.message) notes.push(`Lời nhắn: ${event.message}`);
  if (event.kind === "REJECTED" && event.reason) notes.push(`Lý do: ${event.reason}`);
  if (event.kind === "APPROVED" && event.sell) {
    notes.push(`Doanh thu dự án được cập nhật thành ${formatVndNumber(event.sell.gross)} đ (gồm VAT).`);
  }
  if (event.kind === "APPROVED" && event.selfApproval) {
    notes.push("Lưu ý: người duyệt cũng là người gửi IC này.");
  }
  if (!event.sell) {
    notes.push("Giá bán và lợi nhuận không ghi trong email này vì có người nhận không được xem số liệu bán.");
  }

  const headline = HEADLINE[event.kind](event);
  const text = [
    headline,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(notes.length ? ["", ...notes] : []),
    ...(event.link ? ["", `${BUTTON[event.kind]}: ${event.link}`] : []),
    "",
    "Email tự động từ myCreative. Trả lời email này để gửi thư cho người gửi IC.",
  ].join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1d1d1f;max-width:560px">
<p style="margin:0 0 14px;font-size:15px"><b>${escapeHtml(headline)}</b></p>
<table style="border-collapse:collapse;width:100%">${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 10px 6px 0;color:#545963;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(value)}</td></tr>`,
    )
    .join("")}</table>
${notes.map((note) => `<p style="margin:12px 0 0;padding:10px 12px;background:#f5f6f8;border-radius:6px">${escapeHtml(note)}</p>`).join("\n")}
${event.link ? `<p style="margin:20px 0 0"><a href="${escapeHtml(event.link)}" style="display:inline-block;background:#a8d431;color:#182008;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:6px">${escapeHtml(BUTTON[event.kind])}</a></p>` : ""}
<p style="margin:20px 0 0;color:#767b86;font-size:12px">Email tự động từ myCreative. Trả lời email này để gửi thư cho người gửi IC.</p>
</div>`;

  return { subject, text, html };
}
