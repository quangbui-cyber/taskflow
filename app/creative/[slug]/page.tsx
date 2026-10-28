import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { creativeEnabled } from "@/lib/features";
import { type ArticleLine } from "@/lib/creative";
import ZenReader from "@/components/creative/ZenReader";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await prisma.creativeArticle.findUnique({
    where: { slug },
    select: { originalTitle: true, titleVi: true },
  });

  if (!article) return { title: "Không tìm thấy bài viết · myCreative" };

  return {
    title: `${article.titleVi || article.originalTitle} · Góc Đọc myCreative`,
    description: `Góc Đọc & Cảm Hứng Dave Trott: ${article.originalTitle}`,
  };
}

export default async function CreativeArticlePage({ params }: PageProps) {
  if (!creativeEnabled()) {
    notFound();
  }

  const user = await requireUser();
  const { slug } = await params;

  const article = await prisma.creativeArticle.findUnique({
    where: { slug },
  });

  if (!article) {
    notFound();
  }

  // Lấy trạng thái tương tác của người dùng hiện tại
  const readerRecord = await prisma.articleReader.findUnique({
    where: {
      userId_articleId: {
        userId: user.id,
        articleId: article.id,
      },
    },
  });

  // Tổng số lượt thích của bài
  const likeCount = await prisma.articleReader.count({
    where: {
      articleId: article.id,
      likedAt: { not: null },
    },
  });

  // Tìm bài trước và bài sau (đã phát hành hoặc được lên lịch)
  const [prevArticle, nextArticle] = await Promise.all([
    prisma.creativeArticle.findFirst({
      where: {
        createdAt: { lt: article.createdAt },
        titleVi: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { slug: true, originalTitle: true, titleVi: true },
    }),
    prisma.creativeArticle.findFirst({
      where: {
        createdAt: { gt: article.createdAt },
        titleVi: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: { slug: true, originalTitle: true, titleVi: true },
    }),
  ]);

  return (
    <ZenReader
      article={{
        id: article.id,
        slug: article.slug,
        originalTitle: article.originalTitle,
        originalUrl: article.originalUrl,
        originalPublishedAt: article.originalPublishedAt?.toISOString() ?? null,
        originalLines: article.originalLines as unknown as ArticleLine[],
        titleVi: article.titleVi,
        linesVi: article.linesVi as unknown as ArticleLine[] | null,
        tags: article.tags,
        wordCount: article.wordCount,
        publishedDate: article.publishedDate?.toISOString() ?? null,
      }}
      initialLiked={Boolean(readerRecord?.likedAt)}
      initialLikeCount={likeCount}
      initialSaved={Boolean(readerRecord?.savedAt)}
      initialRead={Boolean(readerRecord?.readAt)}
      prevArticle={prevArticle}
      nextArticle={nextArticle}
    />
  );
}
