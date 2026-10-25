"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Info, Upload, X, XCircle } from "lucide-react";
import { useInteraction } from "@/components/InteractionProvider";
import { costAmount, formatMargin, formatVndNumber, sellAmount } from "@/lib/financeCalc";
import { financeHeaderRows } from "@/lib/financeHeader";
import type { FinanceImportResult, ImportSeverity } from "@/lib/financeImport";
import { MAX_PROJECT_FILE_SIZE } from "@/lib/projectFiles";
import { formatFileSize, postFormWithProgress } from "@/lib/uploadWithProgress";
import { slimXlsx, type SlimResult } from "@/lib/xlsxSlim";

type Preview = {
  fileName: string;
  result: FinanceImportResult;
  existing: { locked: boolean; sections: number } | null;
};

const SEVERITY: Record<ImportSeverity, { label: string; className: string; Icon: typeof Info }> = {
  error: { label: "Lỗi", className: "border-red-200 bg-red-50 text-red-800", Icon: XCircle },
  warning: { label: "Cảnh báo", className: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
  info: { label: "Gợi ý", className: "border-sky-200 bg-sky-50 text-sky-900", Icon: Info },
};

// File gốc lớn hơn mức này thì không làm gọn trên trình duyệt (tránh treo máy).
const MAX_ORIGINAL_SIZE = 30 * 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 60_000;
const SAVE_TIMEOUT_MS = 120_000;

type Stage = "idle" | "slimming" | "uploading" | "reading" | "saving";

async function postFile(
  projectId: string,
  file: File,
  confirm: boolean,
  callbacks: { onProgress: (value: number) => void; onUploaded: () => void },
) {
  const body = new FormData();
  body.append("file", file);
  if (confirm) body.append("confirm", "1");
  const response = await postFormWithProgress<Partial<Preview>>(`/api/projects/${projectId}/finance/import`, body, {
    ...callbacks,
    timeoutMs: confirm ? SAVE_TIMEOUT_MS : PREVIEW_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw new Error(
      response.data.error ||
        (response.status === 413
          ? "File quá lớn để gửi lên. Bỏ bớt ảnh hoặc sheet không cần rồi thử lại."
          : response.status === 504
            ? "Máy chủ xử lý quá lâu. Thử lại sau ít phút."
            : "Không đọc được file. Vui lòng thử lại."),
    );
  }
  return response.data;
}

export default function ImportFinanceDialog({
  projectId,
  variant = "secondary",
}: {
  projectId: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [uploadSize, setUploadSize] = useState(0);
  const [slim, setSlim] = useState<SlimResult | null>(null);
  // Lưu file gốc (đủ ảnh) vào Tài liệu, hay bản đã bỏ ảnh cho nhanh.
  const [keepOriginal, setKeepOriginal] = useState(true);
  const pending = stage !== "idle";

  function close() {
    if (pending) return;
    setOpen(false);
    setFile(null);
    setSlim(null);
    setPreview(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  const uploadCallbacks = (next: Stage) => ({
    onProgress: setProgress,
    onUploaded: () => setStage(next),
  });

  async function readFile(selected: File) {
    setFile(selected);
    setSlim(null);
    setPreview(null);
    setError("");
    if (!selected.name.toLowerCase().endsWith(".xlsx")) {
      setError("Chỉ nhận file .xlsx. File .xls đời cũ hãy mở bằng Excel và lưu lại thành .xlsx.");
      return;
    }
    if (selected.size > MAX_ORIGINAL_SIZE) {
      setError(`File lớn quá (${formatFileSize(selected.size)}). Hãy lưu một bản chỉ giữ sheet IC/AC rồi thử lại.`);
      return;
    }
    try {
      setStage("slimming");
      // Không làm gọn được (vd file đặt mật khẩu) thì gửi nguyên file để máy chủ báo lỗi cụ thể.
      const slimmed = await slimXlsx(selected).catch(
        (): SlimResult => ({ file: selected, originalSize: selected.size, slimSize: selected.size, removedImages: 0 }),
      );
      if (slimmed.file.size > MAX_PROJECT_FILE_SIZE) {
        throw new Error(
          `Sau khi bỏ ảnh file vẫn còn ${formatFileSize(slimmed.file.size)} (tối đa 4 MB). Hãy lưu một bản chỉ giữ sheet IC/AC.`,
        );
      }
      setSlim(slimmed);
      setKeepOriginal(selected.size <= MAX_PROJECT_FILE_SIZE);
      setProgress(0);
      setUploadSize(slimmed.file.size);
      setStage("uploading");
      const data = await postFile(projectId, slimmed.file, false, uploadCallbacks("reading"));
      setPreview(data as Preview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không đọc được file.");
    } finally {
      setStage("idle");
    }
  }

  async function confirmImport() {
    if (!file || !slim || !preview) return;
    const original = slim.removedImages > 0 && keepOriginal && file.size <= MAX_PROJECT_FILE_SIZE;
    const toSend = original ? file : slim.file;
    setError("");
    setProgress(0);
    setUploadSize(toSend.size);
    setStage("uploading");
    try {
      // Bản gọn đã gửi ở bước xem trước rất nhẹ nên gửi lại gần như tức thì;
      // chỉ khi chọn lưu file gốc thì mới gửi file đầy đủ ảnh, đúng một lần.
      await postFile(projectId, toSend, true, uploadCallbacks("saving"));
      notify({ message: "Đã nhập IC từ file. File được lưu ở tab Tài liệu.", tone: "success" });
      setStage("idle");
      setOpen(false);
      setFile(null);
      setSlim(null);
      setPreview(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không lưu được IC.");
      setStage("idle");
    }
  }

  const result = preview?.result;
  const lineCount = result?.sections.reduce((sum, section) => sum + section.lines.length, 0) ?? 0;
  const costCount =
    result?.sections.reduce(
      (sum, section) => sum + section.lines.reduce((inner, line) => inner + line.costs.length, 0),
      0,
    ) ?? 0;
  const errorCount = result?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const warningCount = result?.issues.filter((issue) => issue.severity === "warning").length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={variant === "primary" ? "tf-button-primary" : "tf-button-secondary"}
      >
        <FileSpreadsheet size={16} aria-hidden="true" />
        Nhập từ Excel
      </button>

      {open && (
        <div
          className="tf-overlay-enter fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-4 backdrop-blur-[2px] sm:p-8"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-finance-title"
            onClick={(event) => event.stopPropagation()}
            className="tf-modal-enter my-auto w-full max-w-4xl space-y-5 rounded-[10px] border border-zinc-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="import-finance-title" className="text-lg font-semibold">
                  Nhập IC từ file Excel
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  App đọc file theo tiêu đề cột (HẠNG MỤC, ĐVT, ĐƠN GIÁ…), tự tính lại mọi số và chỉ ra chỗ sai. Chưa lưu gì cho tới khi bạn bấm xác nhận.
                </p>
              </div>
              <button type="button" onClick={close} className="tf-icon-button !h-9 !min-h-9 !w-9" aria-label="Đóng">
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[8px] border-2 border-dashed border-brand-300 bg-brand-50/40 px-4 py-6 text-center">
              <Upload size={24} className="text-brand-700" aria-hidden="true" />
              <span className="text-sm font-semibold">
                {file ? file.name : "Chọn file IC hoặc AC (.xlsx)"}
              </span>
              <span className="text-xs text-zinc-500">
                Ảnh dán trong file được bỏ tự động trước khi gửi cho nhanh · File đặt mật khẩu cần bỏ mật khẩu trước
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                disabled={pending}
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) readFile(selected);
                }}
              />
            </label>

            {pending && !preview && <UploadProgress stage={stage} progress={progress} size={uploadSize} />}
            {error && !preview && (
              <p role="alert" className="rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            {result && preview && (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600">
                  <span>Sheet: <b className="text-zinc-900">{result.sheetName}</b></span>
                  <span>{result.sections.length} nhóm · {lineCount} hạng mục · {costCount} dòng chi phí</span>
                  {slim && slim.removedImages > 0 && (
                    <span className="text-zinc-500">
                      Đã bỏ {slim.removedImages} ảnh trước khi gửi: {formatFileSize(slim.originalSize)} → {formatFileSize(slim.slimSize)}
                    </span>
                  )}
                  {result.hasAcceptance && (
                    <span className="text-zinc-500">
                      File có khối Nghiệm thu/AC{result.acCostTotal !== null ? ` (AC ${formatVndNumber(result.acCostTotal)})` : ""} — sẽ dùng khi làm phần AC
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-zinc-200 bg-zinc-200 sm:grid-cols-4">
                  {[
                    ["Giá bán trước VAT", formatVndNumber(result.totals.sellSubtotal)],
                    ["Giá vốn trước VAT", formatVndNumber(result.totals.costSubtotal)],
                    ["Lợi nhuận", formatVndNumber(result.totals.profit)],
                    ["Margin", formatMargin(result.totals.margin)],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-white px-4 py-3">
                      <div className="text-xs text-zinc-500">{label}</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>

                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {financeHeaderRows({
                    clientName: result.header.clientName,
                    programName: result.header.programName,
                    headcount: result.header.headcount,
                    location: result.header.location,
                    eventStart: result.header.eventStart ? new Date(`${result.header.eventStart}T00:00:00+07:00`) : null,
                    eventEnd: result.header.eventEnd ? new Date(`${result.header.eventEnd}T00:00:00+07:00`) : null,
                  }).map((row) => (
                    <div key={row.key} className="flex gap-2">
                      <dt className="text-zinc-500">{row.label}:</dt>
                      <dd className="font-medium">{row.value}</dd>
                    </div>
                  ))}
                </dl>

                <section aria-labelledby="import-issues-title" className="space-y-2">
                  <h3 id="import-issues-title" className="text-sm font-semibold">
                    Kết quả kiểm tra: {errorCount} lỗi · {warningCount} cảnh báo · {result.issues.length - errorCount - warningCount} gợi ý
                  </h3>
                  {result.issues.length === 0 && (
                    <p className="text-sm text-emerald-700">Không thấy lỗi nào. Mọi phép tính khớp với file.</p>
                  )}
                  <ul className="space-y-2">
                    {result.issues.map((issue, index) => {
                      const style = SEVERITY[issue.severity];
                      return (
                        <li key={`${issue.code}-${index}`} className={`flex gap-2 rounded-[8px] border px-3 py-2 text-sm ${style.className}`}>
                          <style.Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                          <div className="min-w-0">
                            <div className="font-semibold">
                              <span className="sr-only">{style.label}: </span>
                              {issue.title}
                            </div>
                            {issue.detail && <div className="mt-0.5 opacity-90">{issue.detail}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {result.unmatchedSuppliers.length > 0 && (
                    <p className="text-xs text-zinc-600">
                      Muốn tự gắn nhà cung cấp khi nhập?{" "}
                      <Link href="/suppliers" target="_blank" className="font-semibold text-brand-800 underline-offset-2 hover:underline">
                        Thêm {result.unmatchedSuppliers.join(", ")} vào danh bạ
                      </Link>{" "}
                      (dùng đúng tên ghi ở cột SUP làm tên gọi tắt), rồi chọn lại file.
                    </p>
                  )}
                </section>

                <div className="overflow-x-auto rounded-[8px] border border-zinc-200">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Hạng mục</th>
                        <th className="px-3 py-2 text-right font-semibold">Bán</th>
                        <th className="px-3 py-2 text-right font-semibold">Vốn</th>
                        <th className="px-3 py-2 font-semibold">Nhà cung cấp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.sections.map((section) => (
                        <FragmentRows key={section.name} section={section} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {preview.existing?.locked ? (
                  <p className="rounded-[8px] bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    IC của dự án đang chờ duyệt hoặc đã duyệt nên không nhập đè được.
                  </p>
                ) : preview.existing && preview.existing.sections > 0 ? (
                  <p className="rounded-[8px] bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Dự án đã có IC bản nháp. Nhập file này sẽ <b>thay toàn bộ</b> nội dung IC hiện tại.
                  </p>
                ) : null}

                {slim && slim.removedImages > 0 && !preview.existing?.locked && (
                  <label className="flex items-start gap-2.5 rounded-[8px] border border-zinc-200 px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-brand-700"
                      checked={keepOriginal && slim.originalSize <= MAX_PROJECT_FILE_SIZE}
                      disabled={pending || slim.originalSize > MAX_PROJECT_FILE_SIZE}
                      onChange={(event) => setKeepOriginal(event.target.checked)}
                    />
                    <span>
                      <span className="font-medium">
                        Lưu file gốc đủ {slim.removedImages} ảnh ({formatFileSize(slim.originalSize)}) vào tab Tài liệu
                      </span>
                      <span className="block text-zinc-500">
                        {slim.originalSize > MAX_PROJECT_FILE_SIZE
                          ? `File gốc lớn hơn 4 MB nên chỉ lưu được bản đã bỏ ảnh (${formatFileSize(slim.slimSize)}).`
                          : `Bỏ chọn để lưu bản đã bỏ ảnh (${formatFileSize(slim.slimSize)}) — lưu nhanh hơn, số liệu giống hệt.`}
                      </span>
                    </span>
                  </label>
                )}

                {pending && <UploadProgress stage={stage} progress={progress} size={uploadSize} />}
                {error && (
                  <p role="alert" className="rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={close} disabled={pending} className="tf-button-secondary">
                    Huỷ
                  </button>
                  <button
                    type="button"
                    onClick={confirmImport}
                    disabled={pending || Boolean(preview.existing?.locked)}
                    aria-busy={pending}
                    className="tf-button-primary"
                  >
                    {pending && <span className="tf-spinner" aria-hidden="true" />}
                    {preview.existing && preview.existing.sections > 0 ? "Thay IC bằng file này" : "Tạo IC từ file này"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function FragmentRows({ section }: { section: FinanceImportResult["sections"][number] }) {
  return (
    <>
      <tr className="border-t border-zinc-200 bg-zinc-50/70">
        <td colSpan={4} className="px-3 py-2 text-xs font-semibold">{section.name}</td>
      </tr>
      {section.lines.map((line) => (
        <tr key={`${line.row}`} className="border-t border-zinc-100 align-top">
          <td className="px-3 py-2">
            <span className="text-zinc-500">{line.stt ? `${line.stt}. ` : ""}</span>
            {line.name}
            {line.costs.some((cost) => cost.description) && (
              <ul className="mt-1 space-y-0.5 text-xs text-zinc-500">
                {line.costs.filter((cost) => cost.description).map((cost) => (
                  <li key={cost.row}>↳ {cost.description}</li>
                ))}
              </ul>
            )}
          </td>
          <td className="px-3 py-2 text-right tabular-nums">
            {line.unitPrice === null ? <span className="text-zinc-400">–</span> : formatVndNumber(sellAmount(line))}
          </td>
          <td className="px-3 py-2 text-right tabular-nums">
            {formatVndNumber(line.costs.reduce((sum, cost) => sum + costAmount(cost), 0))}
          </td>
          <td className="px-3 py-2 text-xs">
            {[...new Set(line.costs.map((cost) => cost.supplierName).filter(Boolean))].join(", ") || (
              <span className="text-zinc-400">—</span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

function UploadProgress({ stage, progress, size }: { stage: Stage; progress: number; size: number }) {
  if (stage === "slimming" || stage === "reading" || stage === "saving") {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-600" aria-live="polite">
        <span className="tf-spinner" aria-hidden="true" />
        {stage === "slimming"
          ? "Đang làm gọn file (bỏ ảnh)…"
          : stage === "reading"
            ? "Đã gửi xong, máy chủ đang đọc file…"
            : "Đã gửi xong, đang lưu IC…"}
      </p>
    );
  }
  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex justify-between text-sm text-zinc-600">
        <span>Đang tải lên {formatFileSize(size)}…</span>
        <span className="tabular-nums">{progress}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Tiến độ tải file lên"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="h-2 overflow-hidden rounded-full bg-zinc-100"
      >
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-200" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
