"use client";

import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { actualCostAction, type ActualCostActionState } from "@/app/actions/costflow";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Badge } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import type { ActualCostReadLine } from "@/lib/costflow/actualCostReadModel";
import type { ActualCostFundingAllocation, ActualCostFundingSource, ActualCostInternalStatus } from "@/lib/costflow/actualCost";
import { FileText, Trash2, X } from "lucide-react";

const FUNDING_OPTIONS: [ActualCostFundingSource, string][] = [
  ["EMPLOYEE_ADVANCE", "Tạm ứng nhân sự"],
  ["EMPLOYEE_OUT_OF_POCKET", "Nhân sự tự chi"],
  ["VENDOR_ADVANCE", "Tạm ứng NCC"],
  ["VENDOR_PAYMENT", "Thanh toán NCC"],
];
const EVIDENCE_OPTIONS = [
  ["VENDOR_CONTRACT_PO", "Hợp đồng / PO nhà cung cấp"],
  ["ACCEPTANCE_HANDOVER", "Biên bản nghiệm thu / bàn giao"],
  ["VAT_INVOICE", "Hóa đơn VAT"],
  ["PAYMENT_PROOF", "Chứng từ thanh toán"],
  ["FIELD_PHOTO_REPORT", "Ảnh hiện trường / báo cáo"],
] as const;

const INTERNAL_STATUS_LABELS: Record<ActualCostInternalStatus, { label: string; tone: "neutral" | "warning" | "info" | "success" }> = {
  IN_PROGRESS: { label: "Đang nhập", tone: "neutral" },
  NEEDS_INFO: { label: "Cần bổ sung", tone: "warning" },
  PENDING_ACCOUNT_REVIEW: { label: "Chờ Account kiểm tra", tone: "info" },
  ACCOUNT_REVIEWED: { label: "Account đã kiểm tra", tone: "success" },
};

type Props = {
  open: boolean;
  onClose: () => void;
  line: ActualCostReadLine | null;
  finance: Finance;
  currentUserId: string;
  canEdit: boolean;
  canReview: boolean;
};

export default function ActualCostDetailDrawer({
  open,
  line,
  ...props
}: Props) {
  if (!open) return null;
  return <ActualCostDetailDrawerContent key={`${line?.id ?? "new"}:${line?.versionId ?? "draft"}`} line={line} {...props} />;
}

