import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countWords,
  decodeHtmlEntities,
  describeCreativeDay,
  estimateReadingMinutes,
  extractPullQuote,
  getArticleAuthor,
  getOriginalArticleUrl,
  getWeekdaySchedule,
  isGapLine,
  isTextLine,
  parseHtmlToLines,
  slugifyTitle,
  toDisplayTitle,
  KNOWN_AUTHORS,
} from "../lib/creative";

test("slugifyTitle formats English titles properly", () => {
  assert.equal(
    slugifyTitle("THE FIRST LESSON IS: NO ONE’S EVEN LOOKING"),
    "the-first-lesson-is-no-ones-even-looking"
  );
  assert.equal(slugifyTitle("WRONG PROBLEM = WRONG SOLUTION"), "wrong-problem-wrong-solution");
  assert.equal(slugifyTitle("WHAT AI CAN’T THINK OF"), "what-ai-cant-think-of");
});

test("decodeHtmlEntities decodes common HTML entities", () => {
  assert.equal(decodeHtmlEntities("It&#039;s a test"), "It’s a test");
  assert.equal(decodeHtmlEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(decodeHtmlEntities("&ldquo;Hello&rdquo;"), "“Hello”");
  assert.equal(decodeHtmlEntities("Wait&hellip;"), "Wait…");
});

test("parseHtmlToLines converts WordPress HTML paragraphs to ArticleLine array", () => {
  const html = `
    <p>Many years ago, my dad joined the police.</p>
    <p>&nbsp;</p>
    <p>As soon as he left the sergeant said, <strong>“Right, the test starts now.”</strong></p>
    <p>The post TEST POST first appeared on Dave Trott's Blog.</p>
  `;
  const lines = parseHtmlToLines(html);

  assert.equal(lines.length, 3);
  assert.equal(isTextLine(lines[0]), true);
  if (isTextLine(lines[0])) {
    assert.equal(lines[0].t, "Many years ago, my dad joined the police.");
  }

  assert.equal(isGapLine(lines[1]), true);

  assert.equal(isTextLine(lines[2]), true);
  if (isTextLine(lines[2])) {
    assert.equal(
      lines[2].t,
      "As soon as he left the sergeant said, **“Right, the test starts now.”**"
    );
  }
});

test("countWords and estimateReadingMinutes work accurately", () => {
  const lines = [
    { t: "One two three four five." },
    { gap: true as const },
    { t: "Six seven eight nine ten." },
  ];
  assert.equal(countWords(lines), 10);
  assert.equal(estimateReadingMinutes(10), 1);
  assert.equal(estimateReadingMinutes(450), 3);
});

test("getWeekdaySchedule returns only weekdays (Monday - Friday)", () => {
  // Bắt đầu từ thứ Sáu ngày 2026-10-30
  const startFriday = new Date(Date.UTC(2026, 9, 30, 0, 0, 0));
  const schedule = getWeekdaySchedule(startFriday, 5);

  assert.equal(schedule.length, 5);
  for (const date of schedule) {
    const day = date.getDay();
    assert.notEqual(day, 0, "Không được rơi vào Chủ Nhật");
    assert.notEqual(day, 6, "Không được rơi vào Thứ Bảy");
  }
});


test("toDisplayTitle turns uppercase titles into sentence case", () => {
  assert.equal(toDisplayTitle("TÔI CÓ ĐƯỢC GÌ TỪ ĐÓ?", "vi"), "Tôi có được gì từ đó?");
  assert.equal(toDisplayTitle("WHAT’S IN IT FOR ME?", "en"), "What’s in it for me?");
  assert.equal(
    toDisplayTitle("SHOULD I JUST REPEAT THE SAME BLOG-POST EVERY WEEK?", "en"),
    "Should I just repeat the same blog-post every week?"
  );
  assert.equal(
    toDisplayTitle("ĐỪNG CHỈ CHEN VÀO THỊ TRƯỜNG. HÃY TẠO RA MỘT THỊ TRƯỜNG MỚI.", "vi"),
    "Đừng chỉ chen vào thị trường. Hãy tạo ra một thị trường mới."
  );
  assert.equal(toDisplayTitle("“LÀM ƠN ĐỪNG NÉM TÔI VÀO BỤI GAI”", "vi"), "“Làm ơn đừng ném tôi vào bụi gai”");
  assert.equal(toDisplayTitle("IT’S EASY TO  BE NEGATIVE, ANYONE CAN DO IT.", "en"), "It’s easy to be negative, anyone can do it.");
  assert.equal(toDisplayTitle("SÁNG TẠO MÙA GIÁNG SINH", "vi"), "Sáng tạo mùa Giáng sinh");
});

test("toDisplayTitle keeps AI only when the English title means artificial intelligence", () => {
  assert.equal(toDisplayTitle("WHAT AI CAN’T THINK OF", "en"), "What AI can’t think of");
  assert.equal(
    toDisplayTitle("THỨ MÀ AI KHÔNG THỂ NGHĨ RA", "vi", "WHAT AI CAN’T THINK OF"),
    "Thứ mà AI không thể nghĩ ra"
  );
  assert.equal(
    toDisplayTitle("RỐT CUỘC AI MỚI LÀ KẺ NGHỊCH NGỢM?", "vi", "WHO’S A NAUGHTY BOY THEN?"),
    "Rốt cuộc ai mới là kẻ nghịch ngợm?"
  );
});

test("describeCreativeDay gives short labels and week groups in Vietnam time", () => {
  // Thứ Năm 29/10/2026, 9h sáng giờ VN
  const today = new Date("2026-10-29T02:00:00.000Z");
  const day = (iso: string) => describeCreativeDay(new Date(`${iso}T00:00:00.000Z`), today);

  assert.deepEqual(day("2026-10-29"), { label: "Hôm nay", groupKey: "week", groupLabel: "Tuần này" });
  assert.deepEqual(day("2026-10-28"), { label: "Hôm qua", groupKey: "week", groupLabel: "Tuần này" });
  assert.deepEqual(day("2026-10-26"), { label: "3 ngày trước", groupKey: "week", groupLabel: "Tuần này" });
  assert.deepEqual(day("2026-10-25"), { label: "4 ngày trước", groupKey: "lastWeek", groupLabel: "Tuần trước" });
  assert.deepEqual(day("2026-10-19"), { label: "19/10", groupKey: "lastWeek", groupLabel: "Tuần trước" });
  assert.deepEqual(day("2026-10-18"), { label: "18/10", groupKey: "m-2026-10", groupLabel: "Tháng 10" });
  assert.deepEqual(day("2025-12-31"), { label: "31/12/2025", groupKey: "m-2025-12", groupLabel: "Tháng 12/2025" });
});

test("extractPullQuote picks a quoted or whole-line bold sentence", () => {
  assert.equal(
    extractPullQuote([
      { t: "Gordon bảo họ: **“Cậu nên làm theo cách thằng bạn Dave của tôi ấy.”**" },
    ]),
    "Cậu nên làm theo cách thằng bạn Dave của tôi ấy."
  );
  assert.equal(
    extractPullQuote([
      { t: "Món** ‘Bữa trưa của Thợ cày’ (Ploughman’s Lunch)**, món ăn truyền thống." },
      { gap: true },
      { t: "**Chiến lược nghĩa là chọn thứ mình sẽ không làm.**" },
    ]),
    "Chiến lược nghĩa là chọn thứ mình sẽ không làm."
  );
  assert.equal(
    extractPullQuote([{ t: "Giọng họ ngập ngừng: **“Tốt nhất anh nên ghé qua văn phòng, có chút rắc rối rồi”.**" }]),
    "Tốt nhất anh nên ghé qua văn phòng, có chút rắc rối rồi."
  );
  assert.equal(extractPullQuote([{ t: "Không có đoạn in đậm nào." }]), null);
  assert.equal(extractPullQuote([{ t: "**“Quá ngắn”**" }]), null);
  assert.equal(extractPullQuote([{ t: "**Cứ để đó cho chúng tôi, chúng tôi lo hết mọi thứ”.**" }]), null);
  assert.equal(extractPullQuote([{ t: "**ĐĂNG KIỂM CHÍNH BẠN, ĐỪNG ĐỢI NGƯỜI KHÁC LÀM.**" }]), null);
  assert.equal(extractPullQuote([{ t: "**nghe như chiêu trò của mấy gã thợ dệt tartan**" }]), null);
});

test("getArticleAuthor identifies authors by tag or defaults to Dave Trott", () => {
  assert.equal(getArticleAuthor([]).slug, "dave-trott");
  assert.equal(getArticleAuthor(["author:paul-arden"]).slug, "paul-arden");
  assert.equal(getArticleAuthor(["advertising", "author:rory-sutherland"]).name, "Rory Sutherland");
  assert.equal(getArticleAuthor(["author:unknown-person"]).slug, "dave-trott");
  assert.equal(Object.keys(KNOWN_AUTHORS).length, 6);
  assert.equal(KNOWN_AUTHORS["dave-trott"].hasOriginalArticles, true);
  assert.equal(KNOWN_AUTHORS["paul-arden"].hasOriginalArticles, false);
});

test("getOriginalArticleUrl returns article URL only for authors with original articles", () => {
  assert.equal(
    getOriginalArticleUrl({
      originalUrl: "https://davetrott.co.uk/2024/01/post/",
      tags: [],
    }),
    "https://davetrott.co.uk/2024/01/post/"
  );
  assert.equal(
    getOriginalArticleUrl({
      originalUrl: "https://www.phaidon.com/book",
      tags: ["author:paul-arden"],
    }),
    null
  );
  assert.equal(
    getOriginalArticleUrl({
      originalUrl: "https://penguin.co.uk/books",
      tags: ["author:rory-sutherland"],
    }),
    null
  );
});
