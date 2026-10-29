"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Heart,
  Share2,
} from "lucide-react";
import { creativeHeading, serifBody } from "@/app/fonts";
import {
  type ArticleLine,
  estimateReadingMinutes,
  formatCreativeDate,
  isGapLine,
} from "@/lib/creative";
import {
  markArticleAsRead,
  toggleLikeArticle,
  toggleSaveArticle,
} from "@/app/actions/creative";

interface ZenReaderProps {
  article: {
    id: string;
    slug: string;
    originalTitle: string;
    originalUrl: string;
    originalPublishedAt: string | null;
    originalLines: ArticleLine[];
    titleVi: string | null;
    linesVi: ArticleLine[] | null;
    tags: string[];
    wordCount: number;
    publishedDate: string | null;
  };
  initialLiked: boolean;
  initialLikeCount: number;
  initialSaved: boolean;
  initialRead: boolean;
  prevArticle?: { slug: string; originalTitle: string; titleVi: string | null } | null;
  nextArticle?: { slug: string; originalTitle: string; titleVi: string | null } | null;
}

/**
 * Phân tích dòng chữ có chứa định dạng **in đậm** hoặc *in nghiêng* thành React nodes
 */
function FormattedLine({ text, className = "" }: { text: string; className?: string }) {
  const parts: (string | { type: "bold" | "italic"; content: string })[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push({ type: "bold", content: token.slice(2, -2) });
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push({ type: "italic", content: token.slice(1, -1) });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <span className={className}>
      {parts.map((p, idx) => {
        if (typeof p === "string") return p;
        if (p.type === "bold") {
          return (
            <strong key={idx} className="font-bold text-zinc-950">
              {p.content}
            </strong>
          );
        }
        return (
          <em key={idx} className="italic">
            {p.content}
          </em>
        );
      })}
    </span>
  );
}

type Mode = "vi" | "en";

