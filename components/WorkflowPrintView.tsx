"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Printer,
  PenTool,
  RotateCcw,
  XCircle,
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Presentation";
import { SignaturePad } from "@/components/SignaturePad";
import { moneyInWords } from "@/lib/costflow/money";
import { workflowQueueAction } from "@/app/actions/workflow";
import { CreativeStationLogo } from "@/components/CreativeStationLogo";

export type DetailedFinanceLine = {
  stt?: number;
  id: string;
  description: string;
  icLineLabel?: string;
  amount: string;
  recipientName?: string;
  recipientBank?: string;
  recipientAccount?: string;
};

export type WorkflowPrintDocument = {
  code: string;
  title: string;
  kind: string;
  approvedAt: string;
  creatorName: string;
  creatorDepartment?: string;
  creatorPhone?: string;
  projectName?: string;
  templateCode?: string;
  expectedSettlementDate?: string;
  createdDate?: string;
  amount: string;
  content: string;
  financeLines: readonly { id: string; description: string; amount: string }[];
  detailedLines?: readonly DetailedFinanceLine[];
  signatures: readonly { role: string; name: string; signedAt: string; signaturePngUrl?: string }[];
  projectionSha256?: string;
  signingMode?: "DIGITAL" | "PHYSICAL";
  qrDataUrl?: string;
  isDraft: boolean;

  // Context for interactive in-document actions
  requestId?: string;
  projectId?: string;
  module?: "COSTFLOW" | "WORKFLOW";
  version?: number;
  attemptId?: string | null;
  submittedVersion?: number | null;
  canAct?: boolean;
  currentActorRole?: string;
  currentStepIndex?: number;
  currentAssigneeId?: string;
  currentUser?: { id: string; name?: string; role: string };
  userProfileSignature?: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  CREATOR: "Người lập / Trưởng dự án",
  MANAGER: "Phụ trách bộ phận",
  ACCOUNTANT: "Kế toán / Tài chính",
  CEO: "Giám đốc điều hành",
};

const FORM_LABEL: Record<string, string> = {
  ADVANCE: "GIẤY ĐỀ NGHỊ TẠM ỨNG",
  VENDOR_PAYMENT: "GIẤY ĐỀ NGHỊ THANH TOÁN",
  REIMBURSEMENT: "GIẤY ĐỀ NGHỊ HOÀN TẠM ỨNG",
  PROPOSAL: "TỜ TRÌNH",
  PROPOSAL_ADVANCE: "GIẤY ĐỀ NGHỊ TẠM ỨNG",
  PROPOSAL_ADVANCE_SETTLEMENT: "GIẤY ĐỀ NGHỊ HOÀN TẠM ỨNG",
};

const TEMPLATE_CODE_BY_KIND: Record<string, string> = {
  ADVANCE: "ĐNTU-CS.2026",
  PROPOSAL_ADVANCE: "ĐNTU-CS.2026",
  VENDOR_PAYMENT: "ĐNTT-CS.2026",
  REIMBURSEMENT: "ĐNHTU-CS.2026",
  PROPOSAL_ADVANCE_SETTLEMENT: "ĐNHTU-CS.2026",
  PROPOSAL: "TTR-CS.2026",
};

