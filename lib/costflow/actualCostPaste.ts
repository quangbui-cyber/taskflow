export const ACTUAL_COST_PASTE_COLUMNS = ["Loại", "Hạng mục IC", "Nội dung chi", "Người nhận / NCC", "SL", "Ngày", "Đơn vị", "Đơn giá", "VAT %", "Nguồn tiền", "Lý do ngoài IC"];

const FUNDING = new Map([
  ["tạm ứng nhân sự", "EMPLOYEE_ADVANCE"],
  ["nhân sự tự chi", "EMPLOYEE_OUT_OF_POCKET"],
  ["tạm ứng ncc", "VENDOR_ADVANCE"],
  ["thanh toán ncc", "VENDOR_PAYMENT"],
]);

export type ActualCostPasteLine = {
  sourceKind: "IC_LINKED" | "UNBUDGETED";
  icLineId: string;
  recipientKey: string;
  description: string;
  reason: string;
  fundingSource: string;
  quantity: string;
  days: string;
  unitPrice: string;
  unit: string;
  basis: "NET";
  vatPercent: string;
};

export function parseActualCostPaste(
  text: string,
  revision: { lines: { id: string; description: string }[] } | undefined,
  recipients: { key: string; label: string }[],
) {
  const inputRows = text.replace(/[\r\n]+$/, "").split(/\r?\n/).filter(row => row.trim());
  if (inputRows[0]?.toLocaleLowerCase("vi").startsWith("loại\t")) inputRows.shift();
  const rows = inputRows.map((row, index) => {
    const cells = row.split("\t").map(value => value.trim());
    const errors: string[] = [];
    if (cells.length === ACTUAL_COST_PASTE_COLUMNS.length - 1) cells.push("");
    if (cells.length !== ACTUAL_COST_PASTE_COLUMNS.length) errors.push(`Cần ${ACTUAL_COST_PASTE_COLUMNS.length - 1} hoặc ${ACTUAL_COST_PASTE_COLUMNS.length} cột, hiện có ${cells.length}.`);
    if (cells[0]?.toLocaleLowerCase("vi") !== "ic" && cells[0]?.toLocaleLowerCase("vi") !== "ngoài ic") errors.push("Loại phải là IC hoặc Ngoài IC.");
    const sourceKind = cells[0]?.toLocaleLowerCase("vi") === "ngoài ic" ? "UNBUDGETED" : "IC_LINKED";
    const icLine = revision?.lines.find(line => line.id === cells[1] || line.description.toLocaleLowerCase("vi") === cells[1]?.toLocaleLowerCase("vi"));
    if (sourceKind === "IC_LINKED" && !icLine) errors.push("Chưa khớp hạng mục IC hiện hành.");
    const recipientMatches = recipients.filter(item => item.key === cells[3] || item.label.toLocaleLowerCase("vi") === cells[3]?.toLocaleLowerCase("vi"));
    const recipient = recipientMatches[0];
    if (!recipient) errors.push("Chưa khớp người nhận hoặc NCC trong Project.");
    if (recipientMatches.length > 1) errors.push("Tên người nhận trùng; hãy dùng mã người nhận hiển thị trong chi tiết khoản chi.");
    if (!cells[2]) errors.push("Thiếu nội dung chi.");
    if (!Number.isFinite(Number(cells[4])) || Number(cells[4]) <= 0) errors.push("SL phải lớn hơn 0.");
    if (!Number.isFinite(Number(cells[5])) || Number(cells[5]) <= 0) errors.push("Số ngày phải lớn hơn 0.");
    if (!cells[6]) errors.push("Thiếu đơn vị.");
    if (!Number.isFinite(Number(cells[7])) || Number(cells[7]) < 0 || !cells[7]) errors.push("Đơn giá không hợp lệ.");
    if (!Number.isFinite(Number(cells[8])) || Number(cells[8]) < 0 || Number(cells[8]) > 100 || !cells[8]) errors.push("VAT phải từ 0 đến 100%.");
    const fundingSource = FUNDING.get(cells[9]?.toLocaleLowerCase("vi")) ?? (Array.from(FUNDING.values()).includes(cells[9]) ? cells[9] : "");
    if (!fundingSource) errors.push("Nguồn tiền chưa khớp một trong bốn lựa chọn.");
    if (sourceKind === "UNBUDGETED" && !cells[10]) errors.push("Phát sinh ngoài IC cần lý do.");
    const line: ActualCostPasteLine = {
      sourceKind,
      icLineId: icLine?.id ?? "",
      recipientKey: recipient?.key ?? "",
      description: cells[2] ?? "",
      reason: cells[10] ?? "",
      fundingSource,
      quantity: cells[4] ?? "",
      days: cells[5] ?? "",
      unit: cells[6] ?? "",
      unitPrice: cells[7] ?? "",
      vatPercent: cells[8] ?? "",
      basis: "NET",
    };
    return { number: index + 1, cells, errors, line };
  });
  return { rows, tooMany: rows.length > 100, ready: rows.length > 0 && rows.length <= 100 && rows.every(row => row.errors.length === 0) };
}
