import Brand from "@/components/Brand";
import type { PublicVerificationDto } from "@/lib/workflow/publicVerification";

const ROLE_LABELS: Record<string, string> = {
  CREATOR: "Người lập",
  MANAGER: "Quản lý",
  ACCOUNTANT: "Kế toán",
  CEO: "CEO",
};

export default function PublicVerificationCard({ result }: { result: { status: "VALID"; data: PublicVerificationDto } | { status: "INVALID" } }) {
  if (result.status === "INVALID") {
    return <main className="min-h-screen bg-zinc-50 p-4 flex items-center justify-center">
      <section className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-7 text-center shadow-sm">
        <Brand />
        <h1 className="mt-6 text-xl font-semibold text-zinc-950">Không xác minh được hồ sơ</h1>
        <p className="mt-2 text-sm text-zinc-600">Mã tra cứu không hợp lệ, đã bị thu hồi/thay thế hoặc bằng chứng phát hành không còn khớp.</p>
        <p className="mt-4 text-xs text-zinc-500">Trang không công bố chi tiết nội bộ về nguyên nhân từ chối.</p>
      </section>
    </main>;
  }
  const data = result.data;
  return <main className="min-h-screen bg-zinc-50 p-4 py-10">
    <section className="mx-auto w-full max-w-lg rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
      <Brand />
      <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-emerald-700">Bằng chứng phát hành nội bộ hợp lệ</p>
      <h1 className="mt-2 text-2xl font-semibold text-zinc-950">{data.dossierCode}</h1>
      <dl className="mt-6 grid gap-3 text-sm">
        <div><dt className="text-zinc-500">Biểu mẫu</dt><dd className="font-medium text-zinc-900">{data.templateName}</dd></div>
        <div><dt className="text-zinc-500">Ngày duyệt</dt><dd className="font-medium text-zinc-900">{new Date(data.approvedAt).toLocaleString("vi-VN")}</dd></div>
        <div><dt className="text-zinc-500">Người đề nghị</dt><dd className="font-medium text-zinc-900">{data.requesterName || "Không công bố"}</dd></div>
        <div><dt className="text-zinc-500">Tổng số tiền</dt><dd className="font-medium text-zinc-900">{data.amount ? `${new Intl.NumberFormat("vi-VN").format(Number(data.amount))} VND` : "Không áp dụng"}</dd></div>
      </dl>
      <h2 className="mt-6 text-sm font-semibold text-zinc-900">Chuỗi xác nhận</h2>
      <ol className="mt-2 space-y-2">
        {data.signers.map(signer => <li key={signer.role} className="rounded-lg bg-zinc-50 p-3 text-sm"><span className="font-medium">{ROLE_LABELS[signer.role] ?? signer.role}</span><span className="block text-zinc-600">{signer.name || "Không công bố"} · {new Date(signer.signedAt).toLocaleString("vi-VN")}</span></li>)}
      </ol>
      <p className="mt-6 rounded-lg bg-zinc-900 p-3 font-mono text-xs text-zinc-200">SHA-256: {data.digestShort}…</p>
      <p className="mt-4 text-xs leading-relaxed text-zinc-500">Kết quả dựa trên snapshot bất biến, mã băm chống sửa đổi và HMAC của đơn vị phát hành nội bộ. Đây không phải chứng thư hay chữ ký số CA.</p>
    </section>
  </main>;
}
