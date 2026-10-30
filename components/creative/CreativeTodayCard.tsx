"use client";

import { useTransition, useState } from "react";
import Link from "next/link";
import { BookOpen, Bookmark, CheckCircle2, ChevronRight, Sparkles } from "lucide-react";
import { creativeHeading } from "@/app/fonts";
import { estimateReadingMinutes, formatCreativeDate } from "@/lib/creative";
import { toggleSaveArticle } from "@/app/actions/creative";

interface CreativeTodayCardProps {
  article: {
    id: string;
    slug: string;
    originalTitle: string;
    titleVi: string | null;
    wordCount: number;
    publishedDate: string | null;
    excerpt: string;
    isSaved: boolean;
    isRead: boolean;
  };
  isWeekend?: boolean;
}

export default function CreativeTodayCard({
  article,
  isWeekend = false,
}: CreativeTodayCardProps) {
  const [saved, setSaved] = useState(article.isSaved);
  const [, startTransition] = useTransition();

  const minutes = estimateReadingMinutes(article.wordCount);
  const dateFormatted = article.publishedDate
    ? formatCreativeDate(new Date(article.publishedDate))
    : null;

  const badgeLabel = article.isRead
    ? "Góc đọc & Cảm hứng"
    : isWeekend
      ? "Bài đọc cuối tuần"
      : "Bài đọc tiếp theo";

  const handleToggleSave = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      try {
        const res = await toggleSaveArticle(article.id);
        setSaved(res.saved);
      } catch {
        setSaved(!next);
      }
    });
  };

  return (
    <section
      aria-label="Không gian đọc và cảm hứng"
      className="tf-rise relative overflow-hidden rounded-[18px] border border-zinc-200 bg-white p-5 shadow-xs transition-all duration-200 hover:border-brand-300 hover:shadow-sm"
      style={{ "--tf-delay": "160ms" } as React.CSSProperties}
    >
      {/* Vệt trang trí gradient brand dịu mắt */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-36 w-36 rounded-full bg-brand-100/50 blur-2xl"
        aria-hidden="true"
      />

      {/* Header của thẻ */}
      <div className="relative flex items-center justify-between gap-2 border-b border-zinc-100 pb-3">
        <Link
          href="/creative"
          className="group flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-brand-100 text-brand-800">
            <BookOpen size={14} aria-hidden="true" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 group-hover:text-brand-800">
            {badgeLabel}
          </span>
        </Link>

        <div className="flex items-center gap-2 text-[11px] text-zinc-600">
          {dateFormatted && <span className="font-medium text-zinc-700">{dateFormatted}</span>}
          <span>•</span>
          <span>{minutes} phút đọc</span>

          <button
            type="button"
            onClick={handleToggleSave}
            title={saved ? "Bỏ lưu bài" : "Lưu vào danh sách đọc"}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              saved
                ? "bg-brand-100 text-brand-800"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            <Bookmark size={14} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
      </div>

      {/* Nội dung chính */}
      <div className="relative mt-4">
        <Link href={`/creative/${article.slug}`} prefetch={false} className="group block">
          {/* Tiêu đề tiếng Anh gốc IN HOA */}
          <h2
            className={`${creativeHeading.className} text-lg sm:text-xl font-extrabold tracking-tight text-zinc-950 leading-snug group-hover:text-brand-800 transition-colors`}
          >
            {article.originalTitle}
          </h2>

          {/* Phụ đề tiếng Việt IN HOA */}
          {article.titleVi && (
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-brand-800 line-clamp-1">
              {article.titleVi}
            </p>
          )}

          {/* Trích dẫn mở đầu lôi cuốn */}
          <p className="mt-2.5 text-xs leading-relaxed text-zinc-700 line-clamp-3">
            {article.excerpt}
          </p>
        </Link>
      </div>

      {/* Footer hành động */}
      <div className="relative mt-5 flex items-center justify-between pt-3 border-t border-zinc-100">
        <div className="flex items-center gap-2">
          {article.isRead ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-medium text-brand-800">
              <CheckCircle2 size={12} />
              Đã đọc
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-600">
              <Sparkles size={12} className="text-brand-600" />
              Đọc để nạp năng lượng sáng tạo
            </span>
          )}
        </div>

        <Link
          href={`/creative/${article.slug}`}
          prefetch={false}
          className="inline-flex items-center gap-1 rounded-[10px] bg-brand-400 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:bg-brand-500"
        >
          <span>Khám phá</span>
          <ChevronRight size={14} />
        </Link>
      </div>
    </section>
  );
}

