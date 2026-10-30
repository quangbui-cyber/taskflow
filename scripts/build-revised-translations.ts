/**
 * Ghép bản dịch mới vào đúng cấu trúc dòng của bài gốc và kiểm tra lệch.
 *
 * Cách dùng:
 *   npx tsx scripts/build-revised-translations.ts <input.json> <output.json>
 *
 * input.json có dạng:
 *   { "<slug>": { "titleVi": "TIÊU ĐỀ", "vi": ["dòng chữ 1", "dòng chữ 2", ...] } }
 *   - "vi" chỉ chứa các dòng CHỮ, theo thứ tự; dòng trống (gap) do script tự chèn theo bài gốc.
 *   - Bỏ "vi" nếu chỉ sửa tiêu đề.
 *
 * output.json có cùng định dạng với scripts/translations/batch-N-output.json:
 *   { "<slug>": { "titleVi": "...", "linesVi": [{ "t": "..." }, { "gap": true }, ...] } }
 *
 * Script chỉ ĐỌC database (bản gốc tiếng Anh), không ghi gì vào database.
 */
import fs from "fs";
import { prisma } from "../lib/prisma";

type Line = { t?: string; gap?: boolean };

const numbers = (s: string) =>
  (s.match(/\d[\d.,]*\d|\d/g) ?? []).map((n) => n.replace(/[.,]/g, "")).sort();

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Cách dùng: npx tsx scripts/build-revised-translations.ts <input.json> <output.json>");
    process.exit(1);
  }

  const source = JSON.parse(fs.readFileSync(input, "utf-8")) as Record<string, { titleVi: string; vi?: string[] }>;
  const result: Record<string, { titleVi: string; linesVi?: Line[] }> = {};
  let errors = 0;
  let warnings = 0;

  for (const [slug, item] of Object.entries(source)) {
    const article = await prisma.creativeArticle.findUnique({
      where: { slug },
      select: { originalTitle: true, originalLines: true },
    });
    if (!article) {
      console.log(`✗ ${slug}: không tìm thấy bài trong database`);
      errors++;
      continue;
    }

    if (!item.titleVi || item.titleVi !== item.titleVi.toUpperCase()) {
      console.log(`⚠ ${slug}: tiêu đề nên viết IN HOA ("${item.titleVi}")`);
      warnings++;
    }

    if (!item.vi) {
      result[slug] = { titleVi: item.titleVi };
      console.log(`✓ ${slug}: chỉ tiêu đề`);
      continue;
    }

    const original = article.originalLines as Line[];
    const textCount = original.filter((l) => l.t !== undefined).length;
    if (textCount !== item.vi.length) {
      console.log(`✗ ${slug}: bài gốc có ${textCount} dòng chữ, bản dịch có ${item.vi.length}`);
      errors++;
      continue;
    }

    let next = 0;
    const lines: Line[] = original.map((line, index) => {
      if (line.gap) return { gap: true };
      const vi = item.vi![next++];
      const boldEn = (line.t!.match(/\*\*/g) ?? []).length;
      const boldVi = (vi.match(/\*\*/g) ?? []).length;
      if (boldVi % 2 !== 0 || boldEn > 0 !== boldVi > 0) {
        console.log(`⚠ ${slug}[${index}] in đậm lệch: gốc ${boldEn}, dịch ${boldVi}`);
        warnings++;
      }
      if (numbers(line.t!).join("|") !== numbers(vi).join("|")) {
        console.log(
          `⚠ ${slug}[${index}] số liệu lệch: gốc ${numbers(line.t!).join(",")} | dịch ${numbers(vi).join(",")} (kiểm tra bằng mắt, có thể báo nhầm)`
        );
        warnings++;
      }
      if (!vi.trim()) {
        console.log(`✗ ${slug}[${index}] dòng dịch rỗng`);
        errors++;
      }
      return { t: vi };
    });

    result[slug] = { titleVi: item.titleVi, linesVi: lines };
    console.log(`✓ ${slug}: ${lines.length} dòng khớp`);
  }

  if (errors === 0) {
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
    console.log(`\nĐã ghi ${Object.keys(result).length} bài vào ${output} (${warnings} cảnh báo)`);
  } else {
    console.log(`\n${errors} lỗi, KHÔNG ghi file. Sửa input rồi chạy lại.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