function formatVnd(value: string) {
  if (!value || !/^\d+$/.test(value)) return "Không áp dụng";
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value))} VND`;
}

export function WorkflowPrintView({ doc, backHref }: { doc: WorkflowPrintDocument; backHref: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Dialog & Signing states
  const [signPadOpen, setSignPadOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [actionReason, setActionReason] = useState("");
  const reviewConfirmed = true;
  const [actionFeedback, setActionFeedback] = useState<{ error?: string; success?: string } | null>(null);

  // Template codes and titles
  const templateCode = doc.templateCode || TEMPLATE_CODE_BY_KIND[doc.kind] || "CS-DOC.2026";
  const formTitle = FORM_LABEL[doc.kind] ?? doc.title;

  const currentRoleTitle = doc.currentActorRole ? ROLE_LABEL[doc.currentActorRole] ?? doc.currentActorRole : "";

  // Submit action directly via workflowQueueAction
  async function handleExecuteAction(
    decision: "APPROVE" | "RETURN" | "REJECT",
    signatureData?: string,
    signaturePin?: string
  ) {
    if (!doc.requestId) return;
    setActionFeedback(null);

    const formData = new FormData();
    formData.set("module", doc.module || "COSTFLOW");
    formData.set("requestId", doc.requestId);
    formData.set("projectId", doc.projectId || "");
    formData.set("version", String(doc.version ?? 0));
    formData.set("attemptId", doc.attemptId || "");
    formData.set("submittedVersion", String(doc.submittedVersion ?? ""));
    formData.set("stepIndex", String(doc.currentStepIndex ?? 0));
    formData.set("decision", decision);
    formData.set("reason", actionReason);

    if (signatureData) formData.set("signatureData", signatureData);
    if (signaturePin) formData.set("signaturePin", signaturePin);
    if (doc.currentActorRole === "ACCOUNTANT" && reviewConfirmed) {
      formData.set("reviewConfirmed", "yes");
    }

    startTransition(async () => {
      try {
        const result = await workflowQueueAction({}, formData);
        if (result.error) {
          setActionFeedback({ error: result.error });
        } else {
          setActionFeedback({ success: "Thao tác đã được ghi nhận thành công!" });
          setReturnDialogOpen(false);
          setRejectDialogOpen(false);
          setActionReason("");
          router.refresh();
        }
      } catch (err) {
        setActionFeedback({
          error: err instanceof Error ? err.message : "Có lỗi xảy ra khi thực hiện thao tác.",
        });
      }
    });
  }

  return (
    <main className="min-h-screen bg-zinc-100 pb-16 print:bg-white print:pb-0">
      {/* 1. STICKY TOP ACTION BAR (Browser only, hidden on paper print) */}
      <nav
        aria-label="Thanh công cụ trình ký và in ấn"
        className="sticky top-0 z-30 mb-6 border-b border-zinc-200 bg-white/95 px-4 py-3 shadow-xs backdrop-blur-md print:hidden"
      >
        <div className="mx-auto flex max-w-[840px] flex-wrap items-center justify-between gap-3">
          {/* Left: Navigation and document state */}
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-2xs hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>Quay lại hồ sơ</span>
            </Link>

            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-zinc-900">{doc.code}</span>
              {doc.isDraft ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
                  <Clock size={11} aria-hidden="true" />
                  {doc.currentActorRole ? `Chờ ${ROLE_LABEL[doc.currentActorRole]} duyệt` : "Bản nháp trình ký"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={11} aria-hidden="true" />
                  Đã duyệt chính thức
                </span>
              )}
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {doc.canAct && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setSignPadOpen(true)}
                  disabled={isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-xs"
                >
                  <PenTool size={13} className="mr-1.5" aria-hidden="true" />
                  Ký duyệt số (E-Sign)
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setReturnDialogOpen(true)}
                  disabled={isPending}
                  className="text-xs"
                >
                  <RotateCcw size={13} className="mr-1" aria-hidden="true" />
                  Trả bổ sung
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRejectDialogOpen(true)}
                  disabled={isPending}
                  className="text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                >
                  <XCircle size={13} className="mr-1" aria-hidden="true" />
                  Từ chối
                </Button>
              </>
            )}

            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.print()}
              className="text-xs font-medium"
            >
              <Printer size={13} className="mr-1.5 text-zinc-600" aria-hidden="true" />
              In / Lưu PDF
            </Button>
          </div>
        </div>

        {/* Action feedback banners (if any) */}
        {actionFeedback && (
          <div className="mx-auto max-w-[840px] pt-2">
            {actionFeedback.error && <Alert tone="danger" title={actionFeedback.error} />}
            {actionFeedback.success && <Alert tone="success" title={actionFeedback.success} />}
          </div>
        )}

        {/* Guidance banner for active approver */}
        {doc.canAct && !actionFeedback && (
          <div className="mx-auto max-w-[840px] pt-2">
            <div className="flex items-center gap-2 rounded-lg bg-indigo-50/80 px-3 py-2 text-xs text-indigo-900 border border-indigo-200/80">
              <ShieldCheck size={14} className="text-indigo-600 shrink-0" aria-hidden="true" />
              <span>
                Bạn đang giữ quyền phê duyệt với vai trò <strong>{currentRoleTitle}</strong>. Bạn có thể bấm nút{" "}
                <strong>Ký duyệt số</strong> ở trên hoặc <strong>nhấp trực tiếp vào ô chữ ký</strong> trên trang A4 bên dưới.
              </span>
            </div>
          </div>
        )}
      </nav>

      {/* 2. THE CORPORATE A4 SHEET CANVAS */}
      <article
        className="relative mx-auto min-h-[1123px] max-w-[794px] overflow-hidden border border-zinc-200 bg-white p-10 font-serif text-zinc-900 shadow-md print:border-0 print:p-8 print:shadow-none"
      >
        {/* DRAFT WATERMARK */}
        {doc.isDraft && (
          <div
            aria-label="Bản nháp chưa xác minh"
            className="pointer-events-none absolute inset-0 flex rotate-[-28deg] items-center justify-center select-none text-7xl font-bold tracking-widest text-rose-200/60 print:text-rose-100/50"
          >
            BẢN NHÁP
          </div>
        )}

        {/* A. CORPORATE HEADER METADATA (Excel Parity) */}
        <header className="relative flex items-start justify-between border-b-2 border-zinc-900 pb-4 font-sans">
          <div className="flex items-center gap-3.5">
            <CreativeStationLogo className="h-10 w-auto print:h-9 shrink-0" />
            <div className="space-y-0.5 border-l border-zinc-300 pl-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-900">
                CÔNG TY CỔ PHẦN TRUYỀN THÔNG VÀ SỰ KIỆN CREATIVE STATION
              </p>
              <p className="text-[10px] text-zinc-600">
                Mã số thuế: 0316484346 · Website: https://mycreative.vn
              </p>
              {doc.projectName && (
                <p className="text-[11px] font-semibold text-zinc-800">
                  Dự án: <span className="text-indigo-900">{doc.projectName}</span>
                </p>
              )}
            </div>
          </div>

          <div className="text-right text-[11px]">
            <p className="font-mono font-bold text-zinc-900">Mẫu số: {templateCode}</p>
            <p className="font-mono text-zinc-700">Số: {doc.code}</p>
            <p className="text-[10px] text-zinc-500">
              {doc.isDraft
                ? `Ngày lập: ${doc.createdDate ? new Date(doc.createdDate).toLocaleDateString("vi-VN") : "—"}`
                : `Ngày duyệt: ${new Date(doc.approvedAt).toLocaleDateString("vi-VN")}`}
            </p>
          </div>
        </header>

        {/* B. DOCUMENT TITLE & SUBTITLE */}
        <section className="relative mt-6 text-center font-sans">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wide text-zinc-900">
            {formTitle}
          </h1>
          <p className="mt-1 text-xs italic text-zinc-600">
            Kính gửi: Ban Giám đốc & Phòng Kế toán - Tài chính
          </p>
          {doc.title && doc.title !== formTitle && (
            <p className="mt-1 text-xs font-semibold text-zinc-800">
              V/v: {doc.title}
            </p>
          )}
        </section>

        {/* C. FORM METADATA FIELDS (2-Column Key-Value List) */}
        <section className="relative mt-6 space-y-2 text-xs leading-relaxed font-sans text-zinc-800">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            <div>
              <span className="text-zinc-600">Họ và tên người đề nghị:</span>{" "}
              <strong className="text-zinc-950 font-bold">{doc.creatorName || "Người đề nghị"}</strong>
            </div>
            <div>
              <span className="text-zinc-600">Bộ phận / Phòng ban:</span>{" "}
              <span className="font-medium text-zinc-900">{doc.creatorDepartment || "Bộ phận Dự án"}</span>
            </div>
            <div>
              <span className="text-zinc-600">Dự án triển khai:</span>{" "}
              <strong className="text-zinc-900">{doc.projectName || "Nội bộ Creative Station"}</strong>
            </div>
            <div>
              <span className="text-zinc-600">Thời hạn hoàn ứng / thanh toán:</span>{" "}
              <span className="font-semibold text-zinc-900">
                {doc.expectedSettlementDate
                  ? new Date(doc.expectedSettlementDate).toLocaleDateString("vi-VN")
                  : "Theo tiến độ dự án"}
              </span>
            </div>
          </div>

          <div className="pt-1">
            <span className="text-zinc-600">Lý do / Nội dung đề nghị:</span>
            <p className="mt-1 whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50/60 p-2.5 text-xs text-zinc-900 font-serif">
              {doc.content || "Chi phí phục vụ sản xuất thực hiện dự án theo hợp đồng và kế hoạch được duyệt."}
            </p>
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1 border-t border-zinc-200">
            <div>
              <span className="text-zinc-600">Tổng số tiền đề nghị:</span>{" "}
              <strong className="text-sm sm:text-base font-bold text-zinc-950 tabular-nums">
                {formatVnd(doc.amount)}
              </strong>
            </div>
            {/^\d+$/.test(doc.amount) && (
              <div className="italic text-zinc-700 text-xs">
                (Bằng chữ: <strong>{moneyInWords(doc.amount)} đồng ./.</strong>)
              </div>
            )}
          </div>
        </section>

        {/* D. 5-COLUMN FINANCIAL BREAKDOWN TABLE (EXCEL PARITY) */}
        {((doc.detailedLines && doc.detailedLines.length > 0) || doc.financeLines.length > 0) && (
          <section className="relative mt-6 font-sans">
            <table className="w-full border-collapse border border-zinc-800 text-xs">
              <caption className="mb-2 text-left font-bold uppercase tracking-wider text-[11px] text-zinc-900">
                Bảng kê chi tiết các khoản chi:
              </caption>
              <thead>
                <tr className="bg-zinc-100 text-zinc-900 font-bold">
                  <th scope="col" className="border border-zinc-800 p-2 text-center w-[6%]">STT</th>
                  <th scope="col" className="border border-zinc-800 p-2 text-left w-[38%]">Nội dung chi</th>
                  <th scope="col" className="border border-zinc-800 p-2 text-left w-[16%]">Mục IC</th>
                  <th scope="col" className="border border-zinc-800 p-2 text-right w-[18%]">Số tiền (₫)</th>
                  <th scope="col" className="border border-zinc-800 p-2 text-left w-[22%]">Người nhận / STK</th>
                </tr>
              </thead>
              <tbody>
                {doc.detailedLines && doc.detailedLines.length > 0 ? (
                  doc.detailedLines.map((line, idx) => (
                    <tr key={line.id || idx} className="hover:bg-zinc-50/50">
                      <td className="border border-zinc-800 p-2 text-center tabular-nums text-zinc-600">
                        {line.stt ?? idx + 1}
                      </td>
                      <td className="border border-zinc-800 p-2 text-zinc-900 font-medium">
                        {line.description}
                      </td>
                      <td className="border border-zinc-800 p-2 text-zinc-600 text-[11px]">
                        {line.icLineLabel || "—"}
                      </td>
                      <td className="border border-zinc-800 p-2 text-right tabular-nums font-semibold text-zinc-950">
                        {formatVnd(line.amount)}
                      </td>
                      <td className="border border-zinc-800 p-2 text-zinc-800 text-[11px] leading-tight">
                        <div className="font-medium text-zinc-900">{line.recipientName || "—"}</div>
                        {line.recipientAccount && (
                          <div className="text-[10px] text-zinc-500 font-mono">
                            {line.recipientBank ? `${line.recipientBank} · ` : ""}
                            STK: {line.recipientAccount}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  doc.financeLines.map((line, idx) => (
                    <tr key={line.id || idx}>
                      <td className="border border-zinc-800 p-2 text-center tabular-nums text-zinc-600">{idx + 1}</td>
                      <td className="border border-zinc-800 p-2 text-zinc-900">{line.description}</td>
                      <td className="border border-zinc-800 p-2 text-zinc-600 text-[11px]">—</td>
                      <td className="border border-zinc-800 p-2 text-right tabular-nums font-semibold text-zinc-950">{formatVnd(line.amount)}</td>
                      <td className="border border-zinc-800 p-2 text-zinc-600 text-[11px]">—</td>
                    </tr>
                  ))
                )}
                <tr className="bg-zinc-100 font-bold text-zinc-950">
                  <td colSpan={3} className="border border-zinc-800 p-2 text-right uppercase">
                    TỔNG CỘNG:
                  </td>
                  <td className="border border-zinc-800 p-2 text-right tabular-nums font-black text-sm">
                    {formatVnd(doc.amount)}
                  </td>
                  <td className="border border-zinc-800 p-2 text-zinc-500">—</td>
                </tr>
              </tbody>
            </table>
          </section>
        )}

        {/* E. 4-TIER SIGNATURE SECTION (3 BOXES ROW 1 + 1 BOX ROW 2) */}
        <section className="relative mt-8 font-sans">
          <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
            {["CREATOR", "MANAGER", "ACCOUNTANT"].map(role => {
              const signature = doc.signatures.find(item => item.role === role);
              const isCurrentTurn = doc.canAct && doc.currentActorRole === role;

              return (
                <div
                  key={role}
                  className={`flex min-h-44 flex-col justify-between rounded border p-2.5 transition-all ${
                    isCurrentTurn
                      ? "border-amber-400 bg-amber-50/40 ring-2 ring-amber-300 print:border-zinc-300 print:bg-white print:ring-0"
                      : "border-zinc-300 bg-white"
                  }`}
                >
                  <div className="space-y-0.5">
                    <strong className="block text-[11px] font-bold uppercase text-zinc-900">
                      {ROLE_LABEL[role]}
                    </strong>
                    <span className="block text-[10px] text-zinc-500 italic">
                      (Ký, ghi rõ họ tên)
                    </span>
                  </div>

                  {/* Signature display slot */}
                  <div className="my-2 flex flex-1 flex-col items-center justify-center min-h-[64px]">
                    {signature?.signaturePngUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={signature.signaturePngUrl}
                        alt={`Chữ ký ${signature.name}`}
                        className="max-h-16 max-w-full object-contain"
                      />
                    ) : signature?.name ? (
                      <div className="flex flex-col items-center">
                        <div className="w-7 h-7 rounded-full border-2 border-emerald-600 flex items-center justify-center text-emerald-700 font-serif font-black text-xs rotate-[-12deg] mb-0.5">
                          ✓
                        </div>
                        <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-tight">
                          ĐÃ KÝ SỐ NỘI BỘ
                        </span>
                      </div>
                    ) : isCurrentTurn ? (
                      <button
                        type="button"
                        onClick={() => setSignPadOpen(true)}
                        className="group flex w-full flex-col items-center justify-center rounded border-2 border-dashed border-amber-400 bg-amber-50/70 p-2 transition-all hover:bg-amber-100 print:hidden cursor-pointer"
                        title="Nhấp để ký trực tiếp bằng chữ ký số và mã PIN"
                      >
                        <PenTool size={15} className="text-amber-600 mb-1 group-hover:scale-110 transition-transform" />
                        <span className="text-[11px] font-bold text-amber-900">Nhấp để ký tại đây</span>
                        <span className="text-[9px] text-amber-700">Mã PIN 6 số</span>
                      </button>
                    ) : (
                      <span className="text-zinc-400 italic text-[11px]">
                        {doc.isDraft ? "Chờ ký" : doc.signingMode === "PHYSICAL" ? "Bằng chứng bản giấy" : "Chưa ký"}
                      </span>
                    )}
                  </div>

                  <div className="border-t border-zinc-100 pt-1 text-[11px]">
                    <p className="font-semibold text-zinc-900 truncate">{signature?.name ?? "—"}</p>
                    {signature?.signedAt && (
                      <p className="text-[10px] text-zinc-500 font-mono">
                        {new Date(signature.signedAt).toLocaleDateString("vi-VN")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ROW 2: CEO BOX (CENTERED / PROMINENT) */}
          <div className="mt-3 mx-auto max-w-xs text-center text-xs">
            {(() => {
              const role = "CEO";
              const signature = doc.signatures.find(item => item.role === role);
              const isCurrentTurn = doc.canAct && doc.currentActorRole === role;

              return (
                <div
                  className={`flex min-h-44 flex-col justify-between rounded border p-2.5 transition-all ${
                    isCurrentTurn
                      ? "border-amber-400 bg-amber-50/40 ring-2 ring-amber-300 print:border-zinc-300 print:bg-white print:ring-0"
                      : "border-zinc-300 bg-white"
                  }`}
                >
                  <div className="space-y-0.5">
                    <strong className="block text-[11px] font-bold uppercase text-zinc-900">
                      {ROLE_LABEL[role]}
                    </strong>
                    <span className="block text-[10px] text-zinc-500 italic">
                      (Phê duyệt & Đóng dấu)
                    </span>
                  </div>

                  {/* Signature display slot */}
                  <div className="my-2 flex flex-1 flex-col items-center justify-center min-h-[64px] relative">
                    {signature?.signaturePngUrl ? (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={signature.signaturePngUrl}
                          alt={`Chữ ký ${signature.name}`}
                          className="max-h-16 max-w-full object-contain"
                        />
                        <div className="absolute -top-3 -right-6 rounded border border-rose-600 bg-rose-50/90 px-1.5 py-0.5 text-[9px] font-black tracking-widest text-rose-700 rotate-[12deg] shadow-2xs">
                          ĐÃ DUYỆT
                        </div>
                      </div>
                    ) : signature?.name ? (
                      <div className="flex flex-col items-center relative">
                        <div className="w-8 h-8 rounded-full border-2 border-emerald-600 flex items-center justify-center text-emerald-700 font-serif font-black text-xs rotate-[-12deg] mb-0.5">
                          ✓
                        </div>
                        <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-tight">
                          ĐÃ PHÊ DUYỆT
                        </span>
                        <div className="mt-1 rounded border border-rose-600 bg-rose-50/90 px-1 py-0.5 text-[8px] font-black text-rose-700 rotate-[8deg]">
                          CREATIVE STN
                        </div>
                      </div>
                    ) : isCurrentTurn ? (
                      <button
                        type="button"
                        onClick={() => setSignPadOpen(true)}
                        className="group flex w-full flex-col items-center justify-center rounded border-2 border-dashed border-amber-400 bg-amber-50/70 p-2 transition-all hover:bg-amber-100 print:hidden cursor-pointer"
                        title="CEO nhấp để phê duyệt và ký số điện tử"
                      >
                        <PenTool size={15} className="text-amber-600 mb-1 group-hover:scale-110 transition-transform" />
                        <span className="text-[11px] font-bold text-amber-900">CEO nhấp để phê duyệt</span>
                        <span className="text-[9px] text-amber-700">Mã PIN 6 số</span>
                      </button>
                    ) : (
                      <span className="text-zinc-400 italic text-[11px]">
                        {doc.isDraft ? "Chờ CEO phê duyệt" : "Chưa ký"}
                      </span>
                    )}
                  </div>

                  <div className="border-t border-zinc-100 pt-1 text-[11px]">
                    <p className="font-semibold text-zinc-900 truncate">{signature?.name ?? "—"}</p>
                    {signature?.signedAt && (
                      <p className="text-[10px] text-zinc-500 font-mono">
                        {new Date(signature.signedAt).toLocaleDateString("vi-VN")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </section>

        {/* F. SECURITY FOOTER & VERIFICATION QR CODE */}
        <footer className="relative mt-8 flex items-end justify-between border-t border-zinc-200 pt-4 font-sans text-xs text-zinc-600">
          <div className="max-w-md space-y-1">
            <p className="leading-tight">
              {doc.isDraft
                ? "Bản xem trước được cấp cho người có quyền; không phải bản đã xác minh."
                : "Bản in lấy từ snapshot bất biến đã duyệt và bằng chứng phát hành nội bộ."}
            </p>
            {doc.projectionSha256 && (
              <p className="break-all font-mono text-[10px] text-zinc-500">
                SHA-256: {doc.projectionSha256}
              </p>
            )}
            <p className="text-[10px] text-zinc-400">Không phải chứng thư hoặc chữ ký số CA.</p>
          </div>

          {!doc.isDraft && doc.qrDataUrl && (
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={doc.qrDataUrl}
                alt="QR xác minh snapshot đã duyệt"
                width={104}
                height={104}
                className="mx-auto"
              />
              <p className="mt-1 text-[10px] text-zinc-500 font-mono">Quét để tra cứu</p>
            </div>
          )}
        </footer>
      </article>

      {/* 3. SIGNATURE PAD MODAL (CLICK-TO-SIGN) */}
      {signPadOpen && (
        <SignaturePad
          open={signPadOpen}
          onClose={() => setSignPadOpen(false)}
          onConfirm={(dataUrl, pin) => {
            setSignPadOpen(false);
            handleExecuteAction("APPROVE", dataUrl, pin);
          }}
          userName={doc.currentUser?.name}
          userRoleTitle={currentRoleTitle}
          userProfileSignature={doc.userProfileSignature}
          title={`Ký duyệt số — ${doc.title}`}
          loading={isPending}
        />
      )}

      {/* 4. RETURN CORRECTION MODAL */}
      <Dialog
        open={returnDialogOpen}
        onClose={() => setReturnDialogOpen(false)}
        title="Trả hồ sơ yêu cầu bổ sung / sửa đổi"
        description="Ý kiến và nội dung yêu cầu sửa sẽ được gửi lại cho người lập."
      >
        <div className="space-y-4">
          <Textarea
            label="Nội dung cần sửa / Ý kiến trả hồ sơ"
            value={actionReason}
            onChange={e => setActionReason(e.target.value)}
            hint="Bắt buộc ghi rõ lý do hoặc nội dung cần người lập bổ sung."
            required
            rows={4}
          />
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button variant="secondary" onClick={() => setReturnDialogOpen(false)} disabled={isPending}>
              Hủy
            </Button>
            <Button
              variant="danger"
              onClick={() => handleExecuteAction("RETURN")}
              disabled={isPending || !actionReason.trim()}
              loading={isPending}
              loadingLabel="Đang xử lý…"
            >
              Xác nhận trả hồ sơ
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 5. REJECT MODAL */}
      <Dialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        title="Từ chối phê duyệt hồ sơ"
        description="Hồ sơ sẽ bị chuyển sang trạng thái từ chối."
      >
        <div className="space-y-4">
          <Textarea
            label="Lý do từ chối"
            value={actionReason}
            onChange={e => setActionReason(e.target.value)}
            hint="Bắt buộc ghi rõ lý do không chấp thuận hồ sơ."
            required
            rows={4}
          />
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button variant="secondary" onClick={() => setRejectDialogOpen(false)} disabled={isPending}>
              Hủy
            </Button>
            <Button
              variant="danger"
              onClick={() => handleExecuteAction("REJECT")}
              disabled={isPending || !actionReason.trim()}
              loading={isPending}
              loadingLabel="Đang từ chối…"
            >
              Xác nhận từ chối
            </Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
