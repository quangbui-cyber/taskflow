"use client";

import { useState } from "react";
import Brand from "@/components/Brand";
import { Check, Copy, ShieldAlert, ShieldCheck } from "lucide-react";
import type { PublicVerificationDto } from "@/lib/workflow/publicVerification";

const ROLE_LABELS: Record<string, string> = {
  CREATOR: "Người lập",
  MANAGER: "Quản lý",
  ACCOUNTANT: "Kế toán",
  CEO: "CEO",
};

export default function PublicVerificationCard({
  result,
}: {
  result: { status: "VALID"; data: PublicVerificationDto } | { status: "INVALID" };
}) {
  const [copied, setCopied] = useState(false);

  if (result.status === "INVALID") {
    return (
      <main className="min-h-screen bg-[var(--surface-soft)] p-4 flex items-center justify-center">
        <section className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-7 text-center shadow-sm">
          <Brand />
          <div className="mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
            <ShieldAlert size={26} aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-[var(--foreground)]">
            Không xác minh được hồ sơ
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Mã tra cứu không hợp lệ, đã bị thu hồi/thay thế hoặc bằng chứng phát hành không còn khớp.
          </p>
          <p className="mt-4 text-xs text-[var(--muted)]">
            Trang không công bố chi tiết nội bộ về nguyên nhân từ chối.
          </p>
        </section>
      </main>
    );
  }

  const data = result.data;

  const handleCopyDigest = async () => {
    try {
      await navigator.clipboard.writeText(data.digestShort);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failure
    }
  };

  return (
    <main className="min-h-screen bg-[var(--surface-soft)] p-4 py-10">
      <section className="mx-auto w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <Brand />
        <div className="mt-6 flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
            <ShieldCheck size={16} aria-hidden="true" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--success)]">
            Bằng chứng phát hành nội bộ hợp lệ
          </p>
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
          {data.dossierCode}
        </h1>
        <dl className="mt-6 grid gap-3 text-sm">
          <div>
            <dt className="text-[var(--text-secondary)]">Biểu mẫu</dt>
            <dd className="font-medium text-[var(--foreground)]">{data.templateName}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-secondary)]">Ngày duyệt</dt>
            <dd className="font-medium text-[var(--foreground)]">
              {new Date(data.approvedAt).toLocaleString("vi-VN")}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-secondary)]">Người đề nghị</dt>
            <dd className="font-medium text-[var(--foreground)]">
              {data.requesterName || "Không công bố"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-secondary)]">Tổng số tiền</dt>
            <dd className="font-medium text-[var(--foreground)]">
              {data.amount
                ? `${new Intl.NumberFormat("vi-VN").format(Number(data.amount))} VND`
                : "Không áp dụng"}
            </dd>
          </div>
        </dl>
        <h2 className="mt-6 text-sm font-semibold text-[var(--foreground)]">
          Chuỗi xác nhận
        </h2>
        <ol className="mt-2 space-y-2">
          {data.signers.map((signer) => (
            <li
              key={signer.role}
              className="rounded-lg bg-[var(--surface-soft)] p-3 text-sm"
            >
              <span className="font-medium">
                {ROLE_LABELS[signer.role] ?? signer.role}
              </span>
              <span className="block text-[var(--text-secondary)]">
                {signer.name || "Không công bố"} ·{" "}
                {new Date(signer.signedAt).toLocaleString("vi-VN")}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex items-center justify-between rounded-lg bg-zinc-900 p-3 text-zinc-200">
          <p className="font-mono text-xs">SHA-256: {data.digestShort}…</p>
          <button
            type="button"
            onClick={handleCopyDigest}
            aria-label="Sao chép mã SHA-256"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check size={13} className="text-emerald-400" aria-hidden="true" />
                <span className="text-emerald-400">Đã chép</span>
              </>
            ) : (
              <>
                <Copy size={13} aria-hidden="true" />
                <span>Chép mã</span>
              </>
            )}
          </button>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[var(--text-secondary)]">
          Kết quả dựa trên snapshot bất biến, mã băm chống sửa đổi và HMAC của đơn vị phát hành nội bộ. Đây không phải chứng thư hay chữ ký số CA.
        </p>
      </section>
    </main>
  );
}
