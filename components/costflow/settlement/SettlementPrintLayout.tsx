import Link from "next/link";
import PrintCostFlow from "@/components/PrintCostFlow";
import type { SettlementPrintDocument } from "@/lib/costflow/settlementSecurity";

const FAMILY_LABELS: Record<SettlementPrintDocument["family"], string> = {
  QUOTATION: "BÁO GIÁ",
  CUSTOMER_ACCEPTANCE: "NGHIỆM THU KHÁCH HÀNG",
  DNTU: "PHIẾU ĐỀ NGHỊ TẠM ỨNG",
  DNTT: "PHIẾU ĐỀ NGHỊ THANH TOÁN",
  DNHTU: "PHIẾU ĐỀ NGHỊ HOÀN TẠM ỨNG",
  PROJECT_SETTLEMENT: "QUYẾT TOÁN DỰ ÁN",
};

const ROLE_LABELS = {
  CREATOR: "NGƯỜI LẬP",
  MANAGER: "QUẢN LÝ",
  ACCOUNTANT: "KẾ TOÁN",
  CEO: "GIÁM ĐỐC",
} as const;

const SIGNING_LABELS = {
  UNSIGNED: "Đã duyệt — chưa ký",
  PARTIALLY_SIGNED: "Đã duyệt — đang ký",
  SIGNED_CONFIRMED: "Đã duyệt — bằng chứng ký đã xác nhận",
} as const;

function vnd(value: string) {
  return `${new Intl.NumberFormat("vi-VN").format(Number(value))} ₫`;
}

