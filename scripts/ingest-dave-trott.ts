/**
 * Script cào bài viết từ Dave Trott Blog qua RSS Feed
 * URL: https://davetrott.co.uk/feed/?paged=N
 *
 * Cách chạy:
 *   npx tsx scripts/ingest-dave-trott.ts --limit 30
 *   npx tsx scripts/ingest-dave-trott.ts --all
 */

import { prisma } from "../lib/prisma";
import {
  countWords,
  decodeHtmlEntities,
  parseHtmlToLines,
  slugifyTitle,
} from "../lib/creative";

interface FeedItem {
  title: string;
  link: string;
  pubDate: Date | null;
  guid: string;
  rawContent: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function cleanUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function fetchPage(pageNumber: number): Promise<FeedItem | null> {
  const url = `https://davetrott.co.uk/feed/?paged=${pageNumber}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(`[Page ${pageNumber}] HTTP error ${res.status}`);
      return null;
    }

    const xml = await res.text();
    const titleMatch = xml.match(/<item>[\s\S]*?<title>(.*?)<\/title>/);
    const linkMatch = xml.match(/<item>[\s\S]*?<link>(.*?)<\/link>/);
    const pubDateMatch = xml.match(/<item>[\s\S]*?<pubDate>(.*?)<\/pubDate>/);
    const guidMatch = xml.match(/<item>[\s\S]*?<guid[^>]*>(.*?)<\/guid>/);
    const contentMatch = xml.match(
      /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/
    );

    if (!titleMatch || !guidMatch || !contentMatch) {
      return null;
    }

    const rawTitle = titleMatch[1].trim();
    const title = decodeHtmlEntities(rawTitle).toUpperCase();
    const rawLink = linkMatch ? linkMatch[1].trim() : "";
    const originalUrl = cleanUrl(decodeHtmlEntities(rawLink));
    const guid = guidMatch[1].trim();
    const pubDateStr = pubDateMatch ? pubDateMatch[1].trim() : null;
    const pubDate = pubDateStr ? new Date(pubDateStr) : null;
    const rawContent = contentMatch[1];

    return {
      title,
      link: originalUrl,
      pubDate,
      guid,
      rawContent,
    };
  } catch (err) {
    console.error(`[Page ${pageNumber}] Lỗi fetch:`, err);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 50;
  const isAll = args.includes("--all");
  const limitArgIndex = args.indexOf("--limit");
  if (limitArgIndex !== -1 && args[limitArgIndex + 1]) {
    limit = parseInt(args[limitArgIndex + 1], 10);
  }

  const maxPages = isAll ? 1300 : limit;
  console.log(`🚀 Bắt đầu cào Dave Trott Blog (Tối đa ${maxPages} bài)...`);

  let added = 0;
  let skipped = 0;
  let failed = 0;

  // Cào theo lô để vừa nhanh vừa không làm quá tải server
  const BATCH_SIZE = 10;

  for (let page = 1; page <= maxPages; page += BATCH_SIZE) {
    const pageNumbers: number[] = [];
    for (let i = 0; i < BATCH_SIZE && page + i <= maxPages; i++) {
      pageNumbers.push(page + i);
    }

    const items = await Promise.all(pageNumbers.map((p) => fetchPage(p)));

    let hitEnd = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const pageNum = pageNumbers[i];

      if (!item) {
        if (isAll) {
          hitEnd = true;
        }
        continue;
      }

      const originalLines = parseHtmlToLines(item.rawContent);
      if (originalLines.length === 0) {
        console.warn(`[Trang ${pageNum}] Bài rỗng, bỏ qua: ${item.title}`);
        skipped++;
        continue;
      }

      const wordCount = countWords(originalLines);
      let slug = slugifyTitle(item.title);
      if (!slug) slug = `dave-trott-${pageNum}`;

      try {
        // Kiểm tra xem đã tồn tại chưa
        const existing = await prisma.creativeArticle.findUnique({
          where: { guid: item.guid },
          select: { id: true, slug: true },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Đảm bảo slug không trùng với bài khác có title tương tự
        const existingSlug = await prisma.creativeArticle.findUnique({
          where: { slug },
          select: { id: true },
        });
        if (existingSlug) {
          slug = `${slug}-${pageNum}`;
        }

        await prisma.creativeArticle.create({
          data: {
            slug,
            guid: item.guid,
            originalUrl: item.link || `https://davetrott.co.uk/?p=${pageNum}`,
            originalTitle: item.title,
            originalPublishedAt: item.pubDate,
            originalLines: originalLines as unknown as object[],
            wordCount,
            status: "DRAFT",
          },
        });

        added++;
        console.log(
          `✅ [Trang ${pageNum}] Đã lưu: "${item.title}" (${originalLines.length} dòng, ${wordCount} từ)`
        );
      } catch (err) {
        console.error(`❌ [Trang ${pageNum}] Lỗi lưu DB:`, err);
        failed++;
      }
    }

    if (hitEnd) {
      console.log(`Đã đạt tới trang cuối cùng của blog tại trang ${page}.`);
      break;
    }

    // Nghỉ nhẹ 300ms giữa các batch
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n=================================");
  console.log(`🎉 HOÀN THÀNH CÀO BÀI!`);
  console.log(`- Thêm mới: ${added} bài`);
  console.log(`- Bỏ qua (đã có/rỗng): ${skipped} bài`);
  console.log(`- Thất bại: ${failed} bài`);
  console.log("=================================\n");
}

main()
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

