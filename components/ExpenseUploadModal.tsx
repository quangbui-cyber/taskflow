"use client";

import { useState, useId, useTransition, useMemo } from "react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  CreditCard,
  Receipt,
  Loader2,
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge } from "@/components/ui/Presentation";
import { costFlowAction } from "@/app/actions/costflow";
import { displayMoney } from "@/lib/costflow/money";

type Props = {
  open: boolean;
  onClose: () => void;
  finance: Finance;
  currentUserId: string;
  preselectedLineId?: string;
  preselectedRecipientKey?: string;
  onSuccess?: () => void;
};

export default function ExpenseUploadModal({
  open,
  onClose,
  finance,
  currentUserId,
  preselectedLineId,
  preselectedRecipientKey,
  onSuccess,
}: Props) {
  const dialogId = useId();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const effective = finance.data.revisions.find(r => r.effective);

  // Form states
  const [description, setDescription] = useState("");
  const [lineId, setLineId] = useState(preselectedLineId || "");
  const [recipientKey, setRecipientKey] = useState(
    preselectedRecipientKey || `USER:${currentUserId}`
  );
  const [fundingSource, setFundingSource] = useState<"ADVANCE" | "OUT_OF_POCKET" | "VENDOR_DIRECT">("ADVANCE");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [basis, setBasis] = useState<"NET" | "GROSS">("GROSS");
  const [vatPercent, setVatPercent] = useState("8");
  const [spentAt, setSpentAt] = useState(() => new Date().toISOString().slice(0, 10));

  // Exception handling
  const [isException, setIsException] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");

  // Uploaded files states
  const [invoiceFile, setInvoiceFile] = useState<{ id: string; name: string; size: number } | null>(null);
  const [paymentFile, setPaymentFile] = useState<{ id: string; name: string; size: number } | null>(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [uploadingPayment, setUploadingPayment] = useState(false);

  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  const recipients = useMemo(() => [
    ...finance.project.members.map(m => ({
      value: `USER:${m.userId}`,
      label: `${usersMap.get(m.userId) ?? "Nhân viên"} (Nội bộ)`
    })),
    ...finance.data.beneficiaries.map(b => ({
      value: `VENDOR:${b.id}`,
      label: `${b.name} (NCC)`
    }))
  ], [finance.project.members, finance.data.beneficiaries, usersMap]);

  // Realtime calculated amounts
  const calculations = useMemo(() => {
    const q = parseFloat(quantity) || 0;
    const p = parseFloat(unitPrice.replace(/[^0-9]/g, "")) || 0;
    const vat = parseFloat(vatPercent) || 0;

    let net = 0;
    let gross = 0;
    let vatAmount = 0;

    if (basis === "NET") {
      net = q * p;
      vatAmount = net * (vat / 100);
      gross = net + vatAmount;
    } else {
      gross = q * p;
      if (vat > 0) {
        net = gross / (1 + vat / 100);
        vatAmount = gross - net;
      } else {
        net = gross;
        vatAmount = 0;
      }
    }

    return {
      net: Math.round(net),
      gross: Math.round(gross),
      vatAmount: Math.round(vatAmount),
    };
  }, [quantity, unitPrice, basis, vatPercent]);

  // Direct file uploader to /api/projects/[id]/files
  async function handleFileUpload(file: File, kind: "INVOICE" | "PAYMENT") {
    if (file.size > 4 * 1024 * 1024) {
      setError("Dung lượng file tối đa là 4 MiB.");
      return;
    }

    const setUploading = kind === "INVOICE" ? setUploadingInvoice : setUploadingPayment;
    const setTargetFile = kind === "INVOICE" ? setInvoiceFile : setPaymentFile;

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/projects/${finance.project.id}/files`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Không thể tải file lên.");
      }

      setTargetFile({
        id: data.file.id,
        name: data.file.name,
        size: data.file.size,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải file");
    } finally {
      setUploading(false);
    }
  }

  // Submit expense
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effective) {
      setError("Cần có ít nhất một bản IC hiệu lực làm baseline.");
      return;
    }
    if (!description.trim()) {
      setError("Vui lòng nhập nội dung khoản chi.");
      return;
    }
    if (!lineId) {
      setError("Vui lòng chọn dòng IC ngân sách nguồn.");
      return;
    }
    if (!unitPrice || calculations.gross <= 0) {
      setError("Vui lòng nhập số tiền chi hợp lệ.");
      return;
    }
    if (isException && !exceptionReason.trim()) {
      setError("Khoản chi không có hóa đơn bắt buộc phải nêu rõ lý do ngoại lệ.");
      return;
    }

    setError("");
    startTransition(async () => {
      const form = new FormData();
      form.append("projectId", finance.project.id);
      form.append("version", String(finance.version));
      form.append("command", "EXPENSE");
      form.append("revisionId", effective.id);
      form.append("lineId", lineId);
      form.append("recipientKey", recipientKey);
      form.append("description", description.trim());
      form.append("quantity", quantity);
      form.append("unitPrice", String(calculations.gross)); // store gross input
      form.append("basis", "GROSS");
      form.append("vatPercent", vatPercent);
      form.append("fundingSource", fundingSource);
      form.append("spentAt", spentAt);

      if (invoiceFile) form.append("invoiceFileId", invoiceFile.id);
      if (paymentFile) form.append("paymentFileId", paymentFile.id);
      if (isException && exceptionReason) form.append("exceptionReason", exceptionReason.trim());

      const res = await costFlowAction({}, form);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess("Đã ghi nhận chi phí AC thành công!");
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1200);
      }
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogId}
    >
      <div className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl p-6 sm:p-7 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-300">
              <Receipt size={22} aria-hidden="true" />
            </div>
            <div>
              <h2 id={dialogId} className="text-lg font-bold text-[var(--foreground)]">
                Báo chi phí thực tế & Upload chứng từ (AC)
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Các thành viên tải hóa đơn / UNC để ghi nhận Actual Cost và khấu trừ tiền tạm ứng.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface-soft)]"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {error && <Alert tone="danger" title={error} />}
        {success && <Alert tone="success" title={success} />}

        {!effective ? (
          <Alert tone="warning" title="Dự án chưa có IC hiệu lực">
            Chưa có IC nào được Quản lý duyệt để làm baseline ngân sách. Cần có IC hiệu lực trước khi ghi nhận AC.
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 1. KHỐI UPLOAD CHỨNG TỪ TRỰC TIẾP */}
            <div className="space-y-3 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)]/60">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)] flex items-center gap-1.5">
                  <UploadCloud size={15} className="text-[var(--primary)]" />
                  Tải lên hóa đơn & Bằng chứng thanh toán
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  Chụp ảnh hoặc chọn file PDF, JPG, PNG (tối đa 4 MiB)
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Slot 1: Hóa đơn VAT / Biên lai */}
                <div className="p-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] flex flex-col justify-between">
                  <div className="text-xs font-semibold text-[var(--foreground)] mb-1 flex items-center justify-between">
                    <span>1. Hóa đơn VAT / Biên lai</span>
                    {invoiceFile && <Badge tone="success">Đã tải lên</Badge>}
                  </div>
                  {invoiceFile ? (
                    <div className="flex items-center justify-between p-2 rounded bg-emerald-50 dark:bg-emerald-950/30 text-xs">
                      <span className="truncate font-medium text-emerald-800 dark:text-emerald-200" title={invoiceFile.name}>
                        {invoiceFile.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setInvoiceFile(null)}
                        className="text-rose-600 hover:text-rose-700 ml-2"
                        title="Xóa file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center p-3 cursor-pointer rounded hover:bg-[var(--surface-soft)] transition-colors">
                      {uploadingInvoice ? (
                        <div className="flex items-center gap-2 text-xs text-[var(--primary)]">
                          <Loader2 size={16} className="animate-spin" />
                          <span>Đang tải lên...</span>
                        </div>
                      ) : (
                        <>
                          <FileText size={20} className="text-[var(--text-secondary)] mb-1" />
                          <span className="text-xs font-medium text-[var(--primary)]">Chọn hoặc kéo file hóa đơn</span>
                          <span className="text-[10px] text-[var(--text-secondary)]">PDF, JPG, PNG</span>
                        </>
                      )}
                      <input
                        type="file"
                        className="sr-only"
                        accept=".pdf,.png,.jpg,.jpeg,.webp"
                        disabled={uploadingInvoice}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f, "INVOICE");
                        }}
                      />
                    </label>
                  )}
                </div>

                {/* Slot 2: UNC / Bằng chứng chuyển khoản / Ảnh bill */}
                <div className="p-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] flex flex-col justify-between">
                  <div className="text-xs font-semibold text-[var(--foreground)] mb-1 flex items-center justify-between">
                    <span>2. Bằng chứng chuyển khoản / UNC / Bill</span>
                    {paymentFile && <Badge tone="success">Đã tải lên</Badge>}
                  </div>
                  {paymentFile ? (
                    <div className="flex items-center justify-between p-2 rounded bg-emerald-50 dark:bg-emerald-950/30 text-xs">
                      <span className="truncate font-medium text-emerald-800 dark:text-emerald-200" title={paymentFile.name}>
                        {paymentFile.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPaymentFile(null)}
                        className="text-rose-600 hover:text-rose-700 ml-2"
                        title="Xóa file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center p-3 cursor-pointer rounded hover:bg-[var(--surface-soft)] transition-colors">
                      {uploadingPayment ? (
                        <div className="flex items-center gap-2 text-xs text-[var(--primary)]">
                          <Loader2 size={16} className="animate-spin" />
                          <span>Đang tải lên...</span>
                        </div>
                      ) : (
                        <>
                          <CreditCard size={20} className="text-[var(--text-secondary)] mb-1" />
                          <span className="text-xs font-medium text-[var(--primary)]">Chọn ảnh UNC hoặc bill chuyển khoản</span>
                          <span className="text-[10px] text-[var(--text-secondary)]">Ảnh chụp ngân hàng, phiếu chi</span>
                        </>
                      )}
                      <input
                        type="file"
                        className="sr-only"
                        accept=".pdf,.png,.jpg,.jpeg,.webp"
                        disabled={uploadingPayment}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f, "PAYMENT");
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* 2. THÔNG TIN KHOẢN CHI & NGUỒN TIỀN */}
            <div className="space-y-4">
              <Input
                label="Nội dung khoản chi"
                name="description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ví dụ: Mua 500 túi giấy in logo, Thuê xe ba gác chở đồ, Ăn trưa crew..."
                required
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Dòng IC ngân sách căn cứ"
                  name="lineId"
                  value={lineId}
                  onChange={e => setLineId(e.target.value)}
                  required
                >
                  <option value="">-- Chọn hạng mục trong IC-R{effective.number} --</option>
                  {effective.lines.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.description} ({l.cost ? displayMoney(l.cost.gross) : "—"})
                    </option>
                  ))}
                </Select>

                <Select
                  label="Người chi / Người thụ hưởng"
                  name="recipientKey"
                  value={recipientKey}
                  onChange={e => setRecipientKey(e.target.value)}
                  required
                >
                  {recipients.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </Select>
              </div>

              {/* NGUỒN TIỀN CHI (BẮT BUỘC ĐỂ THEO DÕI TẠM ỨNG) */}
              <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-2">
                <label className="block text-xs font-semibold text-[var(--foreground)]">
                  Hình thức chi tiền & Loại phiếu đề nghị
                </label>
                <div className="grid gap-2 sm:grid-cols-3 text-xs">
                  <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${fundingSource === "ADVANCE" ? "border-lime-500 bg-lime-50/60 dark:bg-lime-950/30 text-[var(--foreground)] font-semibold" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]"}`}>
                    <input
                      type="radio"
                      name="fundingSource"
                      value="ADVANCE"
                      checked={fundingSource === "ADVANCE"}
                      onChange={() => setFundingSource("ADVANCE")}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <div>
                      <span>Chi từ tiền tạm ứng</span>
                      <p className="text-[10px] font-normal text-[var(--text-secondary)] mt-0.5">
                        Khấu trừ vào quỹ tạm ứng (ĐNTU) nhân sự đã nhận
                      </p>
                    </div>
                  </label>

                  <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${fundingSource === "OUT_OF_POCKET" ? "border-amber-500 bg-amber-50/60 dark:bg-amber-950/30 text-[var(--foreground)] font-semibold" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]"}`}>
                    <input
                      type="radio"
                      name="fundingSource"
                      value="OUT_OF_POCKET"
                      checked={fundingSource === "OUT_OF_POCKET"}
                      onChange={() => setFundingSource("OUT_OF_POCKET")}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <div>
                      <span>Tự ứng tiền túi chi</span>
                      <p className="text-[10px] font-normal text-[var(--text-secondary)] mt-0.5">
                        Thu hồi qua <strong>Phiếu Hoàn Tạm Ứng (ĐNHTU)</strong>
                      </p>
                    </div>
                  </label>

                  <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all ${fundingSource === "VENDOR_DIRECT" ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/30 text-[var(--foreground)] font-semibold" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]"}`}>
                    <input
                      type="radio"
                      name="fundingSource"
                      value="VENDOR_DIRECT"
                      checked={fundingSource === "VENDOR_DIRECT"}
                      onChange={() => setFundingSource("VENDOR_DIRECT")}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <div>
                      <span>Chi trả thẳng NCC</span>
                      <p className="text-[10px] font-normal text-[var(--text-secondary)] mt-0.5">
                        Thanh toán qua <strong>Phiếu Đề Nghị Thanh Toán (ĐNTT)</strong>
                      </p>
                    </div>
                  </label>
                </div>

                <div className="mt-2.5 p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-secondary)] flex items-start gap-2">
                  <AlertCircle size={15} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-[var(--foreground)]">Quy tắc hiệu lực phiếu:</span>{" "}
                    Cả Phiếu Hoàn tạm ứng (ĐNHTU) và Phiếu Đề nghị thanh toán (ĐNTT) đều có thể tạo trước trong quá trình triển khai, nhưng <strong>chỉ có hiệu lực giải ngân thanh toán khi khoản chi AC tương ứng được phê duyệt</strong> đầy đủ.
                  </div>
                </div>
              </div>

              {/* 3. SỐ TIỀN & THUẾ */}
              <div className="grid gap-3 sm:grid-cols-4">
                <Input
                  label="Số lượng"
                  name="quantity"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  required
                  inputMode="decimal"
                />

                <Input
                  label="Số tiền (Đơn giá)"
                  name="unitPrice"
                  value={unitPrice}
                  onChange={e => setUnitPrice(e.target.value)}
                  placeholder="Ví dụ: 12500000"
                  required
                  inputMode="numeric"
                />

                <Select
                  label="Cơ sở tính giá"
                  name="basis"
                  value={basis}
                  onChange={e => setBasis(e.target.value as "NET" | "GROSS")}
                >
                  <option value="GROSS">Đã gồm VAT (Gross)</option>
                  <option value="NET">Chưa gồm VAT (Net)</option>
                </Select>

                <Select
                  label="Thuế suất VAT"
                  name="vatPercent"
                  value={vatPercent}
                  onChange={e => setVatPercent(e.target.value)}
                >
                  <option value="8">8%</option>
                  <option value="10">10%</option>
                  <option value="0">0%</option>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  type="date"
                  label="Ngày phát sinh chi phí"
                  name="spentAt"
                  value={spentAt}
                  onChange={e => setSpentAt(e.target.value)}
                />
              </div>

              {/* TÍNH TOÁN REALTIME TỔNG KẾT */}
              <div className="flex flex-wrap items-center justify-between gap-4 p-3.5 rounded-xl bg-[var(--surface-soft)] border border-[var(--border)] text-xs">
                <div>
                  <span className="text-[var(--text-secondary)] block">Trước VAT (Net)</span>
                  <span className="font-mono font-bold text-sm text-[var(--foreground)]">
                    {displayMoney(String(calculations.net))}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-secondary)] block">Tiền VAT ({vatPercent}%)</span>
                  <span className="font-mono font-medium text-sm text-[var(--text-secondary)]">
                    {displayMoney(String(calculations.vatAmount))}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[var(--text-secondary)] block">Tổng thanh toán (Gross)</span>
                  <span className="font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">
                    {displayMoney(String(calculations.gross))}
                  </span>
                </div>
              </div>

              {/* 4. NGOẠI LỆ CHI PHÍ (KHÔNG CÓ HÓA ĐƠN VAT) */}
              <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={isException}
                    onChange={e => setIsException(e.target.checked)}
                    className="accent-[var(--primary)] rounded"
                  />
                  <span>Khoản chi không có hóa đơn VAT (Chi tiền mặt nhỏ lẻ, xe ôm, bốc vác...)</span>
                </label>

                {isException && (
                  <div className="pt-2 animate-in fade-in space-y-2">
                    <Textarea
                      label="Lý do chi phí không có hóa đơn VAT"
                      placeholder="Giải trình cụ thể: chi phí phát sinh khẩn cấp tại hiện trường, nhà cung cấp cá nhân không xuất hóa đơn..."
                      value={exceptionReason}
                      onChange={e => setExceptionReason(e.target.value)}
                      required={isException}
                    />
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      Khoản chi ngoại lệ sẽ được đánh dấu <strong>Chờ duyệt ngoại lệ</strong> và cần Kế toán / Quản lý xác nhận trước khi đưa vào quyết toán hoàn ứng.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border)]">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
                Hủy bỏ
              </Button>
              <Button type="submit" loading={isPending} loadingLabel="Đang lưu...">
                <CheckCircle2 size={16} className="mr-1.5" />
                Lưu khoản chi AC
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
