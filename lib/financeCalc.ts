// Tính tiền cho bảng tài chính (Báo giá + IC). Dùng chung cho giao diện và máy chủ,
// nên số trên màn hình và số lưu vào database luôn khớp nhau.
// Mọi thành tiền làm tròn tới đồng ngay ở từng dòng, rồi mới cộng.

export type CalcCostLine = {
  icQuantity: number | null;
  icUnitPrice: number | null;
  /** null = không có VAT đầu vào (vd cá nhân không xuất hoá đơn) */
  icVatRate: number | null;
};

export type CalcSellLine = {
  quantity: number | null;
  /** null = "-" (không tính tiền riêng cho khách) */
  unitPrice: number | null;
  costs: CalcCostLine[];
};

export type CalcSection = { lines: CalcSellLine[] };

/** Làm tròn tới đồng; tránh "-0". */
export function roundVnd(value: number) {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

export function sellAmount(line: Pick<CalcSellLine, "quantity" | "unitPrice">) {
  if (line.quantity === null || line.unitPrice === null) return 0;
  return roundVnd(line.quantity * line.unitPrice);
}

export function costAmount(cost: CalcCostLine) {
  if (cost.icQuantity === null || cost.icUnitPrice === null) return 0;
  return roundVnd(cost.icQuantity * cost.icUnitPrice);
}

export function costVat(cost: CalcCostLine) {
  if (!cost.icVatRate) return 0;
  return roundVnd(costAmount(cost) * cost.icVatRate);
}

export type SectionTotals = {
  sell: number;
  cost: number;
  costVat: number;
  profit: number;
};

export type SheetTotals = {
  sections: SectionTotals[];
  /** Tổng bán trước VAT */
  sellSubtotal: number;
  sellVat: number;
  /** Tổng bán gồm VAT (doanh thu dự án tính theo số này) */
  sellGross: number;
  /** Tổng giá vốn trước VAT */
  costSubtotal: number;
  costVat: number;
  costGross: number;
  /** Lợi nhuận = bán trước VAT − vốn trước VAT (giống file IC/AC) */
  profit: number;
  /** null khi chưa có giá bán */
  margin: number | null;
};

export function sheetTotals(sections: CalcSection[], sellVatRate: number): SheetTotals {
  const sectionTotals = sections.map((section) => {
    let sell = 0;
    let cost = 0;
    let vat = 0;
    for (const line of section.lines) {
      sell += sellAmount(line);
      for (const item of line.costs) {
        cost += costAmount(item);
        vat += costVat(item);
      }
    }
    return { sell, cost, costVat: vat, profit: sell - cost };
  });
  const sellSubtotal = sectionTotals.reduce((sum, item) => sum + item.sell, 0);
  const costSubtotal = sectionTotals.reduce((sum, item) => sum + item.cost, 0);
  const costVatTotal = sectionTotals.reduce((sum, item) => sum + item.costVat, 0);
  const sellVat = roundVnd(sellSubtotal * sellVatRate);
  const profit = sellSubtotal - costSubtotal;
  return {
    sections: sectionTotals,
    sellSubtotal,
    sellVat,
    sellGross: sellSubtotal + sellVat,
    costSubtotal,
    costVat: costVatTotal,
    costGross: costSubtotal + costVatTotal,
    profit,
    margin: sellSubtotal > 0 ? profit / sellSubtotal : null,
  };
}

/** "36,6%" — một chữ số thập phân, dấu phẩy kiểu Việt Nam. */
export function formatMargin(margin: number | null) {
  if (margin === null) return "—";
  return `${(margin * 100).toFixed(1).replace(".", ",")}%`;
}

/** "45.580.000" */
export function formatVndNumber(value: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
}
