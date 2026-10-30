import type { GoogleChatMessage } from "./googleChat";

export type TaskChatNotification = {
  event: "created" | "status" | "assignee" | "comment";
  title: string;
  status: string;
  previousStatus?: string;
  assignee: string;
  actor: string;
  comment?: string;
};

const STATUS_STYLE: Record<string, { label: string; color: string; symbol: string }> = {
  TODO: { label: "Cần làm", color: "#a45b00", symbol: "●" },
  IN_PROGRESS: { label: "Đang làm", color: "#1967d2", symbol: "●" },
  DONE: { label: "Hoàn thành", color: "#188038", symbol: "✓" },
};

const EVENT_LABEL = {
  created: "Công việc mới",
  status: "Cập nhật trạng thái",
  assignee: "Cập nhật người phụ trách",
  comment: "Bình luận mới",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!).replace(/\r?\n/g, "<br>");
}

function statusText(status: string) {
  const style = STATUS_STYLE[status];
  if (!style) return escapeHtml(status);
  return `<font color="${style.color}"><b>${style.symbol} ${style.label}</b></font>`;
}

export function buildTaskChatMessage(
  projectName: string,
  taskId: string,
  url: string,
  input: TaskChatNotification
): GoogleChatMessage {
  const label = EVENT_LABEL[input.event];
  const previous = input.previousStatus;
  const status = previous
    ? `${statusText(previous)} → ${statusText(input.status)}`
    : statusText(input.status);
  const statusSummary = [previous, input.status]
    .filter((value): value is string => Boolean(value))
    .map((value) => STATUS_STYLE[value]?.label ?? value)
    .join(" → ");
  const actorLabel = input.event === "created" ? "Tạo bởi"
    : input.event === "comment" ? "Bình luận bởi" : "Cập nhật bởi";

  return {
    fallbackText: `${projectName} · ${label}: ${input.title} · ${statusSummary} · Phụ trách: ${input.assignee}`,
    cardsV2: [{
      cardId: `task-${taskId}`,
      card: {
        header: { title: escapeHtml(projectName), subtitle: label },
        sections: [{
          widgets: [
            { textParagraph: { text: `<b>${escapeHtml(input.title)}</b>` } },
            { decoratedText: { topLabel: "Trạng thái", text: status, wrapText: true } },
            ...(input.comment ? [{ textParagraph: { text: escapeHtml(input.comment) } }] : []),
            { decoratedText: { topLabel: "Người phụ trách", text: escapeHtml(input.assignee), wrapText: true } },
            { decoratedText: { topLabel: actorLabel, text: escapeHtml(input.actor), wrapText: true } },
          ],
        }, {
          widgets: [{ buttonList: { buttons: [{ text: "Mở job ↗", onClick: { openLink: { url } } }] } }],
        }],
      },
    }],
  };
}

export function buildDailyReminderChatMessage(
  projectName: string,
  task: { id: string; title: string; assignee: string; due: string; overdue: boolean },
  url: string
): GoogleChatMessage {
  const deadlineStatus = task.overdue ? "🔴 Quá hạn" : "🟡 Đến hạn hôm nay";

  return {
    fallbackText: `${projectName} · ${deadlineStatus}: ${task.title} · ${task.due} · Phụ trách: ${task.assignee} · ${url}`,
    cardsV2: [{
      cardId: `daily-reminder-${task.id}`,
      card: {
        header: { title: escapeHtml(projectName), subtitle: "Nhắc việc hằng ngày" },
        sections: [{
          widgets: [
            { textParagraph: { text: `<b>${escapeHtml(task.title)}</b>` } },
            { decoratedText: { topLabel: "Tình trạng", text: deadlineStatus, wrapText: true } },
            { decoratedText: { topLabel: "Hạn chót", text: escapeHtml(task.due), wrapText: true } },
            { decoratedText: { topLabel: "Người phụ trách", text: escapeHtml(task.assignee), wrapText: true } },
          ],
        }, {
          widgets: [{ buttonList: { buttons: [{ text: "Mở job ↗", onClick: { openLink: { url } } }] } }],
        }],
      },
    }],
  };
}
