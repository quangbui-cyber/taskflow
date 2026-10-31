import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { creativeEnabled } from "@/lib/features";
import {
  describeCreativeDay,
  extractPullQuote,
  getArticleAuthor,
  isTextLine,
  toDisplayTitle,
  KNOWN_AUTHORS,
  type ArticleLine,
} from "@/lib/creative";
import { ensureInitialCreativeArticles } from "@/lib/creativeSeed";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import CreativeArchive, {
  type CreativeCardData,
} from "@/components/creative/CreativeArchive";

export const metadata: Metadata = {
  title: "Góc Đọc & Cảm Hứng · myCreative",
  description: "Những câu chuyện quảng cáo và tư duy sáng tạo từ các bậc thầy trong nghề.",
};

interface CreativeArchivePageProps {
  searchParams?: Promise<{ "tac-gia"?: string }>;
}

export default async function CreativeArchivePage({ searchParams }: CreativeArchivePageProps) {
  if (!creativeEnabled()) {
    notFound();
  }

  const user = await getCurrentUser();
  await ensureInitialCreativeArticles();

  const [articles, sidebarProjects] = await Promise.all([
    prisma.creativeArticle.findMany({
      where: {
        status: "PUBLISHED",
      },
      include: {
        readers: {
          select: {
            userId: true,
            likedAt: true,
            savedAt: true,
            readAt: true,
          },
        },
      },
      orderBy: [{ publishedDate: "desc" }, { createdAt: "desc" }],
    }),
    user
      ? prisma.project.findMany({
          where: { members: { some: { userId: user.id } } },
          select: {
            id: true,
            name: true,
            color: true,
            status: true,
            category: true,
            responsibleTeam: { select: { id: true, name: true } },
            responsibleGroup: { select: { id: true, name: true } },
            account: { select: { team: { select: { id: true, name: true } } } },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const now = new Date();
  const cardsData: CreativeCardData[] = articles.map((article) => {
    const linesVi = (article.linesVi as unknown as ArticleLine[]) || [];
    const origLines = (article.originalLines as unknown as ArticleLine[]) || [];
    const lines = linesVi.length > 0 ? linesVi : origLines;
    const textLines = lines.filter(isTextLine).map((l) => l.t.replace(/[*_]/g, ""));
    const excerpt = textLines.slice(0, 4).join(" ");
    const day = article.publishedDate ? describeCreativeDay(article.publishedDate, now) : null;

    const userReader = user ? article.readers.find((r) => r.userId === user.id) : null;
    const likeCount = article.readers.filter((r) => r.likedAt !== null).length;
    const author = getArticleAuthor(article.tags);

    return {
      id: article.id,
      slug: article.slug,
      originalTitle: article.originalTitle,
      titleVi: article.titleVi,
      displayTitle: toDisplayTitle(article.titleVi || article.originalTitle, article.titleVi ? "vi" : "en", article.originalTitle),
      displaySubtitle: article.titleVi ? toDisplayTitle(article.originalTitle, "en") : null,
      dateLabel: day?.label ?? "Sắp phát hành",
      groupKey: day?.groupKey ?? "upcoming",
      groupLabel: day?.groupLabel ?? "Sắp phát hành",
      pullQuote: extractPullQuote(lines),
      wordCount: article.wordCount,
      publishedDate: article.publishedDate?.toISOString() ?? null,
      tags: article.tags,
      authorSlug: author.slug,
      authorName: author.name,
      excerpt,
      likeCount,
      isLiked: Boolean(userReader?.likedAt),
      isSaved: Boolean(userReader?.savedAt),
      isRead: Boolean(userReader?.readAt),
      status: article.status,
    };
  });

  const sp = searchParams ? await searchParams : undefined;
  const rawAuthor = sp?.["tac-gia"];
  const initialAuthor =
    rawAuthor && (rawAuthor in KNOWN_AUTHORS || cardsData.some((c) => c.authorSlug === rawAuthor))
      ? rawAuthor
      : null;

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50/50">
        <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-base font-extrabold tracking-tight text-zinc-950">myCreative</span>
              <span className="text-zinc-300">/</span>
              <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
                Góc Đọc
              </span>
            </Link>
            <Link
              href="/login"
              className="rounded-[10px] bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-zinc-800"
            >
              Đăng nhập
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-[1120px] space-y-8 px-4 py-8 sm:px-6">
          <ArchiveHeader />

          <CreativeArchive articles={cardsData} personal={false} initialAuthor={initialAuthor} />
        </main>
      </div>
    );
  }

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="creative" />

      <main className="tf-main">
        <HubTabs section="creative" role={user.role} />

        <div className="tf-page">
          <div className="mx-auto max-w-[1120px] space-y-8">
            <ArchiveHeader
              readCount={cardsData.filter((a) => a.isRead).length}
              total={cardsData.length}
            />

            <CreativeArchive articles={cardsData} personal initialAuthor={initialAuthor} />
          </div>
        </div>
      </main>
    </div>
  );
}

function ArchiveHeader({ readCount, total }: { readCount?: number; total?: number }) {
  return (
    <header className="space-y-1">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="tf-page-title text-zinc-950">Góc Đọc & Cảm Hứng</h1>
        {typeof readCount === "number" && total ? (
          <p className="inline-flex items-center gap-2 text-[13px] text-zinc-600">
            <CheckCircle2 size={16} className="text-brand-600" aria-hidden="true" />
            Bạn đã đọc{" "}
            <strong className="font-semibold text-zinc-950">
              {readCount}/{total}
            </strong>{" "}
            bài
          </p>
        ) : null}
      </div>
      <p className="text-sm text-zinc-500">
        Mỗi sáng một câu chuyện về quảng cáo và tư duy sáng tạo, từ những bậc thầy trong nghề.
      </p>
    </header>
  );
}