export default function SettlementPrintLayout({
  doc,
  backHref,
  qrDataUrl,
}: {
  doc: SettlementPrintDocument;
  backHref: string;
  qrDataUrl?: string;
}) {
  const customerSafe = doc.family === "QUOTATION" || doc.family === "CUSTOMER_ACCEPTANCE";
  const landscape = doc.family === "PROJECT_SETTLEMENT";

  return (
    <main className={`tf-costflow-print mx-auto bg-white p-8 text-zinc-950 ${landscape ? "max-w-[1120px]" : "max-w-[820px]"}`}>
      <div className="tf-costflow-no-print mb-5 flex items-start justify-between gap-4">
        <Link className="tf-link" href={backHref}>← Về CostFlow</Link>
        <PrintCostFlow />
      </div>

      <article aria-labelledby="settlement-print-title">
        <header className="border-b-2 border-zinc-900 pb-5 text-center">
          <p className="text-sm font-bold tracking-[0.18em]">CREATIVE STATION</p>
          <h1 id="settlement-print-title" className="mt-3 text-2xl font-bold">
            {FAMILY_LABELS[doc.family]}
          </h1>
          <p className="mt-2 text-sm">{doc.projectName || doc.title}</p>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-sm" aria-label="Thông tin phiên bản">
          <p><strong>Phiên bản quyết toán:</strong> v{doc.sourceVersion}</p>
          <p><strong>Phiên bản tài liệu:</strong> v{doc.documentVersion}</p>
          <p><strong>Trạng thái duyệt:</strong> {doc.approvalState}</p>
          <p><strong>Trạng thái ký:</strong> {SIGNING_LABELS[doc.signingState]}</p>
          <p><strong>Lịch sử:</strong> {doc.replacementLabel}</p>
          <p><strong>Ngày duyệt:</strong> {doc.approvedAt ? new Date(doc.approvedAt).toLocaleString("vi-VN") : "—"}</p>
        </section>

        <section className="mt-7" aria-labelledby="settlement-lines-heading">
          <h2 id="settlement-lines-heading" className="sr-only">Chi tiết chứng từ</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="mb-2 text-left font-semibold">Chi tiết giá trị đã duyệt</caption>
              <thead>
                <tr className="bg-zinc-100">
                  <th scope="col" className="border border-zinc-400 p-2 text-center">STT</th>
                  <th scope="col" className="border border-zinc-400 p-2 text-left">Nội dung</th>
                  {!customerSafe && <th scope="col" className="border border-zinc-400 p-2 text-left">Người nhận</th>}
                  <th scope="col" className="border border-zinc-400 p-2 text-right">Net</th>
                  <th scope="col" className="border border-zinc-400 p-2 text-right">VAT</th>
                  <th scope="col" className="border border-zinc-400 p-2 text-right">Gross</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item, index) => (
                  <tr key={`${item.stableLineId}:${item.recipientKey}`} className="[break-inside:avoid]">
                    <td className="border border-zinc-300 p-2 text-center">{index + 1}</td>
                    <td className="border border-zinc-300 p-2">{item.description}</td>
                    {!customerSafe && <td className="border border-zinc-300 p-2">{item.recipientKey}</td>}
                    <td className="border border-zinc-300 p-2 text-right tabular-nums">{vnd(item.net)}</td>
                    <td className="border border-zinc-300 p-2 text-right tabular-nums">{vnd(item.vat)}</td>
                    <td className="border border-zinc-300 p-2 text-right tabular-nums">{vnd(item.gross)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold [break-inside:avoid]">
                  <th scope="row" colSpan={customerSafe ? 2 : 3} className="border border-zinc-400 p-2 text-right">TỔNG</th>
                  <td className="border border-zinc-400 p-2 text-right tabular-nums">{vnd(doc.totals.net)}</td>
                  <td className="border border-zinc-400 p-2 text-right tabular-nums">{vnd(doc.totals.vat)}</td>
                  <td className="border border-zinc-400 p-2 text-right tabular-nums">{vnd(doc.approvedGross)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-sm"><strong>Bằng chữ:</strong> {doc.moneyInWords}</p>
        </section>

        {!customerSafe && doc.family === "PROJECT_SETTLEMENT" && (
          <section className="mt-8 [break-before:page]" aria-labelledby="recipient-reconciliation-heading">
            <h2 id="recipient-reconciliation-heading" className="mb-3 text-lg font-bold">Đối soát theo người nhận</h2>
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Đối soát Actual Cost, tạm ứng, hoàn và chi thêm</caption>
              <thead><tr className="bg-zinc-100">
                <th scope="col" className="border border-zinc-400 p-2 text-left">Người nhận</th>
                <th scope="col" className="border border-zinc-400 p-2 text-right">AC</th>
                <th scope="col" className="border border-zinc-400 p-2 text-right">Tạm ứng</th>
                <th scope="col" className="border border-zinc-400 p-2 text-right">Hoàn</th>
                <th scope="col" className="border border-zinc-400 p-2 text-right">Chi thêm</th>
              </tr></thead>
              <tbody>{doc.recipients.map(recipient => (
                <tr key={recipient.recipientKey} className="[break-inside:avoid]">
                  <td className="border border-zinc-300 p-2">{recipient.displayName}</td>
                  <td className="border border-zinc-300 p-2 text-right">{vnd(recipient.actualGross)}</td>
                  <td className="border border-zinc-300 p-2 text-right">{vnd(recipient.advanceGross)}</td>
                  <td className="border border-zinc-300 p-2 text-right">{vnd(recipient.refundDue)}</td>
                  <td className="border border-zinc-300 p-2 text-right">{vnd(recipient.additionalDue)}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        )}

        <section className="mt-10 grid grid-cols-4 gap-4 [break-inside:avoid]" aria-label="Bốn vị trí chữ ký">
          {doc.signatureSlots.map(slot => (
            <div key={slot.role} className="min-h-40 text-center text-xs">
              <h2 className="font-bold">{ROLE_LABELS[slot.role]}</h2>
              {slot.state === "SIGNED" && slot.signatureDataUrl ? (
                <>
                  {/* Signature bytes are read from the confirmed server-side WorkflowSigningEvent only. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={slot.signatureDataUrl} alt={`Chữ ký ${slot.actorName ?? ROLE_LABELS[slot.role]}`} className="mx-auto my-2 h-20 max-w-full object-contain" />
                  <p className="font-semibold">{slot.actorName}</p>
                  <p>{slot.signedAt ? new Date(slot.signedAt).toLocaleString("vi-VN") : ""}</p>
                </>
              ) : <p className="mt-10 italic text-zinc-500">Chưa có bằng chứng ký xác nhận</p>}
            </div>
          ))}
        </section>

        <footer className="mt-8 flex items-end justify-between gap-6 border-t border-zinc-300 pt-4 text-xs text-zinc-600 [break-inside:avoid]">
          <div>
            <p>SHA-256 bản chiếu: <span className="font-mono">{doc.canonicalHash}</span></p>
            <p>SHA-256 là bằng chứng chống sửa đổi, không phải chứng thư hay chữ ký số CA.</p>
          </div>
          {qrDataUrl && doc.verificationPath && (
            <div className="text-center">
              {/* QR contains only the opaque public capability URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR xác minh bản phát hành nội bộ" width={112} height={112} className="mx-auto size-28" />
              <p>Tra cứu bản phát hành</p>
            </div>
          )}
        </footer>
      </article>

      <style>{`@media print {
        .tf-costflow-print article { break-after: auto; page-break-after: auto; }
        .tf-costflow-print table, .tf-costflow-print tr, .tf-costflow-print section { break-inside: avoid; page-break-inside: avoid; }
        .tf-costflow-print thead { display: table-header-group; }
        .tf-costflow-print h1, .tf-costflow-print h2 { break-after: avoid; page-break-after: avoid; }
        @page { size: ${landscape ? "A4 landscape" : "A4 portrait"}; margin: 12mm; }
      }`}</style>
    </main>
  );
}