export default function ZenReader({
  article,
  initialLiked,
  initialLikeCount,
  initialSaved,
  initialRead,
  prevArticle,
  nextArticle,
}: ZenReaderProps) {
  const [mode, setMode] = useState<Mode>("vi");
  const [scrollProgress, setScrollProgress] = useState(0);
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [saved, setSaved] = useState(initialSaved);
  const [hasCopied, setHasCopied] = useState(false);
  const [, startTransition] = useTransition();

  const footerRef = useRef<HTMLDivElement>(null);
  const hasMarkedRead = useRef(initialRead);

  // Tự động đánh dấu đã xem/đã đọc khi mở bài
  useEffect(() => {
    if (hasMarkedRead.current) return;
    hasMarkedRead.current = true;
    markArticleAsRead(article.id).catch(() => {});
  }, [article.id]);

  // Thanh cuộn trang
  useEffect(() => {
    function handleScroll() {
      const totalScroll =
        document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (totalScroll <= 0) return;
      const currentScroll = window.scrollY;
      setScrollProgress(Math.min(100, Math.max(0, (currentScroll / totalScroll) * 100)));
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleToggleLike = () => {
    const nextState = !liked;
    setLiked(nextState);
    setLikeCount((prev) => (nextState ? prev + 1 : Math.max(0, prev - 1)));
    startTransition(async () => {
      try {
        const res = await toggleLikeArticle(article.id);
        if (res.requireLogin) {
          setLiked(!nextState);
          setLikeCount((prev) => (nextState ? Math.max(0, prev - 1) : prev + 1));
          return;
        }
        setLiked(res.liked);
        setLikeCount(res.likeCount);
      } catch {
        setLiked(!nextState);
        setLikeCount((prev) => (nextState ? Math.max(0, prev - 1) : prev + 1));
      }
    });
  };

  const handleToggleSave = () => {
    const nextState = !saved;
    setSaved(nextState);
    startTransition(async () => {
      try {
        const res = await toggleSaveArticle(article.id);
        if (res.requireLogin) {
          setSaved(!nextState);
          return;
        }
        setSaved(res.saved);
      } catch {
        setSaved(!nextState);
      }
    });
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    } catch {}
  };

  const readingMinutes = estimateReadingMinutes(article.wordCount);
  const origLines = article.originalLines || [];
  const linesVi = article.linesVi && article.linesVi.length > 0 ? article.linesVi : null;
  const activeLines = mode === "en" ? origLines : (linesVi || origLines);
  const displayTitleVi = article.titleVi || article.originalTitle;
  const dateFormatted = article.publishedDate
    ? formatCreativeDate(new Date(article.publishedDate))
    : null;

  return (
    <div className="min-h-screen bg-[#faf9f6] text-zinc-800 antialiased selection:bg-brand-200 selection:text-zinc-950">
      {/* Thanh tiến độ đọc mảnh cố định ở đầu trang */}
      <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-zinc-200/60">
        <div
          className="h-full bg-brand-500 transition-all duration-150 ease-out"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      {/* Header điều hướng */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-[#faf9f6]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/creative"
            className="group flex items-center gap-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:text-zinc-950"
          >
            <ArrowLeft
              size={15}
              className="transition-transform duration-200 group-hover:-translate-x-0.5"
            />
            <span>Góc Đọc & Cảm Hứng</span>
          </Link>

          {/* Công tắc chọn ngôn ngữ đọc Tiếng Việt / English */}
          <div className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5 shadow-xs">
            <button
              type="button"
              onClick={() => setMode("vi")}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-all duration-150 ${
                mode === "vi"
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              Tiếng Việt
            </button>
            <button
              type="button"
              onClick={() => setMode("en")}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-all duration-150 ${
                mode === "en"
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "text-zinc-600 hover:text-zinc-900"
              }`}
            >
              English
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-600 shadow-xs transition-colors hover:border-zinc-300 hover:text-zinc-950"
          >
            {hasCopied ? (
              <>
                <Check size={13} className="text-brand-700" />
                <span className="text-brand-800">Đã chép link</span>
              </>
            ) : (
              <>
                <Share2 size={13} />
                <span>Chia sẻ</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Khu vực nội dung bài đọc */}
      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 lg:max-w-4xl lg:py-16">
        {/* Meta thông tin bài */}
        <div className="mb-10 text-center">
          <div className="mb-3.5 flex flex-wrap items-center justify-center gap-2 text-xs text-zinc-500">
            {dateFormatted && <span>{dateFormatted}</span>}
            <span>•</span>
            <span>{readingMinutes} phút đọc</span>
            <span>•</span>
            <span>Dave Trott</span>
          </div>

          {/* Tiêu đề tiếng Anh gốc IN HOA */}
          <h1
            className={`${creativeHeading.className} text-2xl font-extrabold tracking-tight text-zinc-950 sm:text-3xl md:text-4xl`}
          >
            {article.originalTitle}
          </h1>

          {/* Phụ đề tiếng Việt IN HOA */}
          {article.titleVi && mode !== "en" && (
            <p className="mt-3 text-sm font-semibold uppercase tracking-wider text-brand-800 sm:text-base">
              {displayTitleVi}
            </p>
          )}

          <div className="mt-8 mx-auto h-[1px] w-20 bg-zinc-300" />
        </div>

        {/* Nội dung dòng chữ */}
        <article
          className={`${serifBody.className} text-[19px] sm:text-[20px] leading-[1.75] text-zinc-800`}
        >
          <div className="space-y-4">
            {activeLines.map((line, idx) => {
              if (isGapLine(line)) {
                return <div key={idx} className="h-6" aria-hidden="true" />;
              }
              return (
                <div key={idx} className="transition-colors hover:text-zinc-950">
                  <FormattedLine text={line.t} />
                </div>
              );
            })}
          </div>
        </article>

        {/* Chân trang tương tác & Bản quyền */}
        <footer ref={footerRef} className="mt-16 pt-8 border-t border-zinc-200/80">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {/* Nút Thả tim */}
              <button
                type="button"
                onClick={handleToggleLike}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 ${
                  liked
                    ? "border-red-300 bg-red-50 text-red-600 shadow-xs"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
                }`}
              >
                <Heart size={15} fill={liked ? "currentColor" : "none"} />
                <span>{likeCount > 0 ? likeCount : "Thích"}</span>
              </button>

              {/* Nút Lưu bài */}
              <button
                type="button"
                onClick={handleToggleSave}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 ${
                  saved
                    ? "border-brand-300 bg-brand-50 text-brand-800 shadow-xs"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
                }`}
              >
                <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
                <span>{saved ? "Đã lưu" : "Lưu bài"}</span>
              </button>

              {/* Nút Chia sẻ / Sao chép liên kết */}
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-600 transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:text-zinc-900"
              >
                {hasCopied ? (
                  <>
                    <Check size={14} className="text-green-600" />
                    <span className="text-green-600">Đã chép link</span>
                  </>
                ) : (
                  <>
                    <Share2 size={14} />
                    <span>Chia sẻ</span>
                  </>
                )}
              </button>
            </div>

            {/* Link bài gốc */}
            <a
              href={article.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 underline underline-offset-4"
            >
              <span>Xem bài gốc trên davetrott.co.uk</span>
              <ExternalLink size={12} />
            </a>
          </div>

          {/* Điều hướng bài trước / bài tiếp theo */}
          {(prevArticle || nextArticle) && (
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 pt-6 border-t border-zinc-200/60">
              {prevArticle ? (
                <Link
                  href={`/creative/${prevArticle.slug}`}
                  className="group flex flex-col rounded-[14px] border border-zinc-200 bg-white p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-xs"
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 group-hover:text-zinc-600">
                    <ChevronLeft size={13} /> Bài trước
                  </span>
                  <span className="mt-1 line-clamp-1 text-xs font-semibold text-zinc-900">
                    {prevArticle.titleVi || prevArticle.originalTitle}
                  </span>
                </Link>
              ) : (
                <div />
              )}

              {nextArticle ? (
                <Link
                  href={`/creative/${nextArticle.slug}`}
                  className="group flex flex-col items-end text-right rounded-[14px] border border-zinc-200 bg-white p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-xs"
                >
                  <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 group-hover:text-zinc-600">
                    Bài tiếp theo <ChevronRight size={13} />
                  </span>
                  <span className="mt-1 line-clamp-1 text-xs font-semibold text-zinc-900">
                    {nextArticle.titleVi || nextArticle.originalTitle}
                  </span>
                </Link>
              ) : (
                <div />
              )}
            </div>
          )}

          {/* Hộp ghi nhận bản quyền tôn trọng tác giả */}
          <div className="mt-10 rounded-[14px] bg-zinc-100/70 p-4 text-center text-xs text-zinc-500 leading-relaxed">
            Bài viết gốc của huyền thoại quảng cáo <strong>Dave Trott</strong> tại{" "}
            <a
              href="https://davetrott.co.uk"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-950"
            >
              davetrott.co.uk
            </a>
            . Bản dịch tiếng Việt được thực hiện bởi <strong>myCreative</strong> nhằm phục vụ
            mục đích học tập, trau dồi sáng tạo và lan tỏa cảm hứng nội bộ.
          </div>
        </footer>
      </main>
    </div>
  );
}

