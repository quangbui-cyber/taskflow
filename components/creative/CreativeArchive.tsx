"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Bookmark, BookOpen, Check, Heart, Search } from "lucide-react";
import { creativeHeading, serifBody } from "@/app/fonts";
import { estimateReadingMinutes } from "@/lib/creative";
import { toggleSaveArticle } from "@/app/actions/creative";

export interface CreativeCardData {
  id: string;
  slug: string;
  originalTitle: string;
  titleVi: string | null;
  /** Tựa chính đã chuyển sang kiểu câu (ưu tiên tiếng Việt) */
  displayTitle: string;
  /** Tựa tiếng Anh gốc kiểu câu, hiện nhỏ bên dưới */
  displaySubtitle: string | null;
  /** "Hôm qua", "3 ngày trước", "25/10"… */
  dateLabel: string;
  groupKey: string;
  groupLabel: string;
  pullQuote: string | null;
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
  /** Người xem đã đăng nhập: hiện trạng thái đã đọc / đã lưu */
  personal: boolean;
}

type FilterTab = "all" | "saved" | "read";

const PAGE_SIZE = 12;

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}

export default function CreativeArchive({ articles, personal }: CreativeArchiveProps) {
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Trạng thái lưu thay đổi ngay trên trang (lạc quan) trước khi máy chủ xác nhận
  const [savedOverrides, setSavedOverrides] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  const isSaved = (a: CreativeCardData) => savedOverrides[a.id] ?? a.isSaved;
  const savedCount = articles.filter(isSaved).length;
  const readCount = articles.filter((a) => a.isRead).length;

  const query = normalize(searchQuery.trim());
  const isBrowsing = filterTab === "all" && !query;

  const filtered = useMemo(() => {
    return articles.filter((a) => {
      if (filterTab === "saved" && !(savedOverrides[a.id] ?? a.isSaved)) return false;
      if (filterTab === "read" && !a.isRead) return false;
      if (!query) return true;
      const haystack = normalize(
        [a.displayTitle, a.originalTitle, a.titleVi ?? "", a.excerpt, a.tags.join(" ")].join(" ")
      );
      return haystack.includes(query);
    });
  }, [articles, filterTab, query, savedOverrides]);

  const featured = isBrowsing ? filtered[0] : undefined;
  const rest = isBrowsing ? filtered.slice(1, 1 + visibleCount) : filtered;
  const hiddenCount = isBrowsing ? Math.max(0, filtered.length - 1 - visibleCount) : 0;

  // Gom bài theo nhóm thời gian khi đang xem tất cả; khi lọc/tìm thì hiện một danh sách
  const sections = (() => {
    if (!isBrowsing) {
      if (rest.length === 0) return [];
      const label = query
        ? `Kết quả cho “${searchQuery.trim()}”`
        : filterTab === "read"
        ? "Bài bạn đã đọc"
        : "Bài đã lưu";
      return [{ key: "results", label, items: rest }];
    }
    const groups: { key: string; label: string; items: CreativeCardData[] }[] = [];
    for (const a of rest) {
      const last = groups[groups.length - 1];
      if (last && last.key === a.groupKey) last.items.push(a);
      else groups.push({ key: a.groupKey, label: a.groupLabel, items: [a] });
    }
    return groups;
  })();

  const handleToggleSave = (article: CreativeCardData) => {
    const next = !isSaved(article);
    setSavedOverrides((prev) => ({ ...prev, [article.id]: next }));
    startTransition(async () => {
      try {
        const res = await toggleSaveArticle(article.id);
        setSavedOverrides((prev) => ({ ...prev, [article.id]: res.requireLogin ? !next : res.saved }));
      } catch {
        setSavedOverrides((prev) => ({ ...prev, [article.id]: !next }));
      }
    });
  };

  const changeTab = (tab: FilterTab) => {
    setFilterTab(tab);
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <div className="space-y-8">
      {featured && (
        <FeaturedArticle
          article={featured}
          personal={personal}
          saved={isSaved(featured)}
          onToggleSave={() => handleToggleSave(featured)}
        />
      )}

      {/* Bộ lọc và tìm kiếm */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {personal ? (
          <div
            role="tablist"
            aria-label="Lọc bài viết"
            className="grid grid-cols-3 gap-0.5 rounded-[12px] bg-zinc-200/60 p-1 sm:inline-grid"
          >
            <FilterButton active={filterTab === "all"} onClick={() => changeTab("all")}>
              Tất cả <span className="font-medium text-zinc-500">{articles.length}</span>
            </FilterButton>
            <FilterButton active={filterTab === "saved"} onClick={() => changeTab("saved")}>
              Đã lưu {savedCount > 0 && <span className="font-medium text-zinc-500">{savedCount}</span>}
            </FilterButton>
            <FilterButton active={filterTab === "read"} onClick={() => changeTab("read")}>
              Đã đọc {readCount > 0 && <span className="font-medium text-zinc-500">{readCount}</span>}
            </FilterButton>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{articles.length} bài viết</p>
        )}

        <div className="relative sm:w-80">
          <label htmlFor="creative-search" className="sr-only">
            Tìm bài viết
          </label>
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            id="creative-search"
            type="search"
            placeholder="Tìm theo tựa đề, nội dung…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            className="h-11 w-full rounded-[10px] border border-zinc-200 bg-white pl-10 pr-3.5 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>

      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`group-${section.key}`} className="space-y-4">
          <h2 id={`group-${section.key}`} className="text-[13px] font-semibold tracking-wide text-zinc-500">
            {section.label}
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {section.items.map((article) => (
              <ArticleCard key={article.id} article={article} personal={personal} saved={isSaved(article)} />
            ))}
          </div>
        </section>
      ))}

      {!featured && sections.length === 0 && (
        <div className="flex flex-col items-center gap-2.5 rounded-[18px] border border-zinc-200 bg-white px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-brand-50 text-brand-700">
            {filterTab === "saved" && !query ? <Bookmark size={22} /> : <BookOpen size={22} />}
          </span>
          <h2 className="text-base font-semibold text-zinc-950">
            {query
              ? "Không tìm thấy bài phù hợp"
              : filterTab === "saved"
              ? "Bạn chưa lưu bài nào"
              : filterTab === "read"
              ? "Bạn chưa đọc bài nào"
              : "Chưa có bài viết nào"}
          </h2>
          <p className="max-w-sm text-sm leading-relaxed text-zinc-500">
            {query
              ? "Thử tìm bằng từ khóa khác nhé."
              : filterTab === "saved"
              ? "Khi đọc thấy bài hay, bấm “Lưu để đọc sau” để giữ lại ở đây."
              : "Các bài đọc mới được phát hành mỗi sáng các ngày trong tuần."}
          </p>
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
            className="h-11 rounded-[10px] border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 shadow-sm transition-[transform,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-zinc-300 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            Xem thêm {Math.min(hiddenCount, PAGE_SIZE)} bài cũ hơn
          </button>
        </div>
      )}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] px-3.5 text-sm transition-colors duration-150 ease-out motion-reduce:transition-none ${
        active
          ? "bg-brand-100 font-semibold text-brand-900 shadow-xs"
          : "font-medium text-zinc-600 hover:text-zinc-950"
      }`}
    >
      {children}
    </button>
  );
}

function FeaturedArticle({
  article,
  personal,
  saved,
  onToggleSave,
}: {
  article: CreativeCardData;
  personal: boolean;
  saved: boolean;
  onToggleSave: () => void;
}) {
  const minutes = estimateReadingMinutes(article.wordCount);
  const href = `/creative/${article.slug}`;

  return (
    <article
      aria-labelledby="creative-featured-title"
      className="flex flex-wrap gap-8 rounded-[18px] border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="min-w-0 flex-[999_1_420px] space-y-4">
        <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-zinc-500">
          <span className="rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-900">
            Bài mới nhất
          </span>
          <span>
            {article.dateLabel} · {minutes} phút đọc
          </span>
          {personal && article.isRead && (
            <span className="inline-flex items-center gap-1">
              <Check size={14} aria-hidden="true" />
              Đã đọc
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <h2
            id="creative-featured-title"
            className={`${creativeHeading.className} text-2xl font-bold leading-tight text-zinc-950 sm:text-[32px]`}
          >
            <Link href={href} prefetch={false} className="transition-colors duration-150 hover:text-brand-800">
              {article.displayTitle}
            </Link>
          </h2>
          {article.displaySubtitle && <p className="text-sm text-zinc-500">{article.displaySubtitle}</p>}
        </div>

        <p className={`${serifBody.className} line-clamp-4 text-base leading-[1.7] text-zinc-700 sm:line-clamp-3 sm:text-[17px]`}>
          {article.excerpt}
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={href}
            prefetch={false}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-brand-400 px-5 text-sm font-semibold text-zinc-950 shadow-sm transition-[transform,background-color] duration-150 ease-out hover:-translate-y-0.5 hover:bg-brand-500 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            {personal && article.isRead ? "Đọc lại" : "Đọc ngay"}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          {personal && (
            <button
              type="button"
              aria-pressed={saved}
              onClick={onToggleSave}
              className={`inline-flex h-11 items-center gap-2 rounded-[10px] border px-4 text-sm font-medium transition-[transform,background-color,border-color] duration-150 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
                saved
                  ? "border-brand-200 bg-brand-50 text-brand-900"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
              }`}
            >
              <Bookmark size={16} aria-hidden="true" fill={saved ? "currentColor" : "none"} />
              {saved ? "Đã lưu" : "Lưu để đọc sau"}
            </button>
          )}
        </div>
      </div>

      {article.pullQuote && (
        <figure className="hidden flex-[1_1_260px] flex-col sm:flex justify-center gap-3.5 rounded-[14px] bg-brand-50 p-7">
          <svg aria-hidden="true" width="32" height="32" viewBox="0 0 24 24" className="fill-brand-300">
            <path d="M4 18v-5.5C4 8.4 6.2 6 10 5.5v2.6C8 8.6 7.2 9.8 7.1 12H10v6zm10 0v-5.5c0-4.1 2.2-6.5 6-7v2.6c-2 .5-2.8 1.7-2.9 3.9H20v6z" />
          </svg>
          <blockquote className={`${serifBody.className} text-xl italic leading-normal text-brand-900`}>
            {article.pullQuote}
          </blockquote>
        </figure>
      )}
    </article>
  );
}

function ArticleCard({
  article,
  personal,
  saved,
}: {
  article: CreativeCardData;
  personal: boolean;
  saved: boolean;
}) {
  const minutes = estimateReadingMinutes(article.wordCount);
  const muted = personal && article.isRead;

  return (
    <Link
      href={`/creative/${article.slug}`}
      prefetch={false}
      className="group flex flex-col gap-3 rounded-[16px] border border-zinc-200 bg-white p-5 shadow-sm transition-[transform,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:border-brand-300 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>
          {article.dateLabel} · {minutes} phút đọc
        </span>
        <span className="flex items-center gap-2">
          {saved && (
            <Bookmark size={14} className="text-brand-700" fill="currentColor" aria-label="Đã lưu" />
          )}
          {personal &&
            (article.isRead ? (
              <span className="inline-flex items-center gap-1">
                <Check size={14} aria-hidden="true" />
                Đã đọc
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-800">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                Chưa đọc
              </span>
            ))}
        </span>
      </div>

      <div className="space-y-1">
        <h3
          className={`${creativeHeading.className} line-clamp-2 text-[17px] font-semibold leading-snug transition-colors duration-150 group-hover:text-brand-800 ${
            muted ? "text-zinc-600" : "text-zinc-950"
          }`}
        >
          {article.displayTitle}
        </h3>
        {article.displaySubtitle && <p className="truncate text-[13px] text-zinc-500">{article.displaySubtitle}</p>}
      </div>

      <p className="line-clamp-3 text-sm leading-relaxed text-zinc-600">{article.excerpt}</p>

      {article.likeCount > 0 && (
        <p className="mt-auto flex items-center gap-1 pt-1 text-xs text-zinc-500">
          <Heart
            size={13}
            aria-hidden="true"
            className={article.isLiked ? "text-red-500" : ""}
            fill={article.isLiked ? "currentColor" : "none"}
          />
          {article.likeCount} lượt thích
        </p>
      )}
    </Link>
  );
}
