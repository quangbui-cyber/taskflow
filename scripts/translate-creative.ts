/**
 * Script dịch bài viết Dave Trott sang tiếng Việt bằng Gemini AI
 * Bảo toàn 100% phong cách Staccato (cắt câu ngắn, 1 dòng 1 câu, cú twist).
 *
 * Cách chạy:
 *   npx tsx scripts/translate-creative.ts --limit 10
 *   npx tsx scripts/translate-creative.ts --slug the-first-lesson-is-no-ones-even-looking
 *   npx tsx scripts/translate-creative.ts --key YOUR_GEMINI_KEY
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  type ArticleLine,
  isGapLine,
  isTextLine,
  getWeekdaySchedule,
} from "../lib/creative";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_PROMPT = `Bạn là một Giám đốc Sáng tạo (Creative Director) kiêm Copywriter tiếng Việt hàng đầu.
Nhiệm vụ của bạn là dịch toàn văn bài viết của huyền thoại quảng cáo Dave Trott sang tiếng Việt.

NGUYÊN TẮC VĂN PHONG BẮT BUỘC:
1. KHỚP DÒNG 1:1 (STACCATO):
   - Mảng đầu vào có N dòng chữ thì mảng dịch phải có đúng N dòng tương ứng.
   - Dòng số i tiếng Việt là bản dịch chính xác của dòng số i tiếng Anh.
   - Không được gộp các câu lại thành đoạn văn. Không tự ý ngắt thêm dòng. Không bỏ sót bất kỳ dòng nào.

2. NGÔN TỪ GÃY GỌN & ĐỜI THƯỜNG:
   - Dùng từ ngữ đời thường, đanh thép, sắc bén, dứt khoát.
   - Tuyệt đối KHÔNG dùng từ Hán Việt hoa mỹ, không dùng văn phong hành chính hay văn dịch máy rườm rà.
   - Không tự ý thêm các từ nối sáo rỗng ("và", "tuy nhiên", "mặc dù") nếu bản gốc không có.
   - Câu ngắn dịch ngắn. Câu cụt dịch cụt.

3. GIỮ NGUYÊN CÚ TWIST & ĐIỂM NHẤN:
   - Giữ nguyên các vị trí in đậm **...** hoặc in nghiêng *...* tương ứng như nguyên bản.
   - Đoạn kết của Dave Trott luôn là cú đấm thức tỉnh (punchline): dịch sao cho bất ngờ, thấm thía và gãy gọn như bản gốc.
   - Tiêu đề dịch titleVi phải viết IN HOA như bản gốc.

TRẢ VỀ ĐÚNG ĐỊNH DẠNG JSON SAU (không thêm markdown backtick ngoài JSON):
{
  "titleVi": "TIÊU ĐỀ TIẾNG VIỆT IN HOA",
  "lines": ["Dòng 1...", "Dòng 2...", "..."],
  "tags": ["sangtao", "tuduy", "copywriting"]
}`;

interface TranslationResponse {
  titleVi: string;
  lines: string[];
  tags?: string[];
}

async function callGemini(
  apiKey: string,
  model: string,
  title: string,
  textOnlyLines: string[]
): Promise<TranslationResponse> {
  const userContent = JSON.stringify({
    originalTitle: title,
    linesToTranslate: textOnlyLines,
  });

  const res = await fetch(
    `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.3,
        },
      }),
    }
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errorBody}`);
  }

  const data = await res.json();
  const text =
    data.candidates?.[0]?.content?.parts
      ?.filter((p: { thought?: boolean; text?: string }) => !p.thought)
      ?.map((p: { text?: string }) => p.text ?? "")
      ?.join("") ?? "";

  const parsed = JSON.parse(text) as TranslationResponse;
  return parsed;
}

export async function translateArticleWithAi(
  article: {
    id: string;
    originalTitle: string;
    originalLines: ArticleLine[];
  },
  apiKey: string,
  model = "gemini-2.5-flash"
): Promise<{ titleVi: string; linesVi: ArticleLine[]; tags: string[] }> {
  // Tách riêng các dòng chữ để gửi model (bỏ gap)
  const textOnlyIndices: number[] = [];
  const textOnlyLines: string[] = [];

  article.originalLines.forEach((line, index) => {
    if (isTextLine(line)) {
      textOnlyIndices.push(index);
      textOnlyLines.push(line.t);
    }
  });

  let translated: TranslationResponse | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      translated = await callGemini(apiKey, model, article.originalTitle, textOnlyLines);
      if (translated && Array.isArray(translated.lines) && translated.lines.length === textOnlyLines.length) {
        break;
      }
      console.warn(
        `[Lần thử ${attempt}] Dòng không khớp: cần ${textOnlyLines.length}, nhận được ${translated?.lines?.length}`
      );
    } catch (err) {
      lastError = err;
      console.warn(`[Lần thử ${attempt}] Lỗi Gemini:`, err);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  if (!translated || !Array.isArray(translated.lines) || translated.lines.length !== textOnlyLines.length) {
    throw new Error(
      `Không thể dịch khớp 1:1 dòng sau 2 lần thử. Chi tiết: ${String(lastError)}`
    );
  }

  // Ráp lại mảng đầy đủ có chứa gap đúng như bản gốc
  const linesVi: ArticleLine[] = article.originalLines.map((originalLine) => {
    if (isGapLine(originalLine)) {
      return { gap: true };
    }
    return { t: "" };
  });

  textOnlyIndices.forEach((origIdx, i) => {
    linesVi[origIdx] = { t: translated!.lines[i] };
  });

  return {
    titleVi: translated.titleVi.trim().toUpperCase(),
    linesVi,
    tags: Array.isArray(translated.tags) ? translated.tags : ["sangtao", "tuduy"],
  };
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 10;
  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  }

  let slugFilter: string | null = null;
  const slugIdx = args.indexOf("--slug");
  if (slugIdx !== -1 && args[slugIdx + 1]) {
    slugFilter = args[slugIdx + 1];
  }

  let apiKey = process.env.GEMINI_API_KEY || "";
  const keyIdx = args.indexOf("--key");
  if (keyIdx !== -1 && args[keyIdx + 1]) {
    apiKey = args[keyIdx + 1];
  }

  if (!apiKey) {
    console.error("❌ Chưa có GEMINI_API_KEY. Vui lòng truyền qua --key hoặc khai báo trong biến môi trường.");
    process.exit(1);
  }

  const articles = await prisma.creativeArticle.findMany({
    where: slugFilter
      ? { slug: slugFilter }
      : {
          linesVi: { equals: Prisma.DbNull },
          status: "DRAFT",
        },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  console.log(`Bắt đầu dịch ${articles.length} bài viết...`);

  // Tạo lịch phát hành các ngày làm việc (Thứ 2 - Thứ 6)
  const scheduleDates = getWeekdaySchedule(new Date(), articles.length);

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const pubDate = scheduleDates[i];
    console.log(`\n[${i + 1}/${articles.length}] Đang dịch: "${article.originalTitle}"...`);

    try {
      const result = await translateArticleWithAi(
        {
          id: article.id,
          originalTitle: article.originalTitle,
          originalLines: article.originalLines as unknown as ArticleLine[],
        },
        apiKey
      );

      // Bài đầu tiên phát hành ngay hôm nay (PUBLISHED) để xem được luôn
      const status = i === 0 ? "PUBLISHED" : "SCHEDULED";

      await prisma.creativeArticle.update({
        where: { id: article.id },
        data: {
          titleVi: result.titleVi,
          linesVi: result.linesVi as unknown as object[],
          tags: result.tags,
          status,
          publishedDate: pubDate,
        },
      });

      console.log(`✅ Hoàn thành: "${result.titleVi}" (Ngày: ${pubDate.toISOString().slice(0, 10)}, Trạng thái: ${status})`);
    } catch (err) {
      console.error(`❌ Thất bại bài "${article.originalTitle}":`, err);
    }
  }

  console.log("\n🎉 Hoàn thành tiến trình dịch!");
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
