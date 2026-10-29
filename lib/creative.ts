/**
 * Tiện ích và kiểu dữ liệu cho Góc Đọc & Cảm Hứng (Dave Trott daily drops).
 */

export type ArticleTextLine = { t: string };
export type ArticleGapLine = { gap: true };
export type ArticleLine = ArticleTextLine | ArticleGapLine;

export function isGapLine(line: ArticleLine): line is ArticleGapLine {
  return "gap" in line && line.gap === true;
}

export function isTextLine(line: ArticleLine): line is ArticleTextLine {
  return "t" in line && typeof line.t === "string";
}

export const CREATIVE_STATUS = {
  DRAFT: "DRAFT",
  REVIEW: "REVIEW",
  SCHEDULED: "SCHEDULED",
  PUBLISHED: "PUBLISHED",
  HIDDEN: "HIDDEN",
} as const;

export type CreativeStatus = (typeof CREATIVE_STATUS)[keyof typeof CREATIVE_STATUS];

/**
 * Giải mã các HTML entities thường gặp trong RSS feed WordPress
 */
export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#038;/g, "&")
    .replace(/&#039;/g, "’")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8230;/g, "…")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&hellip;/g, "…")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ");
}

/**
 * Tạo slug thân thiện URL từ tiêu đề tiếng Anh
 */
export function slugifyTitle(title: string): string {
  return decodeHtmlEntities(title)
    .toLowerCase()
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Chuyển HTML bài viết từ WordPress RSS thành mảng dòng ArticleLine[]
 * Giữ nguyên các định dạng bold (**), italic (*) và loại bỏ boilerplate cuối bài.
 */
export function parseHtmlToLines(rawContent: string): ArticleLine[] {
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const lines: ArticleLine[] = [];
  let match: RegExpExecArray | null;

  while ((match = pRegex.exec(rawContent)) !== null) {
    let inner = match[1];

    // Chuyển <strong> và <b> thành markdown **
    inner = inner.replace(/<\/?(strong|b)>/gi, "**");
    // Chuyển <em> và <i> thành markdown *
    inner = inner.replace(/<\/?(em|i)>/gi, "*");
    // Bỏ tất cả thẻ HTML khác (như <a>, <span>, <br>)
    inner = inner.replace(/<[^>]+>/g, "");
    inner = decodeHtmlEntities(inner).trim();

    // Bỏ qua dòng chữ thông báo mặc định của WordPress RSS ở cuối bài
    if (/^The post .* first appeared on /i.test(inner)) {
      continue;
    }

    // Nếu dòng rỗng hoặc chỉ toàn dấu *, gạch dưới, khoảng trắng
    const stripped = inner.replace(/[\*\s_]/g, "");
    if (!stripped) {
      if (lines.length > 0 && !isGapLine(lines[lines.length - 1])) {
        lines.push({ gap: true });
      }
    } else {
      lines.push({ t: inner });
    }
  }

  // Cắt bỏ các gap thừa ở đầu và cuối bài
  while (lines.length > 0 && isGapLine(lines[0])) lines.shift();
  while (lines.length > 0 && isGapLine(lines[lines.length - 1])) lines.pop();

  return lines;
}

/**
 * Đếm tổng số từ tiếng Anh trong các dòng bài viết
 */
export function countWords(lines: ArticleLine[]): number {
  let count = 0;
  for (const line of lines) {
    if (isTextLine(line)) {
      const words = line.t.trim().split(/\s+/).filter(Boolean);
      count += words.length;
    }
  }
  return count;
}

/**
 * Ước lượng thời gian đọc theo số từ (Dave Trott staccato đọc nhanh, ~150-180 từ/phút)
 */
export function estimateReadingMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 160));
}

/**
 * Format ngày theo kiểu Việt Nam: "Thứ Tư, 28/10/2026"
 */
export function formatCreativeDate(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

/**
 * Lấy danh sách N ngày làm việc (Thứ 2 - Thứ 6) bắt đầu từ ngày startDate
 */
export function getWeekdaySchedule(startDate: Date, count: number): Date[] {
  const result: Date[] = [];
  const current = new Date(startDate);
  // Đưa về 00:00:00 theo giờ VN
  current.setHours(0, 0, 0, 0);

  while (result.length < count) {
    const dayOfWeek = current.getDay(); // 0 = CN, 6 = Thứ 7
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      result.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return result;
}

