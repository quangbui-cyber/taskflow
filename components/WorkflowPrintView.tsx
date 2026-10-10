"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { moneyInWords } from "@/lib/costflow/money";

export type WorkflowPrintDocument = {
  code: string;
  title: string;
  kind: string;
  approvedAt: string;
  creatorName: string;
  amount: string;
  content: string;
  financeLines: readonly { id: string; description: string; amount: string }[];
  signatures: readonly { role: string; name: string; signedAt: string }[];
  projectionSha256?: string;
  signingMode?: "DIGITAL" | "PHYSICAL";
  qrDataUrl?: string;
  isDraft: boolean;
};

const ROLE_LABEL: Record<string, string> = { CREATOR: "Người lập", MANAGER: "Quản lý", ACCOUNTANT: "Kế toán", CEO: "CEO" };
const FORM_LABEL: Record<string, string> = {
  ADVANCE: "GIẤY ĐỀ NGHỊ TẠM ỨNG", VENDOR_PAYMENT: "GIẤY ĐỀ NGHỊ THANH TOÁN", REIMBURSEMENT: "GIẤY ĐỀ NGHỊ HOÀN TẠM ỨNG",
  PROPOSAL: "TỜ TRÌNH", PROPOSAL_ADVANCE: "GIẤY ĐỀ NGHỊ TẠM ỨNG", PROPOSAL_ADVANCE_SETTLEMENT: "GIẤY ĐỀ NGHỊ HOÀN TẠM ỨNG",
};

function formatVnd(value: string) {
  if (!value || !/^\d+$/.test(value)) return "Không áp dụng";
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} VND`;
}

export function WorkflowPrintView({ doc, backHref }: { doc: WorkflowPrintDocument; backHref: string }) {
  return <main className="min-h-screen bg-zinc-100 py-6 print:bg-white print:py-0">
    <div className="mx-auto mb-4 flex max-w-[794px] items-center justify-between px-4 print:hidden"><Link href={backHref} className="tf-link">Quay lại hồ sơ</Link><Button onClick={() => window.print()}><Printer size={16} aria-hidden="true" />In / Lưu PDF</Button></div>
    <article className="relative mx-auto min-h-[1123px] max-w-[794px] overflow-hidden border border-zinc-200 bg-white p-10 font-serif shadow-sm print:border-0 print:shadow-none">
      {doc.isDraft && <div aria-label="Bản nháp chưa xác minh" className="pointer-events-none absolute inset-0 flex rotate-[-28deg] items-center justify-center text-7xl font-bold tracking-widest text-rose-200/60">BẢN NHÁP</div>}
      <header className="relative flex justify-between border-b-2 border-zinc-900 pb-4 font-sans"><div><p className="text-xs uppercase tracking-wide">Công ty Cổ phần Truyền thông & Sự kiện</p><h1 className="text-xl font-bold">CREATIVE STATION</h1></div><div className="text-right text-xs"><p className="font-mono font-semibold">{doc.code}</p><p>{doc.isDraft ? "Chưa phê duyệt" : new Date(doc.approvedAt).toLocaleString("vi-VN")}</p></div></header>
      <section className="relative mt-8 text-center"><h2 className="text-2xl font-bold">{FORM_LABEL[doc.kind] ?? doc.title}</h2><p className="mt-1 text-sm">{doc.title}</p></section>
      <dl className="relative mt-8 grid gap-4 text-sm"><div><dt className="text-zinc-500">Người đề nghị</dt><dd className="font-semibold">{doc.creatorName || "Không có trong snapshot"}</dd></div><div><dt className="text-zinc-500">Nội dung</dt><dd className="whitespace-pre-wrap rounded border border-zinc-200 p-3">{doc.content}</dd></div><div><dt className="text-zinc-500">Tổng số tiền đã duyệt</dt><dd className="text-lg font-bold">{formatVnd(doc.amount)}</dd>{/^\d+$/.test(doc.amount) && <dd className="italic">Bằng chữ: {moneyInWords(doc.amount)}</dd>}</div></dl>
      {doc.financeLines.length > 0 && <table className="relative mt-7 w-full border-collapse text-sm"><caption className="mb-2 text-left font-semibold">Dòng giá trị trong snapshot</caption><thead><tr><th className="border p-2">Nội dung</th><th className="border p-2 text-right">Số tiền</th></tr></thead><tbody>{doc.financeLines.map(line => <tr key={line.id}><td className="border p-2">{line.description}</td><td className="border p-2 text-right">{formatVnd(line.amount)}</td></tr>)}</tbody></table>}
      <section className="relative mt-10 grid grid-cols-4 gap-2 font-sans text-center text-xs">{["CREATOR", "MANAGER", "ACCOUNTANT", "CEO"].map(role => { const signature = doc.signatures.find(item => item.role === role); return <div key={role} className="flex min-h-36 flex-col justify-between rounded border border-zinc-200 p-2"><strong>{ROLE_LABEL[role]}</strong><span>{doc.isDraft ? "Chưa ký" : doc.signingMode === "PHYSICAL" ? "Bằng chứng bản giấy" : "Đã xác nhận nội bộ"}</span><div><p className="font-semibold">{signature?.name ?? "—"}</p>{signature?.signedAt && <p className="text-[10px] text-zinc-500">{new Date(signature.signedAt).toLocaleString("vi-VN")}</p>}</div></div>; })}</section>
      <footer className="relative mt-10 flex items-end justify-between border-t border-zinc-200 pt-4 font-sans text-xs"><div className="max-w-lg"><p>{doc.isDraft ? "Bản xem trước được cấp cho người có quyền; không phải bản đã xác minh." : "Bản in lấy từ snapshot bất biến đã duyệt và bằng chứng phát hành nội bộ."}</p>{doc.projectionSha256 && <p className="mt-2 break-all font-mono text-[10px]">SHA-256: {doc.projectionSha256}</p>}<p className="mt-2 text-zinc-500">Không phải chứng thư hoặc chữ ký số CA.</p></div>{!doc.isDraft && doc.qrDataUrl && <div className="text-center">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={doc.qrDataUrl} alt="QR xác minh snapshot đã duyệt" width={112} height={112} /><p>Quét để tra cứu</p></div>}</footer>
    </article>
  </main>;
}
