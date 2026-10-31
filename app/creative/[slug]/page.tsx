import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { creativeEnabled } from "@/lib/features";
import { getArticleAuthor, toDisplayTitle, type ArticleLine } from "@/lib/creative";
import ZenReader from "@/components/creative/ZenReader";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await prisma.creativeArticle.findUnique({
    where: { slug },
    select: { originalTitle: true, titleVi: true, tags: true },
  });

  if (!article) return { title: "Không tìm thấy bài viết · myCreative" };

  const author = getArticleAuthor(article.tags);

  return {
    title: `${article.titleVi || article.originalTitle} · Góc Đọc myCreative`,
    description: `Góc Đọc & Cảm Hứng · ${author.name}: ${article.originalTitle}`,
  };
}

export default async function CreativeArticlePage({ params }: PageProps) {
  if (!creativeEnabled()) {
    notFound();
  }

  const user = await getCurrentUser();
  const { slug } = await params;

  const article = await prisma.creativeArticle.findUnique({
    where: { slug },
  });

  if (!article) {
    notFound();
  }

  // Lấy trạng thái tương tác của người dùng hiện tại nếu đã đăng nhập
  const readerRecord = user
    ? await prisma.articleReader.findUnique({
        where: {
          userId_articleId: {
            userId: user.id,
            articleId: article.id,
          },
        },
      })
    : null;

  // Tổng số lượt thích của bài
  const likeCount = await prisma.articleReader.count({
    where: {
      articleId: article.id,
      likedAt: { not: null },
    },
  });

  // Tìm bài trước và bài sau xếp theo ngày phát hành (chỉ lấy bài đã phát hành tới hiện tại)
  const now = new Date();
  const currentPubDate = article.publishedDate;

  const [prevRecord, nextRecord] = await Promise.all([
    prisma.creativeArticle.findFirst({
      where: {
        status: "PUBLISHED",
        publishedDate: { lte: now },
        OR: currentPubDate
          ? [
              { publishedDate: { lt: currentPubDate } },
              { publishedDate: currentPubDate, createdAt: { lt: article.createdAt } },
            ]
          : [{ createdAt: { lt: article.createdAt } }],
      },
      orderBy: [{ publishedDate: "desc" }, { createdAt: "desc" }],
      select: { slug: true, originalTitle: true, titleVi: true, tags: true },
    }),
    prisma.creativeArticle.findFirst({
      where: {
        status: "PUBLISHED",
        publishedDate: { lte: now },
        OR: currentPubDate
          ? [
              { publishedDate: { gt: currentPubDate } },
              { publishedDate: currentPubDate, createdAt: { gt: article.createdAt } },
            ]
          : [{ createdAt: { gt: article.createdAt } }],
      },
      orderBy: [{ publishedDate: "asc" }, { createdAt: "asc" }],
      select: { slug: true, originalTitle: true, titleVi: true, tags: true },
    }),
  ]);

  const prevArticle = prevRecord
    ? {
        slug: prevRecord.slug,
        displayTitle: toDisplayTitle(
          prevRecord.titleVi || prevRecord.originalTitle,
          prevRecord.titleVi ? "vi" : "en",
          prevRecord.originalTitle
        ),
        authorName: getArticleAuthor(prevRecord.tags).name,
      }
    : null;

  const nextArticle = nextRecord
    ? {
        slug: nextRecord.slug,
        displayTitle: toDisplayTitle(
          nextRecord.titleVi || nextRecord.originalTitle,
          nextRecord.titleVi ? "vi" : "en",
          nextRecord.originalTitle
        ),
        authorName: getArticleAuthor(nextRecord.tags).name,
      }
    : null;

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
