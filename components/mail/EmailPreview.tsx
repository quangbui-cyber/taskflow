"use client";

/** Khung xem thư: HTML thư nằm trong iframe sandbox (không chạy script). */
export default function EmailPreview({
  html,
  subject,
  to,
  loading = false,
  className = "",
}: {
  html: string | null;
  subject?: string;
  to?: string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-[16px] border border-zinc-200/80 bg-white shadow-sm ${className}`}>
      <div className="space-y-0.5 border-b border-zinc-100 px-4 py-3 text-sm">
        <p className="truncate font-semibold text-zinc-900">{subject || " "}</p>
        {to !== undefined && <p className="truncate text-xs text-zinc-500">{to ? `Tới ${to}` : "Người nhận mẫu"}</p>}
      </div>
      <div className={`relative transition-opacity duration-150 ${loading ? "opacity-60" : "opacity-100"}`}>
        {html ? (
          <iframe
            title="Xem trước thư"
            srcDoc={html}
            // Không cho chạy script; cùng origin để tải phông tự host của app.
            sandbox="allow-same-origin"
            className="block h-[640px] w-full border-0 bg-zinc-100"
          />
        ) : (
          <div className="flex h-[640px] items-center justify-center bg-zinc-100">
            <span className="tf-spinner" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}
