import type { GoogleChatIcon, GoogleChatMessage, GoogleChatSection, GoogleChatWidget } from "./googleChat";
import { daysUntil, hasTime } from "./dates";

/**
 * Thẻ Google Chat gửi vào nhóm của dự án. Bố cục chung:
 *   dòng đầu = chuyện gì vừa xảy ra, dòng phụ = tên dự án;
 *   tên task in đậm, to nhất; mỗi thông tin một dòng có biểu tượng; một nút bấm nền xanh.
 * Google Chat tự chọn font (Google Sans / Roboto), thẻ chỉ chỉnh được đậm nhạt, màu, biểu tượng.
 */

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

export function escapeHtml(value: string) {
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

const TIME = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
const WEEKDAY = new Intl.DateTimeFormat("vi-VN", { weekday: "long", timeZone: "Asia/Ho_Chi_Minh" });
const DAY = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" });
/** "28/10" (ngày/tháng, giờ Việt Nam). */
const SHORT_DAY = { format: (date: Date) => DAY.format(date).slice(0, 5) };

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Chọn một câu theo hạt giống để cùng một việc luôn ra cùng câu, còn các việc khác nhau thì đổi câu. */
function pickLine(lines: string[], seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return lines[hash % lines.length];
}

/** Dòng tin vui hiện phía trên thẻ; thẻ bên dưới vẫn giữ nguyên, nghiêm chỉnh. */
export function taskChatGreeting(input: Pick<TaskChatInput, "event" | "status" | "taskId" | "assigneeName">) {
  const seed = `${input.taskId}-${input.event}-${input.status}`;
  const name = input.assigneeName;
  if (input.event === "created") {
    return pickLine(
      [
        "Có việc nước sôi tới rồi nè 🔥",
        "Ting ting! Việc mới nóng hổi vừa ra lò 🥐",
        ...(name ? [`${name} ơi, có việc mới đáp xuống bàn bạn nè 🛬`] : ["Có việc mới đáp xuống bàn rồi, ai nhận nào? 🛬"]),
      ],
      seed
    );
  }
  if (input.event === "assignee_changed") {
    return name
      ? pickLine([`${name} ơi, việc này giao cho bạn nha 🎯`, `Có bạn ${name} nhận việc rồi nè 🙌`], seed)
      : "Việc này đang chờ người nhận nè 👀";
  }
  if (input.status === "DONE") return pickLine(["Xong một việc rồi, vỗ tay nào 👏", "Tuyệt vời, thêm một việc về đích 🏁"], seed);
  if (input.status === "IN_PROGRESS") return pickLine(["Có người xắn tay áo làm rồi nè 💪", "Bắt tay vào việc thôi nào 🚀"], seed);
  return pickLine(["Việc vừa nhích thêm một bước nè ✨", "Có chút cập nhật mới cho mình nè 🔔"], seed);
}

/** "17:00 · Thứ Năm 30/10/2026" (giờ Việt Nam). */
export function chatDeadline(date: Date) {
  return `${TIME.format(date)} · ${capitalize(WEEKDAY.format(date))} ${DAY.format(date)}`;
}

function field(icon: GoogleChatIcon, topLabel: string, text: string): GoogleChatWidget {
  return { decoratedText: { startIcon: { knownIcon: icon }, topLabel, text, wrapText: true } };
}

function titleWidget(title: string): GoogleChatWidget {
  return { textParagraph: { text: `<b>${escapeHtml(title)}</b>` } };
}

function buttonSection(text: string, url: string | null): GoogleChatSection[] {
  return url ? [{ widgets: [{ buttonList: { buttons: [{ text, type: "FILLED", onClick: { openLink: { url } } }] } }] }] : [];
}

function card(id: string, title: string, subtitle: string, sections: GoogleChatSection[], fallback: string[], text?: string): GoogleChatMessage {
  return {
    ...(text ? { text } : {}),
    fallbackText: fallback.join("\n"),
    cardsV2: [{ cardId: id, card: { header: { title, subtitle }, sections } }],
  };
}

function taskHeadline(input: TaskChatInput) {
  if (input.event === "created") return "🆕 Công việc mới";
  if (input.event === "assignee_changed") return "👤 Đổi người phụ trách";
  if (input.status === "DONE") return "✅ Đã hoàn thành";
  if (input.status === "IN_PROGRESS") return "▶️ Bắt đầu làm";
  return "🔄 Cập nhật trạng thái";
}

/** Thẻ khi tạo task, đổi trạng thái hoặc đổi người phụ trách. */
export function taskGoogleChatMessage(input: TaskChatInput): GoogleChatMessage {
  const headline = taskHeadline(input);
  const assignee = input.assigneeName ?? "Chưa giao";
  const actorLabel = input.event === "created" ? "Người tạo" : "Cập nhật bởi";
  const deadline = input.dueDate ? chatDeadline(input.dueDate) : null;
  const status = (html: boolean) => [
    ...(input.event === "status_changed" && input.previousStatus ? [statusText(input.previousStatus, html)] : []),
    statusText(input.status, html),
  ].join(" → ");

  const assigneeField =
    input.event === "assignee_changed"
      ? field("PERSON", "Người phụ trách mới", `<b>${escapeHtml(assignee)}</b>`)
      : field("PERSON", "Người phụ trách", escapeHtml(assignee));
  const statusField = field("BOOKMARK", "Trạng thái", status(true));
  const widgets: GoogleChatWidget[] = [
    titleWidget(input.title),
    ...(input.event === "assignee_changed" ? [assigneeField, statusField] : [statusField, assigneeField]),
    ...(deadline ? [field("CLOCK", "Hạn chót", deadline)] : []),
    // Đổi người phụ trách: người làm thao tác không quan trọng bằng người mới nhận việc.
    ...(input.event === "assignee_changed" ? [] : [field("MEMBERSHIP", actorLabel, escapeHtml(input.actorName))]),
    ...(input.meetingTitle ? [field("DESCRIPTION", "Từ biên bản họp", escapeHtml(input.meetingTitle))] : []),
  ];

  return card(
    `task-${input.event}-${input.taskId}`,
    headline,
    input.projectName,
    [{ widgets }, ...buttonSection("Mở job", input.url)],
    [
      `${headline} · ${input.projectName}`,
      input.title,
      `Trạng thái: ${status(false)}`,
      `Người phụ trách: ${assignee}`,
      ...(deadline ? [`Hạn chót: ${deadline}`] : []),
      `${actorLabel}: ${input.actorName}`,
      ...(input.meetingTitle ? [`Từ biên bản họp: ${input.meetingTitle}`] : []),
      ...(input.url ? [input.url] : []),
    ],
    taskChatGreeting(input)
  );
}

/** Thẻ khi có bình luận mới trên task. */
export function taskCommentChatMessage(input: {
  taskId: string;
  projectName: string;
  title: string;
  authorName: string;
  comment: string;
  assigneeName: string | null;
  url: string | null;
}): GoogleChatMessage {
  const headline = `💬 ${input.authorName} bình luận`;
  const comment = input.comment.length > 500 ? `${input.comment.slice(0, 500).trimEnd()}…` : input.comment;
  const assignee = input.assigneeName ?? "Chưa giao";
  return card(
    `comment-${input.taskId}-${Date.now()}`,
    headline,
    input.projectName,
    [
      {
        widgets: [
          titleWidget(input.title),
          { textParagraph: { text: `<i>“${escapeHtml(comment).replace(/\n/g, "<br>")}”</i>` } },
          field("PERSON", "Người phụ trách", escapeHtml(assignee)),
        ],
      },
      ...buttonSection("Trả lời trong app", input.url),
    ],
    [`${headline} · ${input.projectName}`, input.title, `“${comment}”`, `Người phụ trách: ${assignee}`, ...(input.url ? [input.url] : [])],
    pickLine(
      [`${input.authorName} vừa để lại một lời nhắn nè 💌`, `Có tin nhắn mới trong việc này nè 💬`, `${input.authorName} có điều muốn nói nè 👂`],
      `${input.taskId}-${Date.now()}`
    )
  );
}

export type DigestChatTask = { id: string; title: string; assigneeName: string | null; dueDate: Date };

const DIGEST_SECTION_LIMIT = 15;

function overdueLabel(dueDate: Date) {
  const day = SHORT_DAY.format(dueDate);
  const days = -daysUntil(dueDate);
  return days > 0 ? `hạn ${day}, quá ${days} ngày` : `hạn ${hasTime(dueDate) ? TIME.format(dueDate) : day}, đã quá giờ`;
}

/** Thẻ nhắc việc 9h sáng: việc quá hạn và việc đến hạn hôm nay của một dự án. */
export function deadlineDigestChatMessage(input: {
  projectId: string;
  projectName: string;
  overdue: DigestChatTask[];
  dueToday: DigestChatTask[];
  baseUrl: string;
  now?: Date;
}): GoogleChatMessage | null {
  if (input.overdue.length === 0 && input.dueToday.length === 0) return null;
  const now = input.now ?? new Date();
  const taskUrl = (id: string) => (input.baseUrl ? `${input.baseUrl}/projects/${input.projectId}?task=${id}` : null);

  const section = (header: string, tasks: DigestChatTask[], detail: (task: DigestChatTask) => string): GoogleChatSection => {
    const shown = tasks.slice(0, DIGEST_SECTION_LIMIT);
    const widgets: GoogleChatWidget[] = shown.map((task) => {
      const url = taskUrl(task.id);
      return {
        decoratedText: {
          // Bấm cả dòng để mở đúng task; tên task màu xanh cho biết bấm được.
          text: url ? `<font color="#1a73e8"><b>${escapeHtml(task.title)}</b></font>` : `<b>${escapeHtml(task.title)}</b>`,
          bottomLabel: `${task.assigneeName ?? "Chưa giao"} · ${detail(task)}`,
          wrapText: true,
          ...(url ? { onClick: { openLink: { url } } } : {}),
        },
      };
    });
    if (tasks.length > shown.length) {
      widgets.push({ textParagraph: { text: `<font color="#5f6368">và ${tasks.length - shown.length} việc khác</font>` } });
    }
    return { header, widgets };
  };

  const sections: GoogleChatSection[] = [
    ...(input.overdue.length > 0
      ? [section(`🔴 Quá hạn · ${input.overdue.length} việc`, input.overdue, (task) => overdueLabel(task.dueDate))]
      : []),
    ...(input.dueToday.length > 0
      ? [section(`🟡 Đến hạn hôm nay · ${input.dueToday.length} việc`, input.dueToday, (task) => TIME.format(task.dueDate))]
      : []),
    ...buttonSection("Mở dự án", input.baseUrl ? `${input.baseUrl}/projects/${input.projectId}` : null),
  ];
  const today = `${capitalize(WEEKDAY.format(now))} ${SHORT_DAY.format(now)}`;
  const line = (task: DigestChatTask, detail: string) => `• ${task.title} — ${task.assigneeName ?? "Chưa giao"} (${detail})`;

  return card(
    `digest-${input.projectId}-${SHORT_DAY.format(now)}`,
    "⏰ Nhắc việc hôm nay",
    `${input.projectName} · ${today}`,
    sections,
    [
      `⏰ Nhắc việc hôm nay · ${input.projectName}`,
      ...(input.overdue.length > 0 ? [`Quá hạn (${input.overdue.length})`, ...input.overdue.map((task) => line(task, overdueLabel(task.dueDate)))] : []),
      ...(input.dueToday.length > 0 ? [`Đến hạn hôm nay (${input.dueToday.length})`, ...input.dueToday.map((task) => line(task, TIME.format(task.dueDate)))] : []),
    ],
    pickLine(
      input.overdue.length > 0
        ? ["Chào buổi sáng! Có vài việc đang chờ mình ghé thăm nè 🐢", "Sáng rồi, mình cùng dọn vài việc còn đang chờ nhé ☀️"]
        : ["Chào buổi sáng! Hôm nay có việc đến hạn, mình cùng làm nhé 💪", "Ting ting! Điểm danh việc hôm nay nào ☀️"],
      `${input.projectId}-${SHORT_DAY.format(now)}`
    )
  );
}
