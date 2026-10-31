/**
 * Áp bản dịch mới (scripts/translations/revised/all-150.json) vào database.
 *
 * Cách dùng:
 *   npx tsx scripts/apply-revised-translations.ts            # chạy thử, không ghi gì
 *   npx tsx scripts/apply-revised-translations.ts --apply    # sao lưu rồi ghi
 *
 * - Chỉ cập nhật titleVi và linesVi; không đụng status, tags, publishedDate.
 * - Từ chối chạy nếu DATABASE_URL không trỏ về localhost, trừ khi đặt ALLOW_REMOTE=1
 *   (áp production là quyết định riêng; sao lưu khi đó có tên backup-remote-<ngày>.json).
 * - Luôn ghi sao lưu backup-<ngày>.json (slug, titleVi, linesVi hiện có) trước khi ghi.
 */
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";

type Line = { t?: string; gap?: boolean };

const dir = path.join(__dirname, "translations", "revised");

async function main() {
  const apply = process.argv.includes("--apply");

  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^:/?]+)/)?.[1] ?? "";
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (!isLocal && process.env.ALLOW_REMOTE !== "1") {
    console.error(`DATABASE_URL trỏ tới "${host}", không phải localhost. Đặt ALLOW_REMOTE=1 nếu thật sự muốn áp lên database này. Dừng.`);
    process.exit(1);
  }
  console.log(`Database: ${host}`);

  const revised = JSON.parse(fs.readFileSync(path.join(dir, "all-150.json"), "utf-8")) as Record<
    string,
    { titleVi: string; linesVi?: Line[] }
  >;
  const rows = await prisma.creativeArticle.findMany({
    select: { slug: true, titleVi: true, linesVi: true, originalLines: true },
  });

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const problems: string[] = [];
  for (const slug of Object.keys(revised)) {
    const row = bySlug.get(slug);
    const item = revised[slug];
    if (!row) { problems.push(`${slug}: không có trong database`); continue; }
    if (!item.titleVi || !item.linesVi) { problems.push(`${slug}: thiếu titleVi hoặc linesVi`); continue; }
    const original = row.originalLines as Line[];
    const same =
      original.length === item.linesVi.length &&
      original.every((l, i) => !!l.gap === !!item.linesVi![i].gap && (!!l.gap || !!item.linesVi![i].t));
    if (!same) problems.push(`${slug}: cấu trúc dòng không khớp bản gốc`);
  }
  for (const r of rows) if (!revised[r.slug]) problems.push(`${r.slug}: chưa có bản dịch mới`);
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(`\n${problems.length} vấn đề, không ghi gì.`);
    process.exit(1);
  }

  console.log(`${Object.keys(revised).length} bài hợp lệ.`);
  if (!apply) {
    console.log("Chạy thử xong, chưa ghi gì. Thêm --apply để sao lưu và ghi.");
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(dir, `backup-${isLocal ? "" : "remote-"}${date}.json`);
  if (fs.existsSync(backupPath)) {
    console.error(`${backupPath} đã tồn tại, không ghi đè. Đổi tên hoặc xóa rồi chạy lại.`);
    process.exit(1);
  }
  fs.writeFileSync(
    backupPath,
    JSON.stringify(rows.map((r) => ({ slug: r.slug, titleVi: r.titleVi, linesVi: r.linesVi })), null, 2) + "\n"
  );
  console.log(`Đã sao lưu ${rows.length} bài vào ${backupPath}`);

  await prisma.$transaction(
    Object.entries(revised).map(([slug, item]) =>
      prisma.creativeArticle.update({
        where: { slug },
        data: { titleVi: item.titleVi, linesVi: item.linesVi as object[] },
      })
    )
  );
  console.log(`Đã cập nhật ${Object.keys(revised).length} bài.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
