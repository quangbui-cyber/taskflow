import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookOpen, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { creativeEnabled } from "@/lib/features";
import { isTextLine, type ArticleLine } from "@/lib/creative";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import CreativeArchive, {
  type CreativeCardData,
} from "@/components/creative/CreativeArchive";

export const metadata: Metadata = {
  title: "Góc Đọc & Cảm Hứng · myCreative",
  description:
    "Kho lưu trữ những câu chuyện quảng cáo và tư duy sáng tạo của Dave Trott.",
};

export default async function CreativeArchivePage() {
  if (!creativeEnabled()) {
    notFound();
  }

  const user = await requireUser();

  const [articles, sidebarProjects] = await Promise.all([
    prisma.creativeArticle.findMany({
      where: {
        status: { in: ["PUBLISHED", "SCHEDULED"] },
        titleVi: { not: null },
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
    prisma.project.findMany({
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
    }),
  ]);

  const cardsData: CreativeCardData[] = articles.map((article) => {
    const lines = (article.linesVi as unknown as ArticleLine[]) || [];
    const textLines = lines.filter(isTextLine).map((l) => l.t.replace(/[*_]/g, ""));
    const excerpt = textLines.slice(0, 3).join(" ");

    const userReader = article.readers.find((r) => r.userId === user.id);
    const likeCount = article.readers.filter((r) => r.likedAt !== null).length;

    return {
      id: article.id,
      slug: article.slug,
      originalTitle: article.originalTitle,
      titleVi: article.titleVi,
      wordCount: article.wordCount,
      publishedDate: article.publishedDate?.toISOString() ?? null,
      tags: article.tags,
      excerpt,
      likeCount,
      isLiked: Boolean(userReader?.likedAt),
      isSaved: Boolean(userReader?.savedAt),
      isRead: Boolean(userReader?.readAt),
      status: article.status,
    };
  });

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="creative" />

      <main className="tf-main">
        <HubTabs section="creative" role={user.role} />

        <div className="tf-page space-y-6">
          <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700">
                <BookOpen size={20} aria-hidden="true" />
              </span>
              <div>
                <h1 className="tf-page-title">Góc Đọc & Cảm Hứng</h1>
                <p className="text-xs text-zinc-500">
                  Những câu chuyện ngắn gãy gọn, thấm thía từ huyền thoại Dave Trott.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 shadow-xs">
              <Sparkles size={13} className="text-brand-600" />
              <span>Phát hành mỗi sáng Thứ 2 - Thứ 6</span>
            </div>
          </header>

          <CreativeArchive articles={cardsData} />
        </div>
      </main>
    </div>
  );
}
