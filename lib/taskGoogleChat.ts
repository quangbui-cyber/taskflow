import type { GoogleChatMessage, GoogleChatWidget } from "./googleChat";

export type TaskChatInput = {
  event: "created" | "status_changed" | "assignee_changed";
  taskId: string;
  projectName: string;
  title: string;
  status: string;
  previousStatus?: string;
  assigneeName: string | null;
  actorName: string;
  dueDate: Date | null;
  url: string | null;
  meetingTitle?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

const STATUS_STYLE: Record<string, { label: string; color: string; symbol: string }> = {
  TODO: { label: "Cần làm", color: "#b06000", symbol: "●" },
  IN_PROGRESS: { label: "Đang làm", color: "#1a73e8", symbol: "●" },
  DONE: { label: "Hoàn thành", color: "#188038", symbol: "✓" },
};

function statusText(value: string, html: boolean) {
  const style = STATUS_STYLE[value];
  if (!style) return html ? escapeHtml(value) : value;
  const text = `${style.symbol} ${style.label}`;
  return html ? `<b><font color="${style.color}">${text}</font></b>` : text;
}

/** One card layout for task creation, assignment and status changes. */
export function taskGoogleChatMessage(input: TaskChatInput): GoogleChatMessage {
  const subtitle = {
    created: "Công việc mới",
    status_changed: "Cập nhật trạng thái",
    assignee_changed: "Cập nhật người phụ trách",
  }[input.event];
  const assignee = input.assigneeName ?? "Chưa giao";
  const actorLabel = input.event === "created" ? "Người tạo" : "Cập nhật bởi";
  const deadline = input.dueDate
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(input.dueDate)
    : null;
  const status = (html: boolean) => [
    ...(input.event === "status_changed" && input.previousStatus
      ? [statusText(input.previousStatus, html)] : []),
    statusText(input.status, html),
  ].join(" → ");
  const field = (topLabel: string, text: string): GoogleChatWidget => ({
    decoratedText: { topLabel, text, wrapText: true },
  });
  const widgets: GoogleChatWidget[] = [
    { textParagraph: { text: `<b>${escapeHtml(input.title)}</b>` } },
    field("Trạng thái", status(true)),
    field("Người phụ trách", escapeHtml(assignee)),
    field(actorLabel, escapeHtml(input.actorName)),
    ...(deadline ? [field("Hạn chót (giờ Việt Nam)", deadline)] : []),
    ...(input.meetingTitle ? [field("Từ biên bản họp", escapeHtml(input.meetingTitle))] : []),
  ];

  return {
    fallbackText: [
      input.projectName, `${subtitle}: ${input.title}`,
      `Trạng thái: ${status(false)}`, `Người phụ trách: ${assignee}`,
      `${actorLabel}: ${input.actorName}`,
      ...(deadline ? [`Hạn chót (giờ Việt Nam): ${deadline}`] : []),
      ...(input.meetingTitle ? [`Từ biên bản họp: ${input.meetingTitle}`] : []),
      ...(input.url ? [input.url] : []),
    ].join("\n"),
    cardsV2: [{
      cardId: `task-${input.event}-${input.taskId}`,
      card: {
        header: { title: input.projectName, subtitle },
        sections: [
          { widgets },
          ...(input.url ? [{ widgets: [{ buttonList: { buttons: [{
            text: "Mở job ↗", onClick: { openLink: { url: input.url } },
          }] } }] }] : []),
        ],
      },
    }],
  };
}
