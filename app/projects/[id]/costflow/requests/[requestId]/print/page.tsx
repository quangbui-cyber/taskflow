import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getReimbursementExport } from "@/lib/costflow/exportData";
import { moneyInWords, displayMoney } from "@/lib/costflow/money";
import PrintCostFlow from "@/components/PrintCostFlow";

export default async function PrintReimbursement({ params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  const data = await getReimbursementExport(id, requestId, await requireUser());
  if (!data) notFound();
  const p = data.payload;
  return <main className="tf-costflow-print mx-auto max-w-[1220px] p-6"><PrintCostFlow /><div className="mb-6 flex justify-between"><strong>CREATIVE STATION</strong><span>Mẫu: ĐNHTU-CS.2026</span></div><h1 className="mb-6 text-center text-2xl font-bold">PHIẾU ĐỀ NGHỊ HOÀN TẠM ỨNG</h1><p>Người xin thanh toán: {data.requester}</p><p>Chương trình: {data.project}</p><p>Lý do hoàn toán: {p.explanation || data.title}</p><p className="mb-4 text-sm">Mã nguồn: {data.id} · {data.approval} · Chưa ký</p><div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr>{["STT", "Chứng từ - Số", "Ngày", "Nội dung", "Số tiền thực tế phát sinh", "Tổng số tiền đã tạm ứng", "Thanh toán bổ sung", "Thu hoàn tạm ứng", "Người nhận - STK"].map(t => <th key={t} scope="col" className="border border-zinc-500 p-2">{t}</th>)}</tr></thead><tbody><tr>{["1", data.id, data.createdDate, data.title, displayMoney(p.actualGross ?? "0"), displayMoney(p.advance ?? "0"), displayMoney(p.additional ?? "0"), displayMoney(p.refund ?? "0"), data.requester].map((value, i) => <td key={i} className="border border-zinc-500 p-2">{value}</td>)}</tr></tbody></table></div><p className="mt-4 font-semibold">Bằng chữ: {moneyInWords(p.actualGross ?? "0")}</p><p className="mt-2 text-sm">Đơn vị VND; chi phí thực tế gồm VAT. Tổng tính từ số gốc rồi làm tròn.</p><div className="my-8 grid grid-cols-3 gap-6 text-center font-semibold"><p>Kế toán/tài chính</p><p>Phụ trách bộ phận</p><p>Người lập/Trưởng dự án</p></div><p className="mt-24 text-center font-semibold">Giám đốc</p><p className="mt-24 text-xs">Bản xuất truy nguồn hồ sơ, chưa phải bằng chứng ký hoặc xác nhận tiền thực tế.</p></main>;
}
