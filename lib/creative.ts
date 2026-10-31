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


// ---------------------------------------------------------------------------
// Thông tin các tác giả trong Góc Đọc myCreative
// ---------------------------------------------------------------------------

export interface AuthorMetadata {
  slug: string;
  name: string;
  role: string;
  sourceDomain: string;
  sourceLabel: string;
  defaultSourceUrl: string;
  bioVi: string;
}

export const KNOWN_AUTHORS: Record<string, AuthorMetadata> = {
  "dave-trott": {
    slug: "dave-trott",
    name: "Dave Trott",
    role: "Huyền thoại Quảng cáo Anh quốc",
    sourceDomain: "davetrott.co.uk",
    sourceLabel: "davetrott.co.uk",
    defaultSourceUrl: "https://davetrott.co.uk",
    bioVi: "Cựu Giám đốc Sáng tạo BMP, GGT, tác giả của 'Predatory Thinking' và 'Creative Mischief'.",
  },
  "paul-arden": {
    slug: "paul-arden",
    name: "Paul Arden",
    role: "Cựu Giám đốc Sáng tạo Saatchi & Saatchi",
    sourceDomain: "phaidon.com",
    sourceLabel: "Phaidon Press",
    defaultSourceUrl: "https://www.phaidon.com/store/general-non-fiction/its-not-how-good-you-are-its-how-good-you-want-to-be-9780714843377/",
    bioVi: "Phù thủy quảng cáo đưa Saatchi & Saatchi lên đỉnh cao thế giới, tác giả cuốn sách kinh điển 'It's Not How Good You Are, It's How Good You Want to Be'.",
  },
  "george-lois": {
    slug: "george-lois",
    name: "George Lois",
    role: "Bố già Cách mạng Sáng tạo Mỹ",
    sourceDomain: "phaidon.com",
    sourceLabel: "Phaidon Press",
    defaultSourceUrl: "https://www.phaidon.com/store/general-non-fiction/damn-good-advice-for-people-with-talent-9780714863481/",
    bioVi: "Nhà tiên phong tạo nên thời kỳ hoàng kim của quảng cáo Madison Avenue, tác giả 92 bìa Esquire huyền thoại và cuốn 'Damn Good Advice'.",
  },
  "rory-sutherland": {
    slug: "rory-sutherland",
    name: "Rory Sutherland",
    role: "Phó Chủ tịch Ogilvy UK",
    sourceDomain: "penguin.co.uk",
    sourceLabel: "Penguin Books",
    defaultSourceUrl: "https://www.penguin.co.uk/books/291244/alchemy-by-sutherland-rory/9780753556528",
    bioVi: "Bậc thầy tâm lý học hành vi và thuật giả kim tiếp thị, tác giả cuốn sách bestseller 'Alchemy: The Surprising Power of Ideas That Don't Make Sense'.",
  },
  "bob-hoffman": {
    slug: "bob-hoffman",
    name: "Bob Hoffman",
    role: "The Ad Contrarian",
    sourceDomain: "adcontrarian.com",
    sourceLabel: "adcontrarian.com",
    defaultSourceUrl: "https://www.adcontrarian.com",
    bioVi: "Cựu CEO Hoffman/Lewis, cây bút gai góc số 1 thế giới về lột trần ảo tưởng tiếp thị số, tác giả 'BadMen' và 'Advertising for Skeptics'.",
  },
  "john-hegarty": {
    slug: "john-hegarty",
    name: "Sir John Hegarty",
    role: "Đồng sáng lập BBH (Bartle Bogle Hegarty)",
    sourceDomain: "thamesandhudson.com",
    sourceLabel: "Thames & Hudson",
    defaultSourceUrl: "https://www.thamesandhudson.com/hegarty-on-advertising-turning-intelligence-into-magic-9780500293621",
    bioVi: "Hiệp sĩ hoàng gia Anh, huyền thoại tạo nên 'Vorsprung durch Technik' của Audi và 'When the world zigs, zag' của Levi's.",
  },
};

export function getArticleAuthor(tags: string[] = []): AuthorMetadata {
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === "string" && tag.startsWith("author:")) {
        const slug = tag.replace("author:", "").trim();
        if (KNOWN_AUTHORS[slug]) {
          return KNOWN_AUTHORS[slug];
        }
      }
    }
  }
  return KNOWN_AUTHORS["dave-trott"];
}

// ---------------------------------------------------------------------------
// Hiển thị trên trang Góc Đọc
// ---------------------------------------------------------------------------

const EN_KEEP_WORDS: Record<string, string> = {
  i: "I",
  "i’m": "I’m",
  "i’d": "I’d",
  "i’ll": "I’ll",
  "i’ve": "I’ve",
  "i'm": "I'm",
  ai: "AI",
  christmas: "Christmas",
};

