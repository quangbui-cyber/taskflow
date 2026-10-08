"use client";

import { useState, useMemo } from "react";
import {
  Building2,
  Calendar,
  CreditCard,
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  SlidersHorizontal,
  Send,
  Trash2,
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Badge, EmptyState, Panel, Table } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";
import ActionForm from "@/components/CostFlowActionForm";
import { displayMoney } from "@/lib/costflow/money";
import type { IcRevision, VendorPaymentMilestone } from "@/lib/costflow/types";

type Props = {
  finance: Finance;
  revision: IcRevision;
  canCreate: boolean;
  onOpenAdvance: (params: {
    kind: "ADVANCE" | "VENDOR_PAYMENT";
    recipientKey: string;
    amount: string;
    title: string;
  }) => void;
};

type VendorGroup = {
  vendorId: string;
  name: string;
  bank: string;
  account: string;
  isVerified: boolean;
  itemCount: number;
  totalGross: number;
  totalNet: number;
  milestones: VendorPaymentMilestone[];
  disbursedAmount: number;
};

export default function VendorPaymentScheduleTable({
  finance,
  revision,
  canCreate,
  onOpenAdvance,
}: Props) {
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [filterVendorId, setFilterVendorId] = useState<string>("all");
  const [filterUrgentOnly, setFilterUrgentOnly] = useState<boolean>(false);

  const beneficiaries = useMemo(() => finance.data.beneficiaries || [], [finance.data.beneficiaries]);
  const storedMilestones = useMemo(() => finance.data.vendorPaymentMilestones || [], [finance.data.vendorPaymentMilestones]);

  // 1. Group lines by vendor and calculate totals
  const vendorGroups: VendorGroup[] = useMemo(() => {
    const map = new Map<string, { items: typeof revision.lines; totalGross: number; totalNet: number }>();

    revision.lines.forEach((line) => {
      const vId = line.vendorId || "UNASSIGNED";
      const current = map.get(vId) || { items: [], totalGross: 0, totalNet: 0 };
      current.items.push(line);
      const gross = parseFloat(line.cost?.gross || "0") || 0;
      const net = parseFloat(line.cost?.net || "0") || 0;
      current.totalGross += gross;
      current.totalNet += net;
      map.set(vId, current);
    });

    const groups: VendorGroup[] = [];

    map.forEach((data, vId) => {
      if (vId === "UNASSIGNED") return;

      const ben = beneficiaries.find((b) => b.id === vId);
      const customMilestones = storedMilestones.filter((m) => m.vendorId === vId);

      // Default 2 installments (50% deposit, 50% settlement) if no custom milestones defined
      const defaultMilestones: VendorPaymentMilestone[] =
        customMilestones.length > 0
          ? customMilestones
          : [
              {
                id: `default-${vId}-1`,
                vendorId: vId,
                installmentNumber: 1,
                title: "Tạm ứng cọc hợp đồng",
                percentage: 50,
                amount: Math.round(data.totalGross * 0.5).toString(),
                dueDate: "",
                paymentMethod: "ADVANCE",
                conditions: "Ký hợp đồng hoặc xác nhận dịch vụ",
              },
              {
                id: `default-${vId}-2`,
                vendorId: vId,
                installmentNumber: 2,
                title: "Thanh toán hoàn tất sau nghiệm thu",
                percentage: 50,
                amount: (data.totalGross - Math.round(data.totalGross * 0.5)).toString(),
                dueDate: "",
                paymentMethod: "VENDOR_DIRECT",
                conditions: "Có biên bản bàn giao & hóa đơn VAT",
              },
            ];

      // Check disbursed cash for this vendor
      const vendorRecipientKey = `VENDOR:${vId}`;
      const disbursed = finance.cash
        .filter((c) => c.recipientKey === vendorRecipientKey && c.direction === "OUT")
        .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

      groups.push({
        vendorId: vId,
        name: ben?.name || "Nhà cung cấp chưa đặt tên",
        bank: ben?.bank || "Chưa có ngân hàng",
        account: ben?.account || "Chưa có STK",
        isVerified: Boolean(ben?.verifiedVersion),
        itemCount: data.items.length,
        totalGross: data.totalGross,
        totalNet: data.totalNet,
        milestones: defaultMilestones,
        disbursedAmount: disbursed,
      });
    });

    return groups;
  }, [revision, beneficiaries, storedMilestones, finance.cash]);

  // Overall Statistics
  const overallStats = useMemo(() => {
    const totalBudget = vendorGroups.reduce((sum, g) => sum + g.totalGross, 0);
    const totalDisbursed = vendorGroups.reduce((sum, g) => sum + g.disbursedAmount, 0);
    const remaining = Math.max(0, totalBudget - totalDisbursed);
    const percentDisbursed = totalBudget > 0 ? ((totalDisbursed / totalBudget) * 100).toFixed(1) : "0";

    return {
      totalBudget,
      totalDisbursed,
      remaining,
      percentDisbursed,
      vendorCount: vendorGroups.length,
    };
  }, [vendorGroups]);

  // Filtered groups
  const filteredGroups = useMemo(() => {
    let result = vendorGroups;
    if (filterVendorId !== "all") {
      result = result.filter((g) => g.vendorId === filterVendorId);
    }
    if (filterUrgentOnly) {
      const now = new Date().toISOString().slice(0, 10);
      result = result.filter((g) =>
        g.milestones.some((m) => m.dueDate && m.dueDate <= now)
      );
    }
    return result;
  }, [vendorGroups, filterVendorId, filterUrgentOnly]);

  // Editing vendor modal state
  const vendorBeingEdited = vendorGroups.find((g) => g.vendorId === editingVendorId);
  const [editingMilestones, setEditingMilestones] = useState<VendorPaymentMilestone[]>([]);

  const openEditModal = (vendor: VendorGroup) => {
    setEditingVendorId(vendor.vendorId);
    setEditingMilestones(structuredClone(vendor.milestones));
  };

  const handleAddMilestone = () => {
    const nextNumber = editingMilestones.length + 1;
    const newMilestone: VendorPaymentMilestone = {
      id: `new-${Date.now()}-${nextNumber}`,
      vendorId: editingVendorId!,
      installmentNumber: nextNumber,
      title: `Đợt ${nextNumber}`,
      percentage: 0,
      amount: "0",
      dueDate: "",
      paymentMethod: "VENDOR_DIRECT",
      conditions: "",
    };
    setEditingMilestones([...editingMilestones, newMilestone]);
  };

  const handleUpdateMilestone = (
    index: number,
    field: keyof VendorPaymentMilestone,
    value: string | number
  ) => {
    const copy = [...editingMilestones];
    copy[index] = { ...copy[index], [field]: value };

    // Auto-calculate amount if percentage changes
    if (field === "percentage" && vendorBeingEdited) {
      const pct = Number(value) || 0;
      copy[index].amount = Math.round((vendorBeingEdited.totalGross * pct) / 100).toString();
    }
    setEditingMilestones(copy);
  };

  const handleRemoveMilestone = (index: number) => {
    setEditingMilestones(editingMilestones.filter((_, idx) => idx !== index));
  };

  // Helper to determine milestone status
  const getMilestoneStatus = (vendorId: string, milestone: VendorPaymentMilestone) => {
    const targetKey = `VENDOR:${vendorId}`;
    const amountNum = parseFloat(milestone.amount) || 0;

    // Check if matching cash exists
    const matchingCash = finance.cash.find(
      (c) => c.recipientKey === targetKey && Math.abs(parseFloat(c.amount) - amountNum) < 1000
    );
    if (matchingCash) {
      return { tone: "success" as const, label: "Đã chi tiền", isPaid: true };
    }

    // Check if in-flight request exists
    const matchingRequest = finance.requests.find(
      (r) =>
        r.state === "SUBMITTED" &&
        r.payload?.recipientKey === targetKey &&
        Math.abs(parseFloat(r.payload?.amount || "0") - amountNum) < 1000
    );
    if (matchingRequest) {
      return {
        tone: "info" as const,
        label: `Đang duyệt (${matchingRequest.title.slice(0, 15)}...)`,
        isRequested: true,
      };
    }

    // Check due date
    if (milestone.dueDate) {
      const today = new Date().toISOString().slice(0, 10);
      if (milestone.dueDate < today) {
        return { tone: "danger" as const, label: "Quá hạn thanh toán ⚠️", isUrgent: true };
      }
      const diffDays = Math.ceil(
        (new Date(milestone.dueDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24)
      );
      if (diffDays <= 3) {
        return { tone: "warning" as const, label: `Đến hạn trong ${diffDays} ngày`, isUrgent: true };
      }
    }

    return { tone: "neutral" as const, label: "Chưa đến hạn", isPending: true };
  };

  return (
    <div className="space-y-6">
      {/* 1. TOP SUMMARY & PROGRESS BAR */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)] flex items-center gap-2">
              <Building2 size={18} className="text-[#587216]" aria-hidden="true" />
              Kế Hoạch Thanh Toán Nhà Cung Cấp & Lịch Tạm Ứng
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Phân bổ các đợt thanh toán theo từng NCC, kiểm soát hạn chi và tạo hồ sơ tạm ứng 1-click.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-secondary)]">Tổng dự toán NCC:</span>
              <strong className="font-mono text-sm tabular-nums text-[var(--foreground)]">
                {displayMoney(String(overallStats.totalBudget))}
              </strong>
            </div>
            <div className="flex items-center gap-1.5 border-l border-[var(--border)] pl-4">
              <span className="text-[var(--text-secondary)]">Đã chi / Tạm ứng:</span>
              <strong className="font-mono text-sm tabular-nums text-[var(--success)]">
                {displayMoney(String(overallStats.totalDisbursed))}
              </strong>
            </div>
            <div className="flex items-center gap-1.5 border-l border-[var(--border)] pl-4">
              <span className="text-[var(--text-secondary)]">Còn phải chi:</span>
              <strong className="font-mono text-sm tabular-nums text-[var(--warning)]">
                {displayMoney(String(overallStats.remaining))}
              </strong>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3.5 space-y-1.5">
          <div className="flex justify-between text-xs text-[var(--text-secondary)]">
            <span>Tiến độ giải ngân cho các đối tác: {overallStats.percentDisbursed}%</span>
            <span>{overallStats.vendorCount} Nhà Cung Cấp đã gán trong IC</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full bg-[#587216] transition-all"
              style={{ width: `${Math.min(100, parseFloat(overallStats.percentDisbursed))}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. TOOLBAR & FILTER */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            label="Lọc theo NCC"
            value={filterVendorId}
            onChange={(e) => setFilterVendorId(e.target.value)}
          >
            <option value="all">Tất cả NCC ({vendorGroups.length})</option>
            {vendorGroups.map((g) => (
              <option key={g.vendorId} value={g.vendorId}>
                {g.name} ({displayMoney(String(g.totalGross))})
              </option>
            ))}
          </Select>

          <Button
            variant={filterUrgentOnly ? "primary" : "secondary"}
            size="sm"
            onClick={() => setFilterUrgentOnly(!filterUrgentOnly)}
          >
            <AlertTriangle size={14} className="mr-1" />
            {filterUrgentOnly ? "Hiện tất cả đợt" : "Chỉ hiện đợt cần chi gấp"}
          </Button>
        </div>

        <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
          <Clock size={14} />
          Bấm <strong>Lập ĐNTU</strong> hoặc <strong>Lập ĐNTT</strong> để chuyển thẳng sang form chi tiền
        </div>
      </div>

      {/* 3. VENDOR SCHEDULE TABLE */}
      {filteredGroups.length > 0 ? (
        <div className="space-y-4">
          {filteredGroups.map((vendor) => {
            return (
              <Panel key={vendor.vendorId} className="p-0 overflow-hidden border-[var(--border)]">
                {/* Vendor Header */}
                <div className="p-4 bg-[var(--surface-soft)] border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-2 text-[#587216]">
                      <Building2 size={20} aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <strong className="text-base text-[var(--foreground)]">{vendor.name}</strong>
                        {vendor.isVerified ? (
                          <Badge tone="success">Đã xác minh STK</Badge>
                        ) : (
                          <Badge tone="warning">Chưa xác minh STK</Badge>
                        )}
                        <Badge tone="neutral">{vendor.itemCount} hạng mục IC</Badge>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 flex items-center gap-2">
                        <span className="flex items-center gap-1">
                          <CreditCard size={12} /> {vendor.bank} - {vendor.account}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-xs text-[var(--text-secondary)] block">Tổng ngân sách IC</span>
                      <strong className="text-base font-mono tabular-nums text-[var(--foreground)]">
                        {displayMoney(String(vendor.totalGross))}
                      </strong>
                    </div>

                    {canCreate && !finance.data.closed && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditModal(vendor)}
                        className="text-xs ml-2"
                      >
                        <SlidersHorizontal size={13} className="mr-1" />
                        Tùy chỉnh đợt chi
                      </Button>
                    )}
                  </div>
                </div>

                {/* Milestones / Installments Table */}
                <Table caption={`Lịch thanh toán cho đối tác ${vendor.name}`}>
                  <thead>
                    <tr>
                      <th scope="col" className="w-16 text-center">Đợt</th>
                      <th scope="col">Nội dung thanh toán & Điều kiện giải ngân</th>
                      <th scope="col" className="w-24 text-right">Tỷ lệ</th>
                      <th scope="col" className="w-36 text-right">Số tiền</th>
                      <th scope="col" className="w-32">Thời hạn (Due)</th>
                      <th scope="col" className="w-28 text-center">Hình thức</th>
                      <th scope="col" className="w-40 text-center">Trạng thái</th>
                      <th scope="col" className="w-36 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendor.milestones.map((milestone, mIdx) => {
                      const status = getMilestoneStatus(vendor.vendorId, milestone);

                      return (
                        <tr key={milestone.id || `m-${mIdx}`}>
                          <td className="text-center font-bold text-xs text-[var(--text-secondary)]">
                            Đợt {milestone.installmentNumber || mIdx + 1}
                          </td>
                          <td>
                            <strong className="text-sm font-semibold text-[var(--foreground)] block">
                              {milestone.title}
                            </strong>
                            {milestone.conditions && (
                              <span className="text-xs text-[var(--text-secondary)] mt-0.5 block">
                                Điều kiện: {milestone.conditions}
                              </span>
                            )}
                          </td>
                          <td className="text-right tabular-nums text-sm font-medium">
                            {milestone.percentage ? `${milestone.percentage}%` : "—"}
                          </td>
                          <td className="text-right tabular-nums font-mono text-sm font-bold text-[var(--foreground)]">
                            {displayMoney(milestone.amount)}
                          </td>
                          <td>
                            {milestone.dueDate ? (
                              <span className="text-xs font-medium tabular-nums flex items-center gap-1">
                                <Calendar size={12} className="text-[var(--text-secondary)]" />
                                {milestone.dueDate}
                              </span>
                            ) : (
                              <span className="text-xs text-[var(--text-secondary)]">Chưa đặt hạn</span>
                            )}
                          </td>
                          <td className="text-center">
                            <Badge tone={milestone.paymentMethod === "ADVANCE" ? "info" : "neutral"}>
                              {milestone.paymentMethod === "ADVANCE" ? "ĐNTU (Tạm ứng)" : "ĐNTT (Chi NCC)"}
                            </Badge>
                          </td>
                          <td className="text-center">
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </td>
                          <td className="text-right">
                            {status.isPaid ? (
                              <span className="text-xs text-[var(--success)] font-medium flex items-center justify-end gap-1">
                                <CheckCircle2 size={13} /> Hoàn tất
                              </span>
                            ) : canCreate && !finance.data.closed ? (
                              <div className="flex items-center justify-end gap-1">
                                {milestone.paymentMethod === "ADVANCE" ? (
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() =>
                                      onOpenAdvance({
                                        kind: "ADVANCE",
                                        recipientKey: `VENDOR:${vendor.vendorId}`,
                                        amount: milestone.amount,
                                        title: `Tạm ứng ${milestone.title} - ${vendor.name}`,
                                      })
                                    }
                                    className="text-xs"
                                  >
                                    <Send size={12} className="mr-1" />
                                    Lập ĐNTU
                                  </Button>
                                ) : (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() =>
                                      onOpenAdvance({
                                        kind: "VENDOR_PAYMENT",
                                        recipientKey: `VENDOR:${vendor.vendorId}`,
                                        amount: milestone.amount,
                                        title: `Thanh toán ${milestone.title} - ${vendor.name}`,
                                      })
                                    }
                                    className="text-xs"
                                  >
                                    <Send size={12} className="mr-1" />
                                    Lập ĐNTT
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--text-secondary)]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Panel>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Chưa có dữ liệu Nhà Cung Cấp trong IC"
          description="Các dòng chi phí trong IC chưa được gán Nhà Cung Cấp (NCC). Vui lòng mở Worksheet để chỉ định NCC cho từng hạng mục."
        />
      )}

      {/* 4. MODAL: EDIT PAYMENT MILESTONES FOR A VENDOR */}
      {editingVendorId && vendorBeingEdited && (
        <Dialog
          open={Boolean(editingVendorId)}
          onClose={() => setEditingVendorId(null)}
          title={`Thiết lập lịch thanh toán: ${vendorBeingEdited.name}`}
          description={`Tổng ngân sách IC của NCC này: ${displayMoney(String(vendorBeingEdited.totalGross))} (Net: ${displayMoney(String(vendorBeingEdited.totalNet))})`}
        >
          <ActionForm
            finance={finance}
            command="SAVE_VENDOR_PAYMENT_SCHEDULE"
            label="Lưu lịch thanh toán"
            onSuccess={() => setEditingVendorId(null)}
          >
            <input type="hidden" name="vendorId" value={editingVendorId} />
            <input type="hidden" name="milestones" value={JSON.stringify(editingMilestones)} />

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                <span className="text-xs font-semibold text-[var(--foreground)]">
                  Danh sách các đợt thanh toán ({editingMilestones.length} đợt)
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleAddMilestone}
                  className="text-xs"
                >
                  <Plus size={13} className="mr-1" />
                  Thêm đợt chi
                </Button>
              </div>

              {editingMilestones.map((m, idx) => (
                <div
                  key={m.id || idx}
                  className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-xs font-bold text-[var(--foreground)]">
                      Đợt {idx + 1}
                    </strong>
                    {editingMilestones.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMilestone(idx)}
                        className="text-rose-500 hover:text-rose-700 text-xs flex items-center gap-1"
                      >
                        <Trash2 size={12} /> Xóa
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input
                      label="Nội dung đợt chi"
                      value={m.title}
                      onChange={(e) => handleUpdateMilestone(idx, "title", e.target.value)}
                      required
                    />

                    <Select
                      label="Hình thức thanh toán"
                      value={m.paymentMethod}
                      onChange={(e) => handleUpdateMilestone(idx, "paymentMethod", e.target.value)}
                    >
                      <option value="ADVANCE">Đề nghị tạm ứng (ĐNTU)</option>
                      <option value="VENDOR_DIRECT">Thanh toán trực tiếp NCC (ĐNTT)</option>
                    </Select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input
                      label="Tỷ lệ (%)"
                      type="number"
                      value={m.percentage.toString()}
                      onChange={(e) => handleUpdateMilestone(idx, "percentage", e.target.value)}
                    />

                    <Input
                      label="Số tiền (VND)"
                      value={m.amount}
                      onChange={(e) => handleUpdateMilestone(idx, "amount", e.target.value)}
                      required
                    />

                    <Input
                      label="Hạn thanh toán (YYYY-MM-DD)"
                      type="date"
                      value={m.dueDate || ""}
                      onChange={(e) => handleUpdateMilestone(idx, "dueDate", e.target.value)}
                    />
                  </div>

                  <Input
                    label="Điều kiện giải ngân"
                    placeholder="VD: Sau khi ký HĐ / Khi nghiệm thu xong..."
                    value={m.conditions || ""}
                    onChange={(e) => handleUpdateMilestone(idx, "conditions", e.target.value)}
                  />
                </div>
              ))}
            </div>
          </ActionForm>
        </Dialog>
      )}
    </div>
  );
}
