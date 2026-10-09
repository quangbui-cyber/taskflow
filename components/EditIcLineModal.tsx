"use client";

import { useState, useMemo } from "react";
import {
  Building2,
  Calculator,
  Trash2,
  FileSpreadsheet,
  CreditCard,
  Plus,
  TrendingUp,
  Layers3,
  Copy,
  Info,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import type { Finance, Request } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Badge, Alert } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";
import ActionForm from "@/components/CostFlowActionForm";
import { calculateLineCost, calculateMargin, displayMoney } from "@/lib/costflow/money";
import { matchIcLineToQuotation } from "@/lib/costflow/budgetQuotation";
import type { IcLine, IcRevision } from "@/lib/costflow/types";
import Link from "next/link";

type Props = {
  open: boolean;
  onClose: () => void;
  line: IcLine | null; // null means create new line
  revision: IcRevision;
  request: Request | undefined;
  finance: Finance;
  isEditableDraft: boolean;
  worksheetHref: string;
};

export default function EditIcLineModal({
  open,
  onClose,
  line,
  revision,
  request,
  finance,
  isEditableDraft,
  worksheetHref,
}: Props) {
  const isCreateMode = !line;
  const quotations = useMemo(() => finance.data.quotations || [], [finance.data.quotations]);
  const beneficiaries = useMemo(() => finance.data.beneficiaries || [], [finance.data.beneficiaries]);
  const [fallbackId] = useState(() => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "line-temp"));

  // 1. Initial matching with Quotation
  const initialMatch = useMemo(() => {
    if (!line) return null;
    return matchIcLineToQuotation(line, quotations, revision.quotationId);
  }, [line, quotations, revision.quotationId]);

  const initialQuoteQty = initialMatch?.line?.quantity || initialMatch?.salesRow?.sell?.quantity || "";
  const initialQuoteUnit = initialMatch?.line?.unit || initialMatch?.salesRow?.sell?.unit || "";

  // Quotation binding state
  const [selectedQuotationId, setSelectedQuotationId] = useState<string>(
    line?.quotationId ?? initialMatch?.quotation.id ?? (quotations.slice(-1)[0]?.id ?? "")
  );
  const [selectedQuotationLineId, setSelectedQuotationLineId] = useState<string>(
    line?.quotationLineId ?? initialMatch?.line.id ?? ""
  );

  // Local state for IC fields (auto-inherit quantity and unit if empty)
  const [description, setDescription] = useState(line?.description ?? "");
  const [unit, setUnit] = useState(line?.unit?.trim() ? line.unit : (initialQuoteUnit || "Gói"));
  const [quantity, setQuantity] = useState(line?.quantity?.trim() ? line.quantity : (initialQuoteQty || "1"));
  const [days, setDays] = useState(line?.days ?? "1");
  const [unitPrice, setUnitPrice] = useState(line?.unitPrice ?? "");
  const [basis, setBasis] = useState<"NET" | "GROSS">((line?.basis as "NET" | "GROSS") || "NET");
  const [vatPercent, setVatPercent] = useState(line?.vatPercent ?? "8");
  const [vendorId, setVendorId] = useState(line?.vendorId ?? "");
  const [internalNotes, setInternalNotes] = useState(line?.internalNotes ?? "");
  const [evidenceReason] = useState(line?.evidenceReason ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copyNotice, setCopyNotice] = useState(false);

  // Find active matched quotation and quotation line
  const activeQuote = useMemo(() => {
    return quotations.find((q) => q.id === selectedQuotationId) || quotations.slice(-1)[0];
  }, [quotations, selectedQuotationId]);

  const activeQuoteLine = useMemo(() => {
    if (!activeQuote || !selectedQuotationLineId) return null;
    return activeQuote.lines.find((l) => l.id === selectedQuotationLineId) || null;
  }, [activeQuote, selectedQuotationLineId]);

  const isAutoInheritedQty = !line?.quantity?.trim() && !!quantity && (quantity === initialQuoteQty || quantity === activeQuoteLine?.quantity);
  const isAutoInheritedUnit = !line?.unit?.trim() && !!unit && (unit === initialQuoteUnit || unit === activeQuoteLine?.unit);

  // Handle Quotation line selection change: automatically transfers quantity and unit
  const handleQuotationLineSelect = (value: string) => {
    if (!value) {
      setSelectedQuotationLineId("");
      return;
    }
    const [qId, qLineId] = value.split("::");
    setSelectedQuotationId(qId);
    setSelectedQuotationLineId(qLineId);

    const foundQuote = quotations.find((q) => q.id === qId);
    const foundLine = foundQuote?.lines.find((l) => l.id === qLineId);
    const foundSalesRow = foundQuote?.salesRows?.find((r) => r.quotationLineId === qLineId || r.itemId === line?.itemId);
    const newQty = foundLine?.quantity || foundSalesRow?.sell?.quantity || "";
    const newUnit = foundLine?.unit || foundSalesRow?.sell?.unit || "";

    if (foundLine && !description.trim()) {
      setDescription(foundLine.description);
    }
    // Tự động chuyển số lượng và ĐVT từ dòng Báo giá mới
    if (newQty && (!quantity.trim() || quantity === "1" || isAutoInheritedQty)) {
      setQuantity(newQty);
    }
    if (newUnit && (!unit.trim() || unit === "Gói" || isAutoInheritedUnit)) {
      setUnit(newUnit);
    }
  };

  // Quick sync from quotation line to IC inputs
  const handleSyncFromQuotation = () => {
    if (!activeQuoteLine) return;
    if (activeQuoteLine.quantity) setQuantity(activeQuoteLine.quantity);
    if (activeQuoteLine.unit) setUnit(activeQuoteLine.unit);
    setCopyNotice(true);
    setTimeout(() => setCopyNotice(false), 2500);
  };

  // Live Cost Calculation for IC (Buy side)
  const liveCost = useMemo(() => {
    try {
      if (!quantity || !unitPrice || parseFloat(quantity) <= 0 || parseFloat(unitPrice) < 0) {
        return null;
      }
      return calculateLineCost({
        quantity: String(quantity),
        days: String(days),
        unitPrice: String(unitPrice),
        basis,
        vatPercent: vatPercent || "0",
      });
    } catch {
      return null;
    }
  }, [quantity, days, unitPrice, basis, vatPercent]);

  // Live Margin Calculation (Comparing Sell vs Buy)
  const liveMargin = useMemo(() => {
    if (!activeQuoteLine?.cost || !liveCost) return null;
    return calculateMargin(activeQuoteLine.cost, liveCost);
  }, [activeQuoteLine, liveCost]);

  // Prepared Lines for Save
  const preparedLines = useMemo(() => {
    const cost = liveCost
      ? {
          net: liveCost.net,
          vat: liveCost.vat,
          gross: liveCost.gross,
          rawNet: liveCost.rawNet,
          rawVat: liveCost.rawVat,
          rawGross: liveCost.rawGross,
        }
      : null;

    const finalQuantity = quantity.trim() || activeQuoteLine?.quantity || initialQuoteQty || "0";
    const finalUnit = unit.trim() || activeQuoteLine?.unit || initialQuoteUnit || "";

    const newLineData: IcLine = {
      id: line ? line.id : fallbackId,
      description: description.trim(),
      unit: finalUnit,
      quantity: finalQuantity,
      days,
      unitPrice: String(unitPrice || "0"),
      basis,
      vatPercent: String(vatPercent || "0"),
      cost,
      vendorId: vendorId || undefined,
      internalNotes: internalNotes.trim() || undefined,
      evidenceReason: evidenceReason.trim() || undefined,
      evidenceIds: line?.evidenceIds || [],
      itemId: line?.itemId ?? activeQuoteLine?.id,
      parameterBinding: line?.parameterBinding,
      quotationId: selectedQuotationLineId ? selectedQuotationId : undefined,
      quotationLineId: selectedQuotationLineId ? selectedQuotationLineId : undefined,
    };

    if (isCreateMode) {
      return [...revision.lines, newLineData];
    } else {
      return revision.lines.map((l) => {
        if (l.id === line.id) return newLineData;
        // Auto-inherit missing quantity & unit from quotation for other lines
        const qMatch = matchIcLineToQuotation(l, quotations, revision.quotationId);
        const qQty = qMatch?.line?.quantity || qMatch?.salesRow?.sell?.quantity || "";
        const qUnit = qMatch?.line?.unit || qMatch?.salesRow?.sell?.unit || "";
        const autoQty = !l.quantity?.trim() && qQty ? qQty : l.quantity;
        const autoUnit = !l.unit?.trim() && qUnit ? qUnit : l.unit;
        let lineCost = l.cost;
        if (!lineCost && autoQty && l.unitPrice?.trim()) {
          try {
            lineCost = calculateLineCost({
              quantity: autoQty,
              days: l.days || "1",
              unitPrice: l.unitPrice,
              basis: l.basis || "NET",
              vatPercent: l.vatPercent || "8",
            });
          } catch {
            lineCost = null;
          }
        }
        return {
          ...l,
          quantity: autoQty,
          unit: autoUnit,
          cost: lineCost,
          quotationId: l.quotationId || qMatch?.quotation.id,
          quotationLineId: l.quotationLineId || qMatch?.line.id,
        };
      });
    }
  }, [
    revision.lines,
    line,
    isCreateMode,
    description,
    unit,
    quantity,
    unitPrice,
    basis,
    vatPercent,
    vendorId,
    internalNotes,
    evidenceReason,
    liveCost,
    selectedQuotationId,
    selectedQuotationLineId,
    activeQuoteLine,
    initialQuoteQty,
    initialQuoteUnit,
    quotations,
    revision.quotationId,
    fallbackId,
  ]);

  // Prepared Lines for Delete
  const deletedLines = useMemo(() => {
    if (!line) return [];
    return revision.lines.filter((l) => l.id !== line.id);
  }, [revision.lines, line]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="tf-dialog-wide"
      title={
        isCreateMode
          ? `Thêm Hạng Mục Mới vào IC-R${revision.number}`
          : `Chỉnh Sửa Hạng Mục: ${line?.description || description}`
      }
      description={
        isEditableDraft
          ? "Chỉnh sửa số lượng, đơn giá mua, đối chiếu Báo giá bán song song, chỉ định Nhà Cung Cấp và tính toán lợi nhuận."
          : `Bản IC-R${revision.number} là Baseline hiệu lực hoặc đã gửi duyệt; không thể sửa trực tiếp số liệu tại đây.`
      }
    >
      <div className="tf-edit-ic-line-modal">
        {!isEditableDraft ? (
          <div className="space-y-4">
            <Alert tone="warning" title="Baseline hiệu lực được bảo vệ">
              Bản IC này đã được Quản lý phê duyệt làm ngân sách chính thức của dự án. Để thay đổi số
              tiền hoặc hạng mục, vui lòng tạo một Revision điều chỉnh mới để giữ tính toàn vẹn kiểm toán.
            </Alert>

            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-3">
              <h4 className="text-sm font-semibold text-[var(--foreground)]">Thông tin hiện tại:</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[var(--text-secondary)]">Hạng mục:</span>{" "}
                  <strong>{line?.description}</strong>
                </div>
                <div>
                  <span className="text-[var(--text-secondary)]">Khối lượng:</span>{" "}
                  <strong>{line?.quantity} {line?.unit}</strong>
                </div>
                <div>
                  <span className="text-[var(--text-secondary)]">Đơn giá mua:</span>{" "}
                  <strong>{line?.unitPrice} ({line?.basis})</strong>
                </div>
                <div>
                  <span className="text-[var(--text-secondary)]">Chi phí Gross:</span>{" "}
                  <strong className="text-[#587216]">
                    {line?.cost ? displayMoney(line.cost.gross) : "—"}
                  </strong>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-[var(--border)]">
              <Button variant="secondary" onClick={onClose}>
                Đóng
              </Button>
              <Link className="tf-button-primary text-sm flex items-center gap-1.5" href={worksheetHref}>
                <Plus size={15} />
                Tạo Revision điều chỉnh mới (Worksheet)
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* ═══════════ TOP HELPER: LIÊN KẾT TRÌNH CHỈNH SỬA SONG SONG ═══════════ */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-gradient-to-r from-[var(--surface-soft)] to-[var(--surface)] border border-[var(--border)] shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#587216]/10 text-[#587216] flex items-center justify-center shrink-0">
                  <Layers3 size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--foreground)]">
                      Trình Chỉnh Sửa Song Song (Paired Worksheet)
                    </span>
                    {activeQuoteLine ? (
                      <Badge tone="success" className="text-[11px] py-0 px-2">
                        Đã khớp BG-{activeQuote?.number}
                      </Badge>
                    ) : (
                      <Badge tone="neutral" className="text-[11px] py-0 px-2">
                        Chi phí nội bộ độc lập
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    Quản lý song song Báo giá (bán cho khách) và Dự toán IC (mua nội bộ) trên cùng một bảng tính toàn diện.
                  </p>
                </div>
              </div>

              <Link
                className="tf-button-secondary text-xs flex items-center gap-1.5 py-1.5 px-3 shrink-0 font-medium hover:border-[#587216] hover:text-[#587216] transition-colors"
                href={worksheetHref}
                target="_blank"
                rel="noopener noreferrer"
                title="Mở Bảng tính toàn màn hình để chỉnh sửa song song cả 2 bảng Báo giá và IC"
              >
                <FileSpreadsheet size={14} className="text-[#587216]" />
                <span>Mở Worksheet toàn màn hình</span>
                <ExternalLink size={12} className="opacity-60" />
              </Link>
            </div>

            {/* ═══════════ MAIN FORM (ACTIONFORM) ═══════════ */}
            <ActionForm
              finance={finance}
              command="SAVE_IC"
              requestId={revision.requestId}
              label={isCreateMode ? "Thêm vào dự toán IC" : "Lưu thay đổi hạng mục"}
              onSuccess={onClose}
            >
              {/* Hidden required inputs for SAVE_IC */}
              <input type="hidden" name="requestId" value={revision.requestId} />
              <input type="hidden" name="title" value={request?.title ?? `IC-R${revision.number}`} />
              <input type="hidden" name="lines" value={JSON.stringify(preparedLines)} />
              {revision.poIds.map((id) => (
                <input key={`po-${id}`} type="hidden" name="poIds" value={id} />
              ))}
              {(revision.briefIds ?? []).map((id) => (
                <input key={`brief-${id}`} type="hidden" name="briefIds" value={id} />
              ))}
              {(revision.evidenceIds ?? []).map((id) => (
                <input key={`ev-${id}`} type="hidden" name="evidenceIds" value={id} />
              ))}

              <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
                {/* ═══════════ 2-COLUMN PARALLEL LAYOUT: BÁO GIÁ (SELL) vs IC (BUY) ═══════════ */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* ────────────────── CỘT TRÁI: BÁO GIÁ BÁN CHO KHÁCH HÀNG ────────────────── */}
                  <div className="lg:col-span-5 flex flex-col justify-between p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)]/60 space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">
                            Báo Giá Bán (Khách hàng)
                          </h4>
                        </div>
                        <Badge tone="info" className="text-[10px]">
                          Sell Side
                        </Badge>
                      </div>

                      {/* Dropdown mapping to quotation line */}
                      <div>
                        <label className="text-xs font-medium text-[var(--text-secondary)] block mb-1">
                          Liên kết dòng Báo giá song song:
                        </label>
                        <Select
                          value={
                            selectedQuotationLineId
                              ? `${selectedQuotationId}::${selectedQuotationLineId}`
                              : ""
                          }
                          onChange={(e) => handleQuotationLineSelect(e.target.value)}
                          className="w-full text-xs"
                        >
                          <option value="">-- Chi phí nội bộ độc lập (Không qua Báo giá) --</option>
                          {quotations.map((q) => (
                            <optgroup key={q.id} label={`BG-${q.number}: ${q.title || "Báo giá"}`}>
                              {q.lines.map((ql, idx) => (
                                <option key={ql.id} value={`${q.id}::${ql.id}`}>
                                  #{idx + 1}: {ql.description} ({displayMoney(ql.unitPrice)})
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                      </div>

                      {/* Thông tin chi tiết của dòng Báo giá khách */}
                      {activeQuoteLine ? (
                        <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 block">
                                BG-{activeQuote?.number} · {activeQuote?.customer || "Khách hàng"}
                              </span>
                              <p className="text-xs font-medium text-[var(--foreground)] mt-0.5">
                                {activeQuoteLine.description}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-blue-100 dark:border-blue-900/40">
                            <div>
                              <span className="text-[var(--text-secondary)] block text-[11px]">
                                Khối lượng bán:
                              </span>
                              <strong className="text-[var(--foreground)]">
                                {activeQuoteLine.quantity} {activeQuoteLine.unit}
                              </strong>
                            </div>

                            <div>
                              <span className="text-[var(--text-secondary)] block text-[11px]">
                                Đơn giá bán ({activeQuoteLine.basis}):
                              </span>
                              <strong className="text-[var(--foreground)]">
                                {displayMoney(activeQuoteLine.unitPrice)}
                              </strong>
                            </div>

                            <div>
                              <span className="text-[var(--text-secondary)] block text-[11px]">
                                Thuế VAT bán:
                              </span>
                              <span className="font-mono">{activeQuoteLine.vatPercent}%</span>
                            </div>

                            <div>
                              <span className="text-[var(--text-secondary)] block text-[11px]">
                                Doanh thu Net (chưa VAT):
                              </span>
                              <strong className="text-blue-700 dark:text-blue-300 font-mono">
                                {activeQuoteLine.cost ? displayMoney(activeQuoteLine.cost.net) : "—"}
                              </strong>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-blue-100 dark:border-blue-900/40 flex items-center justify-between text-xs">
                            <span className="text-[var(--text-secondary)]">Tổng giá bán khách (Gross):</span>
                            <strong className="text-sm font-bold font-mono text-blue-800 dark:text-blue-200">
                              {activeQuoteLine.cost ? displayMoney(activeQuoteLine.cost.gross) : "—"}
                            </strong>
                          </div>

                          {/* Auto sync notice */}
                          <div className="rounded-lg bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 p-2.5 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2">
                            <Sparkles size={14} className="text-blue-600 mt-0.5 shrink-0" />
                            <div>
                              <p className="font-semibold text-blue-800 dark:text-blue-300">Tự động đồng bộ số liệu sang IC</p>
                              <p className="text-[11px] text-blue-700/90 dark:text-blue-300/80 mt-0.5">
                                Số lượng (<strong>{activeQuoteLine.quantity}</strong>) và ĐVT (<strong>{activeQuoteLine.unit}</strong>) đã được chuyển tự động sang form mua IC bên phải mà không cần nhập lại.
                              </p>
                            </div>
                          </div>

                          {/* Button sync quantity and unit as fallback override */}
                          <div className="pt-0.5">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={handleSyncFromQuotation}
                              className="w-full text-xs flex items-center justify-center gap-1.5 py-1.5 border-blue-300 hover:bg-blue-100/50 dark:hover:bg-blue-900/40 text-[var(--text-secondary)]"
                              title="Lấy lại Số lượng và Đơn vị tính từ Báo giá khách"
                            >
                              <Copy size={12} className="text-blue-600 dark:text-blue-400" />
                              <span>Gán lại SL ({activeQuoteLine.quantity}) & ĐVT ({activeQuoteLine.unit})</span>
                            </Button>
                            {copyNotice && (
                              <p className="text-[11px] text-emerald-600 font-medium text-center mt-1">
                                Đã đồng bộ lại số lượng & ĐVT vào form IC!
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] text-center space-y-2">
                          <Info size={20} className="mx-auto text-[var(--text-secondary)] opacity-60" />
                          <p className="text-xs text-[var(--text-secondary)]">
                            Dòng chi phí này chưa liên kết với mục nào trong Báo giá bán khách hàng.
                          </p>
                          <p className="text-[11px] text-[var(--text-secondary)] italic">
                            Chọn dòng tương ứng từ menu trên nếu bạn muốn theo dõi biên lợi nhuận (Margin) theo thời gian thực.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="text-[11px] text-[var(--text-secondary)] pt-2 border-t border-[var(--border)]">
                      Dữ liệu Báo giá bán được bảo toàn tính toàn vẹn (Read-only từ phiên bản Báo giá đã tạo).
                    </div>
                  </div>

                  {/* ────────────────── CỘT PHẢI: DỰ TOÁN MUA NỘI BỘ (IC & NCC) ────────────────── */}
                  <div className="lg:col-span-7 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-4 shadow-xs">
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#587216]"></span>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">
                          Dự Toán Chi Phí Mua IC (Nội bộ)
                        </h4>
                      </div>
                      <Badge tone="success" className="text-[10px]">
                        Buy Side
                      </Badge>
                    </div>

                    {/* 1. TÊN HẠNG MỤC & ĐVT */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div className="sm:col-span-3">
                        <Input
                          label="Tên hạng mục chi phí *"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="VD: Xe 45 chỗ đưa đón, MC Teambuilding, Teabreak..."
                          required
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <Input
                          label="Đơn vị tính *"
                          value={unit}
                          onChange={(e) => setUnit(e.target.value)}
                          placeholder="Khách, Gói, Ngày..."
                          required
                        />
                        {isAutoInheritedUnit && (
                          <span className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-1 mt-1 font-medium">
                            <Sparkles size={10} /> Tự động từ Báo giá
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 2. SỐ LƯỢNG, ĐƠN GIÁ, CƠ SỞ & VAT */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <Input
                          label="Số lượng *"
                          type="number"
                          step="any"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                          required
                        />
                        {isAutoInheritedQty && (
                          <span className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-1 mt-1 font-medium">
                            <Sparkles size={10} /> Tự động từ Báo giá
                          </span>
                        )}
                      </div>

                      <div>
                        <Input
                          label="Đơn giá mua (VND) *"
                          type="number"
                          step="any"
                          value={unitPrice}
                          onChange={(e) => setUnitPrice(e.target.value)}
                          placeholder="VD: 5000000"
                          required
                        />
                      </div>

                      <div>
                        <Select
                          label="Cơ sở tính giá"
                          value={basis}
                          onChange={(e) => setBasis(e.target.value as "NET" | "GROSS")}
                        >
                          <option value="NET">NET (Chưa VAT)</option>
                          <option value="GROSS">GROSS (Đã gồm VAT)</option>
                        </Select>
                      </div>

                      <div>
                        <Select
                          label="Thuế VAT"
                          value={vatPercent}
                          onChange={(e) => setVatPercent(e.target.value)}
                        >
                          <option value="0">0% (Không thuế)</option>
                          <option value="5">5%</option>
                          <option value="8">8% (Phổ biến)</option>
                          <option value="10">10%</option>
                        </Select>
                      </div>
                    </div>

                    {/* 3. TẠM TÍNH THÀNH TIỀN MUA IC */}
                    <div className="p-3 rounded-xl border border-[#587216]/30 bg-[#587216]/5 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-[var(--foreground)]">
                        <Calculator size={15} className="text-[#587216]" />
                        <span>Tạm tính chi phí mua:</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 font-mono">
                        <div>
                          <span className="text-[var(--text-secondary)]">Net: </span>
                          <strong className="text-[var(--foreground)]">
                            {liveCost ? displayMoney(liveCost.net) : "—"}
                          </strong>
                        </div>
                        <div>
                          <span className="text-[var(--text-secondary)]">VAT: </span>
                          <strong className="text-[var(--foreground)]">
                            {liveCost ? displayMoney(liveCost.vat) : "—"}
                          </strong>
                        </div>
                        <div className="border-l border-[#587216]/30 pl-3">
                          <span className="text-[var(--text-secondary)]">Gross: </span>
                          <strong className="text-sm font-bold text-[#587216]">
                            {liveCost ? displayMoney(liveCost.gross) : "—"}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* 4. NHÀ CUNG CẤP (NCC) */}
                    <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-[var(--foreground)] flex items-center gap-1.5">
                          <Building2 size={15} className="text-[#587216]" />
                          Chỉ định Nhà Cung Cấp (NCC) phụ trách
                        </label>
                        {beneficiaries.length === 0 && (
                          <span className="text-[11px] text-amber-600">
                            Chưa có NCC trong danh mục dự án
                          </span>
                        )}
                      </div>

                      <Select
                        value={vendorId}
                        onChange={(e) => setVendorId(e.target.value)}
                        className="w-full text-xs"
                      >
                        <option value="">-- Chưa chỉ định Nhà Cung Cấp --</option>
                        {beneficiaries.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} ({b.bank} - {b.account})
                          </option>
                        ))}
                      </Select>

                      {vendorId ? (
                        (() => {
                          const selectedBen = beneficiaries.find((b) => b.id === vendorId);
                          return selectedBen ? (
                            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] bg-[var(--surface)] p-2 rounded-lg border border-[var(--border)]">
                              <CreditCard size={14} className="text-[#587216]" />
                              <span>
                                Nhận tiền: <strong>{selectedBen.account}</strong> ({selectedBen.bank})
                              </span>
                              {selectedBen.verifiedVersion ? (
                                <Badge tone="success" className="text-[10px]">Đã xác minh STK</Badge>
                              ) : (
                                <Badge tone="warning" className="text-[10px]">Chưa xác minh</Badge>
                              )}
                            </div>
                          ) : null;
                        })()
                      ) : (
                        <p className="text-[11px] text-[var(--text-secondary)] italic">
                          Gán NCC giúp hệ thống tự động tổng hợp vào <strong>Lịch Thanh Toán & Kế Hoạch Tạm Ứng</strong>.
                        </p>
                      )}
                    </div>

                    {/* 5. GHI CHÚ NỘI BỘ */}
                    <Textarea
                      label="Ghi chú nội bộ cho hạng mục"
                      value={internalNotes}
                      onChange={(e) => setInternalNotes(e.target.value)}
                      placeholder="VD: Đã khảo sát báo giá 3 bên; liên hệ anh Hùng 090... để chốt lịch."
                      rows={2}
                      className="text-xs"
                    />
                  </div>
                </div>

                {/* ═══════════ THƯỚC ĐO HIỆU QUẢ SONG SONG & BIÊN LỢI NHUẬN (LIVE MARGIN) ═══════════ */}
                {activeQuoteLine && liveCost ? (
                  <div
                    className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                      liveMargin && !liveMargin.isPositive
                        ? "border-rose-300 bg-rose-50/50 dark:border-rose-900/60 dark:bg-rose-950/20"
                        : liveMargin && liveMargin.percentNum < 30
                        ? "border-amber-300 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20"
                        : "border-[#587216]/40 bg-[#587216]/10"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          liveMargin && !liveMargin.isPositive
                            ? "bg-rose-500/20 text-rose-600"
                            : liveMargin && liveMargin.percentNum < 30
                            ? "bg-amber-500/20 text-amber-600"
                            : "bg-[#587216]/20 text-[#587216]"
                        }`}
                      >
                        <TrendingUp size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--foreground)]">
                            Đối Chiếu Biên Lợi Nhuận Song Song (Live Margin)
                          </span>
                          {liveMargin && !liveMargin.isPositive ? (
                            <Badge tone="danger">Cảnh báo: Bán dưới giá vốn (Lỗ)!</Badge>
                          ) : liveMargin && liveMargin.percentNum < 30 ? (
                            <Badge tone="warning">Biên lợi nhuận mỏng (&lt;30%)</Badge>
                          ) : (
                            <Badge tone="success">Biên lợi nhuận tốt (&ge;30%)</Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                          {liveMargin && !liveMargin.isPositive
                            ? "Chi phí mua IC hiện đang cao hơn doanh thu bán khách hàng. Cần đàm phán lại với NCC hoặc điều chỉnh giá bán."
                            : "Tự động so sánh giữa Doanh thu Net (Báo giá bán) và Chi phí Net (Dự toán mua IC)."}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-5 text-xs font-mono shrink-0">
                      <div>
                        <span className="text-[var(--text-secondary)] block text-[11px]">Bán Net (Khách):</span>
                        <strong className="text-blue-700 dark:text-blue-300 text-sm">
                          {displayMoney(activeQuoteLine.cost.net)}
                        </strong>
                      </div>

                      <div>
                        <span className="text-[var(--text-secondary)] block text-[11px]">Mua Net (IC):</span>
                        <strong className="text-[var(--foreground)] text-sm">
                          {displayMoney(liveCost.net)}
                        </strong>
                      </div>

                      <div className="border-l border-[var(--border)] pl-4">
                        <span className="text-[var(--text-secondary)] block text-[11px]">Lãi gộp (VND):</span>
                        <strong
                          className={`text-base font-bold ${
                            liveMargin && !liveMargin.isPositive
                              ? "text-rose-600"
                              : liveMargin && liveMargin.percentNum < 30
                              ? "text-amber-600"
                              : "text-[#587216]"
                          }`}
                        >
                          {liveMargin ? liveMargin.marginDisplay : "—"}
                        </strong>
                      </div>

                      <div>
                        <span className="text-[var(--text-secondary)] block text-[11px]">Tỷ suất Margin:</span>
                        <strong
                          className={`text-base font-bold ${
                            liveMargin && !liveMargin.isPositive
                              ? "text-rose-600"
                              : liveMargin && liveMargin.percentNum < 30
                              ? "text-amber-600"
                              : "text-[#587216]"
                          }`}
                        >
                          {liveMargin ? liveMargin.percentDisplay : "—"}
                        </strong>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </ActionForm>

            {/* ═══════════ DELETE LINE ACTION (IF EDITING EXISTING) ═══════════ */}
            {!isCreateMode && (
              <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between">
                {!confirmDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={13} className="mr-1" />
                    Xóa dòng này khỏi IC
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-rose-600 font-medium">
                      Xác nhận xóa hạng mục này khỏi IC?
                    </span>
                    <ActionForm
                      finance={finance}
                      command="SAVE_IC"
                      requestId={revision.requestId}
                      label="Xác nhận xóa"
                      danger
                      onSuccess={onClose}
                    >
                      <input type="hidden" name="requestId" value={revision.requestId} />
                      <input type="hidden" name="title" value={request?.title ?? `IC-R${revision.number}`} />
                      <input type="hidden" name="lines" value={JSON.stringify(deletedLines)} />
                      {revision.poIds.map((id) => (
                        <input key={`del-po-${id}`} type="hidden" name="poIds" value={id} />
                      ))}
                      {(revision.briefIds ?? []).map((id) => (
                        <input key={`del-brief-${id}`} type="hidden" name="briefIds" value={id} />
                      ))}
                      {(revision.evidenceIds ?? []).map((id) => (
                        <input key={`del-ev-${id}`} type="hidden" name="evidenceIds" value={id} />
                      ))}
                    </ActionForm>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="text-xs"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Hủy
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