/**
 * Đổi tựa IN HOA sang kiểu câu ("Tôi có được gì từ đó?") để dễ đọc.
 * Tiếng Việt chỉ giữ "AI" (trí tuệ nhân tạo) khi tựa tiếng Anh gốc cũng có "AI",
 * vì "ai" trong tiếng Việt còn nghĩa là "người nào".
 */
export function toDisplayTitle(title: string, lang: "en" | "vi", englishTitle = ""): string {
  const locale = lang === "vi" ? "vi-VN" : "en-GB";
  const keepAiVi = lang === "vi" && /(^|[^\p{L}])AI([^\p{L}]|$)/u.test(englishTitle);

  let out = title.normalize("NFC").toLocaleLowerCase(locale);
  out = out.replace(/[\p{L}\p{M}’']+/gu, (word) => {
    if (lang === "en" && EN_KEEP_WORDS[word]) return EN_KEEP_WORDS[word];
    if (keepAiVi && word === "ai") return "AI";
    return word;
  });
  if (lang === "vi") out = out.replace(/giáng sinh/g, "Giáng sinh");

  // Viết hoa chữ cái đầu tiên và chữ cái đầu mỗi câu sau . ! ?
  out = out.replace(
    /(^|[.!?]\s+)([^\p{L}]*)(\p{L})/gu,
    (_m, before: string, punct: string, letter: string) => before + punct + letter.toLocaleUpperCase(locale)
  );
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Ngày "YYYY-MM-DD" theo giờ Việt Nam. */
export function vnDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(date);
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export interface CreativeDayInfo {
  /** "Hôm nay", "Hôm qua", "3 ngày trước" hoặc "25/10" */
  label: string;
  /** Khóa nhóm: "week", "lastWeek" hoặc "m-YYYY-MM" */
  groupKey: string;
  /** "Tuần này", "Tuần trước" hoặc "Tháng 9" */
  groupLabel: string;
}

/** Nhãn ngày ngắn gọn và nhóm thời gian của một bài so với hôm nay (giờ VN). */
export function describeCreativeDay(published: Date, today: Date): CreativeDayInfo {
  const pubKey = vnDateKey(published);
  const todayKey = vnDateKey(today);
  const pubDay = dayNumber(pubKey);
  const todayDay = dayNumber(todayKey);
  const diff = todayDay - pubDay;
  const [py, pm, pd] = pubKey.split("-");
  const ty = todayKey.slice(0, 4);

  let label: string;
  if (diff === 0) label = "Hôm nay";
  else if (diff === 1) label = "Hôm qua";
  else if (diff > 1 && diff < 7) label = `${diff} ngày trước`;
  else label = py === ty ? `${pd}/${pm}` : `${pd}/${pm}/${py}`;

  // Tuần bắt đầu từ Thứ Hai
  const todayDow = (new Date(todayDay * 86_400_000).getUTCDay() + 6) % 7;
  const weekStart = todayDay - todayDow;
  if (pubDay >= weekStart) return { label, groupKey: "week", groupLabel: "Tuần này" };
  if (pubDay >= weekStart - 7) return { label, groupKey: "lastWeek", groupLabel: "Tuần trước" };
  const month = String(Number(pm));
  return {
    label,
    groupKey: `m-${py}-${pm}`,
    groupLabel: py === ty ? `Tháng ${month}` : `Tháng ${month}/${py}`,
  };
}

/**
 * Câu trích nổi bật: đoạn in đậm đầu tiên là cả một dòng hoặc mở đầu bằng dấu ngoặc kép.
 */
export function extractPullQuote(lines: ArticleLine[]): string | null {
  for (const line of lines) {
    if (!isTextLine(line)) continue;
    const text = line.t.trim();
    const match = text.match(/\*\*(.+?)\*\*/);
    if (!match) continue;
    const inner = match[1].trim();
    const wholeLine = text.replace(/[*_]/g, "").trim() === inner.replace(/[*_]/g, "").trim();
    const quoted = /^[“"]/.test(inner);
    if (!wholeLine && !quoted) continue;
    // Bỏ qua câu bị cắt giữa chừng (ngoặc kép lệch cặp) hoặc viết hoa toàn bộ
    const opens = (inner.match(/[“]/g) || []).length;
    const closes = (inner.match(/[”]/g) || []).length;
    if (opens !== closes) continue;
    const clean = inner
      .replace(/[*_]/g, "")
      .trim()
      .replace(/^[“"‘']+/, "")
      .replace(/[”"’']+([.!?…]?)$/, "$1")
      .trim();
    if (!/^\p{Lu}/u.test(clean) || clean === clean.toLocaleUpperCase("vi-VN")) continue;
    if (clean.length >= 30 && clean.length <= 160) return clean;
  }
  return null;
}