function ActualCostDetailDrawerContent({
  onClose,
  line,
  finance,
  canEdit,
  canReview,
}: Omit<Props, "open">) {
  const effective = finance.data.revisions.find(r => r.effective);
  const usersMap = useMemo(() => new Map(finance.users.map(u => [u.id, u.name])), [finance.users]);

  // Form states
  const [sourceKind, setSourceKind] = useState<"IC_LINKED" | "UNBUDGETED">(line?.sourceKind === "UNBUDGETED" ? "UNBUDGETED" : "IC_LINKED");
  const [icLineId, setIcLineId] = useState(line?.icLineId || effective?.lines[0]?.id || "");
  const [description, setDescription] = useState(line?.description || "");
  const [reason, setReason] = useState(line?.sourceReason ?? "");
  const [recipientKey, setRecipientKey] = useState(line?.recipientKey || "");
  const [quantity, setQuantity] = useState(line?.quantity || "1");
  const [days, setDays] = useState(line?.days || "1");
  const [unit, setUnit] = useState(line?.unit || "");
  const [unitPrice, setUnitPrice] = useState(line?.unitPrice || "0");
  const basis = line?.basis ?? "NET";
  const vatPercent = line?.vatPercent ?? "0";
  const [billable, setBillable] = useState(line?.billable ?? false);
  const [saleQuantity, setSaleQuantity] = useState(line?.saleSnapshot?.quantity || "1");
  const [saleDays, setSaleDays] = useState(line?.saleSnapshot?.days || "1");
  const [saleUnitPrice, setSaleUnitPrice] = useState(line?.saleSnapshot?.unitPrice || "0");
  const [fundingSource, setFundingSource] = useState<ActualCostFundingSource>((line?.fundingSource as ActualCostFundingSource) || "EMPLOYEE_OUT_OF_POCKET");
  const [fundingAllocations, setFundingAllocations] = useState<ActualCostFundingAllocation[]>(
    line?.fundingAllocations && line.fundingAllocations.length > 1 ? line.fundingAllocations : [],
  );
  const [internalStatus, setInternalStatus] = useState<ActualCostInternalStatus>(line?.internalStatus || "PENDING_ACCOUNT_REVIEW");
  const [accountNote, setAccountNote] = useState(line?.accountNote || "");

  // If user picks an IC line, pre-fill description & unit
  const handleIcLineChange = (newIcLineId: string) => {
    setIcLineId(newIcLineId);
    const found = effective?.lines.find(l => l.id === newIcLineId);
    if (found) {
      if (!description || description === effective?.lines.find(l => l.id === icLineId)?.description) {
        setDescription(found.description);
      }
      if (!unit || unit === effective?.lines.find(l => l.id === icLineId)?.unit) {
        setUnit(found.unit);
      }
    }
  };

  const [saveState, saveAction, savePending] = useActionState(actualCostAction, {} as ActualCostActionState);
  const [deleteState, deleteAction, deletePending] = useActionState(actualCostAction, {} as ActualCostActionState);

  // Close drawer on save success
  useEffect(() => {
    if (saveState.success) {
      const timer = setTimeout(() => { onClose(); }, 800);
      return () => clearTimeout(timer);
    }
  }, [saveState.success, onClose]);

  // Close drawer on delete success
  useEffect(() => {
    if (deleteState.success) {
      const timer = setTimeout(() => { onClose(); }, 800);
      return () => clearTimeout(timer);
    }
  }, [deleteState.success, onClose]);

  // Recipients list
  const recipients = useMemo(() => [
    ...finance.project.members.map(member => ({
      value: `USER:${member.userId}`,
      label: `${usersMap.get(member.userId) ?? "Thành viên"} (Nhân sự)`,
    })),
    ...finance.data.beneficiaries.map(vendor => ({
      value: `VENDOR:${vendor.id}`,
      label: `${vendor.name} (NCC nội bộ)`,
    })),
    ...finance.suppliers.flatMap(supplier => supplier.accounts.map(account => ({
      value: account.recipientKey,
      label: `${supplier.version.legalName} · ${account.bankName} •••• ${account.accountLast4}`,
    }))),
  ], [finance.data.beneficiaries, finance.project.members, finance.suppliers, usersMap]);

  // Derived cost preview
  const previewGross = useMemo(() => {
    const q = parseFloat(quantity) || 0;
    const d = parseFloat(days) || 0;
    const p = parseFloat(unitPrice) || 0;
    const v = parseFloat(vatPercent) || 0;
    if (basis === "NET") {
      const net = q * d * p;
      const vat = net * (v / 100);
      return Math.round(net + vat);
    }
    return Math.round(q * d * p);
  }, [quantity, days, unitPrice, basis, vatPercent]);

  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<Set<string>>(() =>
    new Set((line?.evidence ?? []).map(e => e.id))
  );
  const [evidenceKind, setEvidenceKind] = useState<string>(EVIDENCE_OPTIONS[0][0]);
  const [newEvidence, setNewEvidence] = useState<{ id: string; name: string; kind: string; sha256: string }[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const availableEvidence = useMemo(() => {
    const seen = new Set<string>();
    return [...newEvidence, ...(finance.actualCosts?.evidenceVault ?? [])].filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [newEvidence, finance.actualCosts?.evidenceVault]);

  async function uploadEvidence(files: FileList | null) {
    if (!files?.length || !canEdit || isLocked) return;
    setUploadBusy(true);
    setUploadMessage("");
    try {
      const form = new FormData();
      form.set("vault", "true");
      form.set("kind", evidenceKind);
      for (const file of Array.from(files)) form.append("proof", file);
      const response = await fetch(`/api/projects/${finance.project.id}/costflow/evidence/upload`, { method: "POST", body: form });
      const result = await response.json() as { error?: string; evidence?: { id: string; name: string; kind: string; sha256: string; reused: boolean }[] };
      if (!response.ok || !result.evidence) throw new Error(result.error ?? "Chưa tải được chứng từ.");
      setNewEvidence(current => [...current, ...result.evidence!]);
      setSelectedEvidenceIds(current => new Set([...current, ...result.evidence!.map(item => item.id)]));
      setUploadMessage(result.evidence.some(item => item.reused) ? "File trùng nội dung đã có trong Kho và được liên kết lại." : "Đã tải chứng từ vào Kho. Lưu khoản chi để liên kết.");
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : "Chưa tải được chứng từ.");
    } finally {
      setUploadBusy(false);
    }
  }

  const toggleEvidence = (evId: string) => {
    setSelectedEvidenceIds(prev => {
      const next = new Set(prev);
      if (next.has(evId)) next.delete(evId);
      else next.add(evId);
      return next;
    });
  };

  const isLocked = line?.lockedByApplications ?? false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity" role="dialog" aria-modal="true" aria-labelledby="ac-drawer-title">
      <div className="flex h-full w-full max-w-2xl flex-col bg-[var(--surface)] shadow-2xl overflow-y-auto">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4 bg-[var(--surface-soft)]">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="ac-drawer-title" className="text-base font-bold text-[var(--foreground)]">
                {line ? "Chi tiết & Chỉnh sửa dòng AC" : "Thêm khoản chi thực tế mới"}
              </h2>
              {line?.reviewState && (
                <Badge tone={line.reviewState === "approved" ? "success" : line.reviewState === "returned" ? "warning" : "info"}>
                  {line.reviewState === "approved" ? "Đã Duyệt AC" : line.reviewState === "returned" ? "Trả lại để sửa" : "Chờ Duyệt AC"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Cơ chế cùng nhập · Account có quyền sửa trực tiếp trước khi gửi DD duyệt toàn bảng.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
            aria-label="Đóng panel"
          >
            <X size={18} />
          </button>
        </div>

        {/* Lock warning if applied to payment requests */}
        {isLocked && (
          <div className="p-4 bg-[var(--warning-soft)] border-b border-[var(--warning)]">
            <Alert tone="warning" title="Dòng AC đã được gắn vào hồ sơ chi">
              Khoản này đã được kết nối với hồ sơ thanh toán hoặc hoàn ứng. Muốn điều chỉnh, vui lòng rút hoặc hủy phiếu thanh toán trước.
            </Alert>
          </div>
        )}

        {/* Return feedback note from DD if returned */}
        {line?.ddReturnNote && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-800">
            <Alert tone="danger" title="Ghi chú của DD khi trả lại:">
              {line.ddReturnNote}
            </Alert>
          </div>
        )}

        {/* Form Body */}
        <form action={saveAction} className="flex-1 space-y-6 p-6">
          <input type="hidden" name="projectId" value={finance.project.id} />
          <input type="hidden" name="actualCostCommand" value="SAVE_LINE" />
          <input type="hidden" name="sheetRevisionId" value={finance.actualCosts?.sheet?.revisionId ?? ""} />
          <input type="hidden" name="sheetMutationVersion" value={finance.actualCosts?.sheet?.mutationVersion ?? 0} />
          <input type="hidden" name="revisionId" value={effective?.id ?? ""} />
          {line?.id && <input type="hidden" name="lineId" value={line.id} />}
          <input type="hidden" name="sourceKind" value={sourceKind} />
          <input type="hidden" name="basis" value={basis} />
          <input type="hidden" name="vatPercent" value={vatPercent} />
          {fundingAllocations.length > 0 && <input type="hidden" name="fundingAllocations" value={JSON.stringify(fundingAllocations)} />}
          <input type="hidden" name="internalStatus" value={internalStatus} />
          {Array.from(selectedEvidenceIds).map(id => (
            <input key={id} type="hidden" name="evidenceIds" value={id} />
          ))}

          {/* 1. Nguồn ngân sách (IC Linked vs Phát sinh ngoài IC) */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-4 bg-[var(--surface-soft)]">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              1. Căn cứ ngân sách & Loại chi phí
            </h3>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="sourceKindSelector"
                  checked={sourceKind === "IC_LINKED"}
                  onChange={() => setSourceKind("IC_LINKED")}
                  disabled={!canEdit || isLocked}
                />
                <span className="font-medium">Liên kết dòng IC</span>
              </label>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="sourceKindSelector"
                  checked={sourceKind === "UNBUDGETED"}
                  onChange={() => setSourceKind("UNBUDGETED")}
                  disabled={!canEdit || isLocked}
                />
                <span className="font-medium text-[var(--warning)]">[Phát sinh ngoài IC]</span>
              </label>
            </div>

            {sourceKind === "IC_LINKED" ? (
              effective ? (
                <div>
                  <Select
                    name="icLineId"
                    label="Dòng IC dự toán hiệu lực"
                    value={icLineId}
                    onChange={e => handleIcLineChange(e.target.value)}
                    disabled={!canEdit || isLocked}
                    required
                  >
                    {effective.lines.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.description} (Dự toán: {l.cost ? displayMoney(l.cost.gross) : "0 ₫"})
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <Alert tone="warning" title="Chưa có IC hiệu lực">
                  Project chưa có bản IC nào được phê duyệt hiệu lực để liên kết.
                </Alert>
              )
            ) : (
              <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                <Textarea
                  name="reason"
                  label="Lý do phát sinh ngoài IC (Bắt buộc)"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Nêu rõ nguyên nhân phát sinh (khách hàng yêu cầu thêm, thay đổi hiện trường...)"
                  disabled={!canEdit || isLocked}
                  required
                />
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    name="billable"
                    value="true"
                    checked={billable}
                    onChange={e => setBillable(e.target.checked)}
                    disabled={!canEdit || isLocked}
                  />
                  <span>Thu thêm từ khách (Billable add-on)</span>
                </label>
                {billable && (
                  <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                    <Input name="saleQuantity" label="SL bán thêm" value={saleQuantity} onChange={e => setSaleQuantity(e.target.value)} inputMode="decimal" required />
                    <Input name="saleDays" label="Số ngày" value={saleDays} onChange={e => setSaleDays(e.target.value)} inputMode="decimal" required />
                    <Input name="saleUnitPrice" label="Đơn giá bán thêm" value={saleUnitPrice} onChange={e => setSaleUnitPrice(e.target.value)} inputMode="decimal" required />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Chi tiết khối lượng & Thành tiền */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              2. Khối lượng & Đơn giá thực tế
            </h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                name="description"
                label="Nội dung chi thực tế"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="VD: Thuê xe cẩu 5 tấn ngày sự kiện"
                required
                disabled={!canEdit || isLocked}
                className="sm:col-span-2"
              />

              <Select
                name="recipientKey"
                label="Người nhận / NCC phụ trách"
                value={recipientKey}
                onChange={e => setRecipientKey(e.target.value)}
                disabled={!canEdit || isLocked}
                required
                className="sm:col-span-2"
              >
                <option value="">-- Chọn nhân sự hoặc Nhà cung cấp --</option>
                {recipients.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </Select>

              <Input
                name="quantity"
                label="Số lượng thực tế"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                inputMode="decimal"
                disabled={!canEdit || isLocked}
                required
              />

              <Input
                name="days"
                label="Số ngày"
                value={days}
                onChange={e => setDays(e.target.value)}
                inputMode="decimal"
                disabled={!canEdit || isLocked}
                required
              />

              <Input
                name="unit"
                label="Đơn vị tính (ĐVT)"
                value={unit}
                onChange={e => setUnit(e.target.value)}
                placeholder="chuyến, người, cái..."
                disabled={!canEdit || isLocked}
                required
              />

              <Input
                name="unitPrice"
                label="Đơn giá (VND)"
                value={unitPrice}
                onChange={e => setUnitPrice(e.target.value)}
                inputMode="decimal"
                disabled={!canEdit || isLocked}
                required
              />
            </div>

            {/* Price Preview Card */}
            <div className="flex items-center justify-between rounded-lg bg-[var(--primary-soft)] p-3 border border-[var(--primary)]/20">
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                Thành tiền tính toán (SL × Ngày × Đơn giá):
              </span>
              <span className="text-base font-bold text-[var(--primary)] font-mono">
                {displayMoney(previewGross.toString())}
              </span>
            </div>
          </div>

          {/* 3. Nguồn tiền thanh toán */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              3. Nguồn tiền xử lý
            </h3>
            <Select
              name="fundingSource"
              label="Kênh chi trả chính"
              value={fundingSource}
              onChange={e => {
                const source = e.target.value as ActualCostFundingSource;
                setFundingSource(source);
                setFundingAllocations(current => current.map((allocation, index) => index === 0 ? { ...allocation, source } : allocation));
              }}
              disabled={!canEdit || isLocked}
              required
            >
              {FUNDING_OPTIONS.map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </Select>
            {fundingAllocations.length > 0 && (
              <div className="space-y-2" aria-label="Phân bổ nhiều nguồn tiền">
                {fundingAllocations.map((allocation, index) => (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                    <Select
                      label={`Nguồn ${index + 1}`}
                      value={allocation.source}
                      onChange={event => {
                        const source = event.target.value as ActualCostFundingSource;
                        if (index === 0) setFundingSource(source);
                        setFundingAllocations(current => current.map((item, position) => position === index ? { ...item, source } : item));
                      }}
                      disabled={!canEdit || isLocked}
                    >
                      {FUNDING_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                    <Input
                      label={`Số tiền nguồn ${index + 1} (VND)`}
                      value={allocation.amount}
                      onChange={event => setFundingAllocations(current => current.map((item, position) => position === index ? { ...item, amount: event.target.value } : item))}
                      inputMode="numeric"
                      disabled={!canEdit || isLocked}
                    />
                    <Button type="button" size="sm" variant="secondary" onClick={() => {
                      const next = fundingAllocations.filter((_, position) => position !== index);
                      if (next[0]) setFundingSource(next[0].source);
                      setFundingAllocations(next.length === 1 ? [] : next);
                    }} disabled={!canEdit || isLocked}>
                      Bỏ
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-[var(--text-secondary)]">Tổng tiền các nguồn phải bằng đúng thành tiền thực chi.</p>
              </div>
            )}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setFundingAllocations(current => current.length ? [...current, { source: "EMPLOYEE_OUT_OF_POCKET", amount: "" }] : [{ source: fundingSource, amount: "" }, { source: "EMPLOYEE_OUT_OF_POCKET", amount: "" }])}
              disabled={!canEdit || isLocked}
            >
              Thêm nguồn tiền
            </Button>
            <p className="text-xs text-[var(--text-secondary)]">
              Khoản chi phản ánh chi phí dự án; tiền chi thực tế sẽ được khớp nối khi lập phiếu ĐNTT hoặc Hoàn tạm ứng.
            </p>
          </div>

          {/* 4. Kho chứng từ liên kết */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                4. Chứng từ nghiệm thu ({selectedEvidenceIds.size} file đã chọn)
              </h3>
            </div>
            {canEdit && !isLocked && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Select label="Loại chứng từ tải lên" value={evidenceKind} onChange={event => setEvidenceKind(event.target.value)} disabled={uploadBusy}>
                  {EVIDENCE_OPTIONS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
                </Select>
                <label className="text-xs font-medium text-[var(--text-secondary)]">
                  Tải chứng từ vào Kho
                  <input type="file" multiple accept="image/*,application/pdf" className="mt-1 block w-full text-xs" disabled={uploadBusy} onChange={event => { void uploadEvidence(event.target.files); event.target.value = ""; }} />
                </label>
              </div>
            )}
            {uploadMessage && <Alert tone={uploadMessage.startsWith("Chưa") ? "danger" : "info"} title={uploadMessage} />}

            {availableEvidence.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                {availableEvidence.map(ev => {
                  const checked = selectedEvidenceIds.has(ev.id);
                  return (
                    <label
                      key={ev.id}
                      className={`flex items-center justify-between gap-3 p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                        checked ? "bg-[var(--primary-soft)] border border-[var(--primary)]/30" : "hover:bg-[var(--surface-soft)]"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEvidence(ev.id)}
                          disabled={!canEdit || isLocked}
                        />
                        <FileText size={14} className="shrink-0 text-[var(--primary)]" />
                        <span className="font-medium truncate">{ev.name}</span>
                      </div>
                      <Badge tone="neutral">{ev.kind}</Badge>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">
                Chưa có chứng từ trong kho. Bạn có thể lưu dòng trước rồi bổ sung chứng từ vào Kho sau.
              </p>
            )}
          </div>

          {/* 5. Trạng thái kiểm soát nội bộ (Cùng nhập - Account kiểm tra) */}
          <div className="rounded-xl border border-[var(--border)] p-4 space-y-3 bg-[var(--surface-soft)]">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
              5. Trạng thái kiểm tra nội bộ (Account)
            </h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                name="statusSelector"
                label="Trạng thái dòng"
                value={internalStatus}
                onChange={e => setInternalStatus(e.target.value as ActualCostInternalStatus)}
                disabled={!canReview || isLocked}
              >
                {Object.entries(INTERNAL_STATUS_LABELS).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </Select>

              <div className="flex items-center gap-2 pt-6">
                <Badge tone={INTERNAL_STATUS_LABELS[internalStatus].tone}>
                  {INTERNAL_STATUS_LABELS[internalStatus].label}
                </Badge>
              </div>
            </div>

            <Textarea
              name="accountNote"
              label="Ghi chú của Account / Yêu cầu bổ sung"
              value={accountNote}
              onChange={e => setAccountNote(e.target.value)}
              placeholder="VD: Yêu cầu nhân sự bổ sung ảnh nghiệm thu bàn giao..."
              disabled={!canReview || isLocked}
              rows={2}
            />
          </div>

          {saveState.error && <Alert tone="danger" title={saveState.error} />}
          {saveState.success && <Alert tone="success" title={saveState.success} />}

          {/* Submit Actions */}
          <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
            <div>
              {line?.id && !isLocked && canEdit && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(`Bạn có chắc muốn xóa dòng "${description}" khỏi Bảng AC?`)) {
                      const fd = new FormData();
                      fd.set("projectId", finance.project.id);
                      fd.set("actualCostCommand", "DELETE_LINE");
                      fd.set("lineId", line.id);
                      fd.set("sheetRevisionId", finance.actualCosts?.sheet?.revisionId ?? "");
                      fd.set("sheetMutationVersion", String(finance.actualCosts?.sheet?.mutationVersion ?? 0));
                      startTransition(() => deleteAction(fd));
                    }
                  }}
                  loading={deletePending}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                >
                  <Trash2 size={14} className="mr-1" />
                  Loại khỏi bản nháp
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                Hủy
              </Button>
              {canEdit && !isLocked && (
                <Button type="submit" size="sm" loading={savePending}>
                  {line ? "Lưu thay đổi" : "Tạo dòng AC"}
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
