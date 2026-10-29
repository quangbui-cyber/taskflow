import { prisma } from "@/lib/prisma";
import seedArticles from "./creativeSeedData.json";

interface SeedArticle {
  slug: string;
  guid: string;
  originalUrl: string;
  originalTitle: string;
  originalPublishedAt?: string | null;
  originalLines: unknown[];
  wordCount: number;
  titleVi: string | null;
  linesVi: unknown[] | null;
  tags: string[];
  status: string;
  publishedDate?: string | null;
}

/**
 * Đảm bảo database luôn có sẵn đủ 50 bài viết Dave Trott ở trạng thái PUBLISHED
 * Tự động chạy trên mọi môi trường (local dev, staging, Vercel production).
 */
export async function ensureInitialCreativeArticles() {
  const publishedCount = await prisma.creativeArticle.count({
    where: { status: "PUBLISHED" },
  });

  // Nếu đã đủ 50 bài PUBLISHED thì không cần chạy lại
  if (publishedCount >= (seedArticles as SeedArticle[]).length) return;

  const typedSeed = seedArticles as SeedArticle[];

  for (let i = 0; i < typedSeed.length; i++) {
    const item = typedSeed[i];
    const pubDate = item.publishedDate
      ? new Date(item.publishedDate)
      : new Date(Date.now() - (typedSeed.length - i) * 86400000);

    await prisma.creativeArticle.upsert({
      where: { slug: item.slug },
      update: {
        status: "PUBLISHED",
        titleVi: item.titleVi,
        tags: item.tags,
        publishedDate: pubDate,
      },
      create: {
        slug: item.slug,
        guid: item.guid,
        originalUrl: item.originalUrl,
        originalTitle: item.originalTitle,
        originalPublishedAt: item.originalPublishedAt
          ? new Date(item.originalPublishedAt)
          : null,
        originalLines: item.originalLines as unknown as object[],
        wordCount: item.wordCount,
        titleVi: item.titleVi,
        linesVi: item.linesVi ? (item.linesVi as unknown as object[]) : undefined,
        tags: item.tags,
        status: "PUBLISHED",
        publishedDate: pubDate,
      },
    });
  }
}

