import type { IcRevision, VendorPaymentMilestone } from "./types";

function vnd(value: string, label: string) {
  if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) throw new Error(`${label} phải là số nguyên VND dương.`);
  return BigInt(value);
}

export function normalizeVendorPaymentSchedule(input: {
  revision: IcRevision;
  vendorId: string;
  milestones: VendorPaymentMilestone[];
}) {
  const { revision, vendorId } = input;
  if (!revision.effective) throw new Error("Lịch thanh toán chỉ được lập từ IC đang hiệu lực.");
  const vendorLines = revision.lines.filter(line => line.vendorId === vendorId);
  if (!vendorLines.length) throw new Error("NCC không có hạng mục trong IC hiệu lực.");
  const lineById = new Map(vendorLines.map(line => [line.id, line]));
  const allocatedByLine = new Map<string, bigint>();
  const vendorBudget = vendorLines.reduce((total, line) => total + BigInt(line.cost?.gross ?? "0"), BigInt(0));

  const milestones = input.milestones.map((milestone, index) => {
    if (milestone.vendorId && milestone.vendorId !== vendorId) throw new Error("Đợt chi chứa NCC không khớp.");
    if (milestone.revisionId && milestone.revisionId !== revision.id) throw new Error("Đợt chi không thuộc IC hiệu lực hiện tại.");
    if (milestone.paymentMethod !== "ADVANCE") throw new Error("Trước khi có AC, khoản chi NCC phải phát hành dưới ĐNTU.");
    const title = String(milestone.title ?? "").trim();
    if (!title) throw new Error(`Đợt ${index + 1} thiếu nội dung.`);
    if (milestone.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(milestone.dueDate)) throw new Error(`Hạn thanh toán đợt ${index + 1} không hợp lệ.`);
    const allocations = milestone.lineAllocations ?? [];
    if (!allocations.length) throw new Error(`Đợt ${index + 1} phải chọn ít nhất một hạng mục từ IC.`);
    const seen = new Set<string>();
    let allocated = BigInt(0);
    const lineAllocations = allocations.map(allocation => {
      if (seen.has(allocation.lineId)) throw new Error(`Đợt ${index + 1} bị trùng hạng mục IC.`);
      seen.add(allocation.lineId);
      const line = lineById.get(allocation.lineId);
      if (!line) throw new Error(`Đợt ${index + 1} chứa hạng mục không thuộc NCC hoặc IC hiện tại.`);
      const amount = vnd(String(allocation.amount ?? ""), `Số tiền phân bổ cho ${line.description || "hạng mục IC"}`);
      allocated += amount;
      allocatedByLine.set(line.id, (allocatedByLine.get(line.id) ?? BigInt(0)) + amount);
      return { lineId: line.id, amount: amount.toString() };
    });
    const amount = vnd(String(milestone.amount ?? ""), `Số tiền đợt ${index + 1}`);
    if (amount !== allocated) throw new Error(`Số tiền đợt ${index + 1} phải bằng tổng phân bổ các hạng mục IC.`);
    return {
      ...milestone,
      vendorId,
      revisionId: revision.id,
      installmentNumber: index + 1,
      title,
      amount: amount.toString(),
      percentage: vendorBudget > BigInt(0) ? Number((amount * BigInt(10_000)) / vendorBudget) / 100 : 0,
      paymentMethod: "ADVANCE" as const,
      kind: milestone.kind === "AD_HOC" ? "AD_HOC" as const : "PLANNED" as const,
      lineAllocations,
    };
  });

  for (const [lineId, allocated] of allocatedByLine) {
    const line = lineById.get(lineId)!;
    const budget = BigInt(line.cost?.gross ?? "0");
    if (allocated > budget) throw new Error(`${line.description || "Hạng mục IC"}: tổng lịch chi vượt ngân sách GROSS của dòng IC.`);
  }
  const scheduled = milestones.reduce((total, milestone) => total + BigInt(milestone.amount), BigInt(0));
  if (scheduled > vendorBudget) throw new Error("Tổng lịch chi vượt ngân sách GROSS của NCC trong IC.");
  return milestones;
}
