"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Bookmark,
  CheckCircle2,
  Heart,
  Search,
} from "lucide-react";
import { serifHeading } from "@/app/fonts";
import {
  estimateReadingMinutes,
  formatCreativeDate,
} from "@/lib/creative";

export interface CreativeCardData {
  id: string;
  slug: string;
  originalTitle: string;
  titleVi: string | null;
  wordCount: number;
  publishedDate: string | null;
  tags: string[];
  excerpt: string;
  likeCount: number;
  isLiked: boolean;
  isSaved: boolean;
  isRead: boolean;
  status: string;
}

interface CreativeArchiveProps {
  articles: CreativeCardData[];
}

export default function CreativeArchive({ articles }: CreativeArchiveProps) {
  const [filterTab, setFilterTab] = useState<"all" | "saved" | "read">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredArticles = useMemo(() => {
    let list = articles;

    // Lọc theo tab
    if (filterTab === "saved") {
      list = list.filter((a) => a.isSaved);
    } else if (filterTab === "read") {
      list = list.filter((a) => a.isRead);
    }

    // Lọc theo tìm kiếm
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (a) =>
          a.originalTitle.toLowerCase().includes(q) ||
          (a.titleVi && a.titleVi.toLowerCase().includes(q)) ||
          a.excerpt.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    return list;
  }, [articles, filterTab, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Bộ lọc và Tìm kiếm */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-[10px] border border-zinc-200 bg-white p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setFilterTab("all")}
            className={`rounded-[7px] px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              filterTab === "all"
                ? "bg-zinc-950 text-white shadow-xs"
                : "text-zinc-600 hover:text-zinc-950"
            }`}
          >
            Tất cả bài viết ({articles.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("saved")}
            className={`inline-flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              filterTab === "saved"
                ? "bg-zinc-950 text-white shadow-xs"
                : "text-zinc-600 hover:text-zinc-950"
            }`}
          >
            <Bookmark size={13} />
            <span>Đã lưu ({articles.filter((a) => a.isSaved).length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("read")}
            className={`inline-flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              filterTab === "read"
                ? "bg-zinc-950 text-white shadow-xs"
                : "text-zinc-600 hover:text-zinc-950"
            }`}
          >
            <CheckCircle2 size={13} />
            <span>Đã đọc ({articles.filter((a) => a.isRead).length})</span>
          </button>
        </div>

        {/* Ô tìm kiếm nhanh */}
        <div className="relative min-w-[240px] sm:w-72">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            type="text"
            placeholder="Tìm theo tựa đề, chủ đề..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-[10px] border border-zinc-200 bg-white py-1.5 pl-9 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 shadow-xs"
          />
        </div>
      </div>

      {/* Lưới danh sách bài viết */}
      {filteredArticles.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredArticles.map((article) => {
            const minutes = estimateReadingMinutes(article.wordCount);
            const dateStr = article.publishedDate
              ? formatCreativeDate(new Date(article.publishedDate))
              : null;

            return (
              <Link
                key={article.id}
                href={`/creative/${article.slug}`}
                prefetch={false}
                className="group flex flex-col justify-between rounded-[16px] border border-zinc-200 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-sm"
              >
                <div>
                  {/* Chip thông tin ngày & thời gian đọc */}
                  <div className="flex items-center justify-between text-[11px] text-zinc-600">
                    <span className="font-medium text-zinc-700">
                      {dateStr || "Sắp phát hành"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span>{minutes} phút đọc</span>
                      {article.isSaved && (
                        <Bookmark size={12} className="text-brand-700" fill="currentColor" />
                      )}
                    </span>
                  </div>

                  {/* Tiêu đề tiếng Anh gốc IN HOA */}
                  <h2
                    className={`${serifHeading.className} mt-3 text-lg font-bold leading-snug tracking-tight text-zinc-950 italic group-hover:text-brand-900`}
                  >
                    {article.originalTitle}
                  </h2>

                  {/* Phụ đề tiếng Việt IN HOA */}
                  {article.titleVi && (
                    <p className="mt-1.5 text-xs font-semibold uppercase tracking-wider text-brand-800 line-clamp-1">
                      {article.titleVi}
                    </p>
                  )}

                  {/* Đoạn trích mở đầu */}
                  <p className="mt-3 text-xs leading-relaxed text-zinc-700 line-clamp-3">
                    {article.excerpt}
                  </p>
                </div>

                {/* Chân thẻ */}
                <div className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-3 text-xs">
                  <div className="flex items-center gap-3 text-zinc-600">
                    <span className="flex items-center gap-1">
                      <Heart
                        size={13}
                        className={article.isLiked ? "text-red-500" : ""}
                        fill={article.isLiked ? "currentColor" : "none"}
                      />
                      <span>{article.likeCount}</span>
                    </span>

                    {article.isRead && (
                      <span className="flex items-center gap-1 text-brand-800 font-medium">
                        <CheckCircle2 size={13} />
                        <span>Đã đọc</span>
                      </span>
                    )}
                  </div>

                  <span className="font-semibold text-brand-700 group-hover:translate-x-0.5 transition-transform duration-150">
                    Đọc bài →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-zinc-200 bg-white py-16 text-center">
          <BookOpen size={36} className="text-zinc-300" />
          <h3 className="mt-3 text-sm font-semibold text-zinc-800">
            {searchQuery ? "Không tìm thấy bài viết phù hợp" : "Chưa có bài viết nào trong mục này"}
          </h3>
          <p className="mt-1 text-xs text-zinc-600">
            {searchQuery
              ? "Hãy thử tìm bằng từ khóa khác hoặc quay lại danh sách tất cả."
              : "Các bài đọc mới sẽ được phát hành đều đặn mỗi sáng các ngày trong tuần."}
          </p>
        </div>
      )}
    </div>
  );
}

