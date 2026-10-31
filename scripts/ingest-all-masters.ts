import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { paulArdenArticles } from "./data-paul-arden";
import { paulArdenArticlesPart2 } from "./data-paul-arden-part2";
import { georgeLoisArticles } from "./data-george-lois";
import { georgeLoisArticlesPart2 } from "./data-george-lois-part2";
import { johnHegartyArticles } from "./data-john-hegarty";
import { johnHegartyArticlesPart2 } from "./data-john-hegarty-part2";
import { rorySutherlandArticles } from "./data-rory-sutherland";
import { rorySutherlandArticlesPart2 } from "./data-rory-sutherland-part2";
import { bobHoffmanArticles } from "./data-bob-hoffman";
import { bobHoffmanArticlesPart2 } from "./data-bob-hoffman-part2";

const prisma = new PrismaClient();

function formatLines(lines: string[]) {
  return lines.map((l) => (l === "" ? { gap: true } : { t: l }));
}

function countWords(lines: string[]): number {
  return lines
    .join(" ")
    .replace(/[*_]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

async function main() {
  console.log("🚀 Bắt đầu nạp 150 bài viết của 5 bậc thầy sáng tạo (30 bài / tác giả)...");

  const ardenList = [...paulArdenArticles, ...paulArdenArticlesPart2];
  const loisList = [...georgeLoisArticles, ...georgeLoisArticlesPart2];
  const hegartyList = [...johnHegartyArticles, ...johnHegartyArticlesPart2];
  const sutherlandList = [...rorySutherlandArticles, ...rorySutherlandArticlesPart2];
  const hoffmanList = [...bobHoffmanArticles, ...bobHoffmanArticlesPart2];

  console.log(`Paul Arden: ${ardenList.length} bài`);
  console.log(`George Lois: ${loisList.length} bài`);
  console.log(`Sir John Hegarty: ${hegartyList.length} bài`);
  console.log(`Rory Sutherland: ${sutherlandList.length} bài`);
  console.log(`Bob Hoffman: ${hoffmanList.length} bài`);

  // Interleave round-robin để khi hiển thị theo thứ tự thời gian người đọc có trải nghiệm đa dạng phong phú
  const allMasters: any[] = [];
  const maxLen = Math.max(
    ardenList.length,
    loisList.length,
    hegartyList.length,
    sutherlandList.length,
    hoffmanList.length
  );

  for (let i = 0; i < maxLen; i++) {
    if (i < ardenList.length) allMasters.push(ardenList[i]);
    if (i < loisList.length) allMasters.push(loisList[i]);
    if (i < hegartyList.length) allMasters.push(hegartyList[i]);
    if (i < sutherlandList.length) allMasters.push(sutherlandList[i]);
    if (i < hoffmanList.length) allMasters.push(hoffmanList[i]);
  }

  console.log(`Tổng cộng bài bậc thầy: ${allMasters.length}`);

  // Đọc creativeSeedData.json hiện tại (150 bài Dave Trott)
  const seedPath = path.resolve(__dirname, "../lib/creativeSeedData.json");
  const currentSeed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
  console.log(`Seed data hiện tại: ${currentSeed.length} bài`);

  // Tạo map slug -> article để không trùng lặp
  const seedMap = new Map<string, any>();
  for (const item of currentSeed) {
    seedMap.set(item.slug, item);
  }

  // Chuẩn bị ngày phát hành (từ 2026-10-31 lùi dần 2 tiếng mỗi bài)
  const baseDate = new Date("2026-10-31T12:00:00.000Z");

  const newRecords: any[] = [];

  allMasters.forEach((art, idx) => {
    // Parity check
    if (art.en.length !== art.vi.length) {
      throw new Error(`Mismatch line count in ${art.slug}: EN ${art.en.length} vs VI ${art.vi.length}`);
    }

    const pubDate = new Date(baseDate.getTime() - idx * 3600 * 1000 * 2); // Cách nhau 2 tiếng
    const wordCount = countWords(art.en);
    const existing = seedMap.get(art.slug);
    const id = existing?.id || crypto.randomUUID();

    const record = {
      id,
      slug: art.slug,
      guid: art.guid,
      originalUrl: art.originalUrl,
      originalTitle: art.originalTitle,
      originalPublishedAt: pubDate.toISOString(),
      originalLines: formatLines(art.en),
      wordCount,
      titleVi: art.titleVi,
      linesVi: formatLines(art.vi),
      tags: art.tags,
      status: "PUBLISHED",
      publishedDate: pubDate.toISOString(),
      reviewedById: null,
      createdAt: existing?.createdAt || pubDate.toISOString(),
      updatedAt: new Date().toISOString(),
    };

    seedMap.set(art.slug, record);
    newRecords.push(record);
  });

  // Ghi lại seedData (150 Dave Trott + 150 5 tác giả = 300 bài)
  const updatedSeed = Array.from(seedMap.values());
  fs.writeFileSync(seedPath, JSON.stringify(updatedSeed, null, 2), "utf-8");
  console.log(`✅ Đã cập nhật ${seedPath}: tổng ${updatedSeed.length} bài (150 Dave Trott + 150 bài của 5 tác giả mới).`);

  // Upsert vào cơ sở dữ liệu qua Prisma nếu DB đang chạy
  try {
    console.log("📥 Đang upsert vào Database...");
    let upsertedCount = 0;

    for (const rec of newRecords) {
      await prisma.creativeArticle.upsert({
        where: { slug: rec.slug },
        update: {
          titleVi: rec.titleVi,
          linesVi: rec.linesVi,
          originalLines: rec.originalLines,
          tags: rec.tags,
          originalUrl: rec.originalUrl,
          originalTitle: rec.originalTitle,
          wordCount: rec.wordCount,
          status: rec.status,
          publishedDate: new Date(rec.publishedDate),
        },
        create: {
          id: rec.id,
          slug: rec.slug,
          guid: rec.guid,
          originalUrl: rec.originalUrl,
          originalTitle: rec.originalTitle,
          originalPublishedAt: new Date(rec.originalPublishedAt),
          originalLines: rec.originalLines,
          wordCount: rec.wordCount,
          titleVi: rec.titleVi,
          linesVi: rec.linesVi,
          tags: rec.tags,
          status: rec.status,
          publishedDate: new Date(rec.publishedDate),
        },
      });
      upsertedCount++;
    }

    console.log(`🎉 Hoàn tất upsert thành công ${upsertedCount} bài viết vào Database!`);
  } catch (dbError) {
    console.warn("⚠️ Không thể kết nối cơ sở dữ liệu local (không sao, seedData.json đã cập nhật 300 bài để tự động nạp trên serverless):", (dbError as any).message);
  }
}

main()
  .catch((e) => {
    console.error("Lỗi khi nạp dữ liệu:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
