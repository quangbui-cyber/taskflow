"use client";

import { useState, useMemo } from "react";
import {
  Building2,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Trash2,
  FileSpreadsheet,
  CreditCard,
  Plus,
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
  onSelectLine?: (line: IcLine) => void;
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
  onSelectLine,
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
  const initialQuoteDays = initialMatch?.line?.days || initialMatch?.salesRow?.sell?.days || "1";
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
  const [days, setDays] = useState(line?.days ?? "");
  const [unitPrice, setUnitPrice] = useState(line?.unitPrice ?? "");
  const [basis, setBasis] = useState<"NET" | "GROSS">((line?.basis as "NET" | "GROSS") || "NET");
  const [vatPercent, setVatPercent] = useState(line?.vatPercent ?? "8");
  const [vendorId, setVendorId] = useState(line?.vendorId ?? "");
  const [internalNotes, setInternalNotes] = useState(line?.internalNotes ?? "");
  const [evidenceReason] = useState(line?.evidenceReason ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copyNotice, setCopyNotice] = useState(false);

  const currentLineIndex = line ? revision.lines.findIndex((candidate) => candidate.id === line.id) : -1;
  const previousLine = currentLineIndex > 0 ? revision.lines[currentLineIndex - 1] : null;
  const nextLine = currentLineIndex >= 0 && currentLineIndex < revision.lines.length - 1
    ? revision.lines[currentLineIndex + 1]
    : null;

  const hasUnsavedChanges = Boolean(
    description !== (line?.description ?? "")
      || unit !== (line?.unit?.trim() ? line.unit : (initialQuoteUnit || "Gói"))
      || quantity !== (line?.quantity?.trim() ? line.quantity : (initialQuoteQty || "1"))
      || days !== (line?.days ?? "")
      || unitPrice !== (line?.unitPrice ?? "")
      || basis !== ((line?.basis as "NET" | "GROSS") || "NET")
      || vatPercent !== (line?.vatPercent ?? "8")
      || vendorId !== (line?.vendorId ?? "")
      || internalNotes !== (line?.internalNotes ?? "")
      || selectedQuotationId !== (line?.quotationId ?? initialMatch?.quotation.id ?? (quotations.slice(-1)[0]?.id ?? ""))
      || selectedQuotationLineId !== (line?.quotationLineId ?? initialMatch?.line.id ?? "")
  );

  const requestClose = () => {
    if (hasUnsavedChanges && !window.confirm("Bạn có thay đổi chưa lưu. Đóng trình chỉnh sửa?")) return;
    onClose();
  };

  const navigateToLine = (target: IcLine | null) => {
    if (!target || !onSelectLine) return;
    if (hasUnsavedChanges && !window.confirm("Bạn có thay đổi chưa lưu. Chuyển sang hạng mục khác?")) return;
    onSelectLine(target);
  };

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
      if (!quantity || !days || !unitPrice || parseFloat(quantity) <= 0 || parseFloat(days) <= 0 || parseFloat(unitPrice) < 0) {
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

  const icCompletion = [
    description.trim(),
    unit.trim(),
    quantity.trim(),
    days.trim(),
    unitPrice.trim(),
    vendorId,
    (line?.evidenceIds?.length ?? 0) > 0 || evidenceReason.trim(),
  ].filter(Boolean).length;

  const quotationCompletion = activeQuoteLine
    ? [
        activeQuoteLine.description?.trim(),
        activeQuoteLine.unit?.trim(),
        activeQuoteLine.quantity?.trim(),
        activeQuoteLine.days?.trim(),
        activeQuoteLine.unitPrice?.trim(),
        activeQuoteLine.cost,
      ].filter(Boolean).length
    : 0;

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
    days,
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
      onClose={requestClose}
      className="tf-ic-line-drawer"
      title={
        isCreateMode
          ? `Thêm hạng mục vào IC-R${revision.number}`
          : line?.description || description || "Chỉnh sửa hạng mục IC"
      }
      description={
        isEditableDraft
          ? `IC-R${revision.number}${currentLineIndex >= 0 ? ` · Dòng ${currentLineIndex + 1}/${revision.lines.length}` : " · Hạng mục mới"}`
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
          <div className="tf-edit-ic-line-modal tf-edit-ic-line-drawer">
            <div className="tf-ic-drawer-toolbar">
              <div className="tf-ic-drawer-status">
                <Badge tone={activeQuoteLine ? "info" : "neutral"}>
                  {activeQuoteLine ? `BG ${quotationCompletion}/6` : "Không có BG"}
                </Badge>
                <Badge tone={icCompletion === 7 ? "success" : "warning"}>IC {icCompletion}/7</Badge>
              </div>
              {!isCreateMode && (
                <div className="tf-ic-drawer-navigation" aria-label="Điều hướng hạng mục IC">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!previousLine}
                    onClick={() => navigateToLine(previousLine)}
                    aria-label="Hạng mục trước"
                  >
                    <ChevronLeft size={15} />
                    <span>Dòng trước</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!nextLine}
                    onClick={() => navigateToLine(nextLine)}
                    aria-label="Hạng mục sau"
                  >
                    <span>Dòng sau</span>
                    <ChevronRight size={15} />
                  </Button>
                </div>
              )}
              <Link
                className="tf-button-secondary tf-button-size-sm tf-ic-drawer-worksheet-link"
                href={worksheetHref}
                target="_blank"
                rel="noopener noreferrer"
                title="Mở Worksheet toàn màn hình"
              >
                <FileSpreadsheet size={14} />
                <span>Mở Worksheet</span>
                <ExternalLink size={12} aria-hidden="true" />
              </Link>
            </div>

            {/* ═══════════ MAIN FORM (ACTIONFORM) ═══════════ */}
            <ActionForm
              className="tf-ic-drawer-form"
              finance={finance}
              command="SAVE_IC"
              requestId={revision.requestId}
              label={isCreateMode ? "Thêm vào dự toán IC" : nextLine ? "Lưu & sang dòng tiếp" : "Lưu thay đổi"}
              onSuccess={() => {
                if (nextLine && onSelectLine) onSelectLine(nextLine);
                else onClose();
              }}
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

              <div className="tf-ic-drawer-scroll">
                {/* ═══════════ 2-COLUMN PARALLEL LAYOUT: BÁO GIÁ (SELL) vs IC (BUY) ═══════════ */}
                <div className="tf-ic-drawer-content">
                  {/* ────────────────── CỘT PHẢI: DỰ TOÁN MUA NỘI BỘ (IC & NCC) ────────────────── */}
                  <section className="tf-ic-primary-card">
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#587216]"></span>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--foreground)]">
                          Thông tin IC nội bộ
                        </h4>
                      </div>
                      <Badge tone="success" className="text-[10px]">Đang chỉnh</Badge>
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
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
                          label="Số ngày mua *"
                          type="number"
                          step="any"
                          min="0"
                          value={days}
                          onChange={(e) => setDays(e.target.value)}
                          required
                        />
                        {initialQuoteDays && days !== initialQuoteDays && (
                          <Button variant="ghost" size="sm" onClick={() => setDays(initialQuoteDays)}>
                            Dùng ngày bán ({initialQuoteDays})
                          </Button>
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
                    <div className="tf-ic-cost-summary">
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
                    <div className="tf-ic-vendor-section">
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
                  </section>

                  {/* Báo giá là nguồn tham chiếu chỉ đọc, đặt sau vùng nhập IC. */}
                  <details className="tf-ic-reference-card">
                    <summary>
                      <span className="tf-ic-reference-heading">
                        <span className="tf-ic-reference-dot" aria-hidden="true" />
                        <span>
                          <strong>Báo giá tham chiếu</strong>
                          <small>
                            {activeQuoteLine
                              ? `BG-${activeQuote?.number} · ${activeQuoteLine.description}`
                              : "Chưa liên kết dòng Báo giá"}
                          </small>
                        </span>
                      </span>
                      <span className="tf-ic-reference-summary">
                        <span>
                          <small>Bán Net</small>
                          <strong>{activeQuoteLine?.cost ? displayMoney(activeQuoteLine.cost.net) : "—"}</strong>
                        </span>
                        <span>
                          <small>Margin</small>
                          <strong className={liveMargin && !liveMargin.isPositive ? "is-negative" : ""}>
                            {liveMargin ? liveMargin.percentDisplay : "—"}
                          </strong>
                        </span>
                      </span>
                    </summary>

                    <div className="tf-ic-reference-body">
                      <Select
                        label="Liên kết dòng Báo giá"
                        value={selectedQuotationLineId ? `${selectedQuotationId}::${selectedQuotationLineId}` : ""}
                        onChange={(e) => handleQuotationLineSelect(e.target.value)}
                      >
                        <option value="">Chi phí nội bộ độc lập</option>
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

                      {activeQuoteLine ? (
                        <>
                          <dl className="tf-ic-reference-metrics">
                            <div><dt>SL / ĐVT bán</dt><dd>{activeQuoteLine.quantity} {activeQuoteLine.unit}</dd></div>
                            <div><dt>Số ngày bán</dt><dd>{activeQuoteLine.days || "1"}</dd></div>
                            <div><dt>Đơn giá bán ({activeQuoteLine.basis})</dt><dd>{displayMoney(activeQuoteLine.unitPrice)}</dd></div>
                            <div><dt>VAT bán</dt><dd>{activeQuoteLine.vatPercent}%</dd></div>
                            <div><dt>Bán Gross</dt><dd>{activeQuoteLine.cost ? displayMoney(activeQuoteLine.cost.gross) : "—"}</dd></div>
                            <div><dt>Lãi gộp</dt><dd>{liveMargin ? liveMargin.marginDisplay : "—"}</dd></div>
                          </dl>
                          <div className="tf-ic-reference-actions">
                            <span><Sparkles size={13} /> SL và ĐVT được kế thừa từ Báo giá.</span>
                            <Button type="button" variant="secondary" size="sm" onClick={handleSyncFromQuotation}>
                              <Copy size={13} /> Gán lại SL & ĐVT
                            </Button>
                          </div>
                          {copyNotice && <p className="tf-ic-inline-success">Đã đồng bộ lại SL và ĐVT.</p>}
                        </>
                      ) : (
                        <p className="tf-ui-help tf-ic-reference-empty">
                          <Info size={15} /> Chọn một dòng Báo giá nếu cần theo dõi lãi gộp và margin.
                        </p>
                      )}
                      <p className="tf-ui-help">Dữ liệu Báo giá chỉ dùng để tham chiếu và không bị sửa tại đây.</p>
                    </div>
                  </details>
                </div>
              </div>
            </ActionForm>

            {/* ═══════════ DELETE LINE ACTION (IF EDITING EXISTING) ═══════════ */}
            {!isCreateMode && (
              <div className="tf-ic-drawer-delete">
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
