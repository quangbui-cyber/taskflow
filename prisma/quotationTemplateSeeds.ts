import type { PrismaClient } from "@prisma/client";
import type { PairedRow } from "../lib/costflow/types";
import type { FormulaNode, ParameterBinding, QuotationParameterSnapshot } from "../lib/costflow/quotationParameters";

export const TEAMBUILDING_TEMPLATE_ID = "quotation-template-teambuilding-line-pricing-v3";
export const TEAMBUILDING_TEMPLATE_NAME = "Báo giá mẫu — Teambuilding (tham số)";
export const TEAMBUILDING_TEMPLATE_DESCRIPTION =
  "Loại project: Teambuilding. Template Line Pricing v3 cho chương trình 2 ngày; Account phải rà soát lại số người, số ngày, số đêm, số phòng, đơn giá và VAT trước khi sử dụng.";

const blankBuy = () => ({
  unit: "",
  quantity: "",
  days: "",
  unitPrice: "",
  vatPercent: "",
  basis: "NET" as const,
  notes: "",
  vendorId: "",
  evidenceIds: [] as string[],
  evidenceReason: "",
});

function group(itemId: string, name: string): PairedRow {
  return {
    itemId,
    parentItemId: null,
    rowType: "GROUP",
    name,
    description: "",
    pricingMode: "DETAIL",
    showChildren: true,
    showGroupSubtotal: true,
    packageChildDisplay: "CONTENT",
    sell: { unit: "", quantity: "", days: "", unitPrice: "", vatPercent: "8", basis: "NET", notes: "" },
    buy: blankBuy(),
  };
}

type ItemOptions = {
  description?: string;
  unit?: string;
  quantity?: number;
  days?: number;
  unitPrice?: number;
  note?: string;
  parentItemId?: string;
  focReferencePrice?: number;
  optional?: boolean;
  complimentaryReferencePrice?: number;
  quantityFormula?: FormulaNode;
  daysFormula?: FormulaNode;
};

function money(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function item(itemId: string, parentItemId: string, name: string, options: ItemOptions = {}): PairedRow {
  const sourceQuantity = options.quantity;
  const days = options.days ?? 1;
  const notes = [
    options.note,
    options.optional ? "Optional — chưa tính vào tổng; nhập lại số lượng khi khách chọn." : undefined,
    options.focReferencePrice !== undefined ? `FOC; đơn giá tham chiếu ${money(options.focReferencePrice)} VND.` : undefined,
    options.complimentaryReferencePrice !== undefined ? `Ga tặng; đơn giá tham chiếu ${money(options.complimentaryReferencePrice)} VND.` : undefined,
  ].filter(Boolean).join(" ");
  const quantity = options.optional
    ? ""
    : sourceQuantity === undefined
      ? ""
      : String(sourceQuantity);
  const unitPrice = options.focReferencePrice !== undefined || options.complimentaryReferencePrice !== undefined
    ? "0"
    : options.unitPrice === undefined
      ? ""
      : String(options.unitPrice);
  return {
    itemId,
    parentItemId,
    rowType: "ITEM",
    name,
    description: options.description ?? "",
    pricingMode: "DETAIL",
    showChildren: true,
    showGroupSubtotal: true,
    packageChildDisplay: "CONTENT",
    sell: {
      unit: options.unit ?? "", quantity, days: String(days), unitPrice, vatPercent: "8", basis: "NET", notes,
      ...(options.quantityFormula || options.daysFormula ? { parameterBinding: { mode: "FORMULA", moduleId: parentItemId, ...(options.quantityFormula ? { quantityFormula: options.quantityFormula } : {}), ...(options.daysFormula ? { daysFormula: options.daysFormula } : {}), lastCalculated: { quantity, days: String(days) } } satisfies ParameterBinding } : {}),
    },
    buy: blankBuy(),
  };
}

function parentItem(itemId: string, parentItemId: string, name: string): PairedRow {
  return item(itemId, parentItemId, name, { note: "Dòng nhóm chi tiết; chưa tính tiền trực tiếp." });
}

export const TEAMBUILDING_TEMPLATE_SNAPSHOT = {
  linePricingSchemaVersion: 2 as const,
  parameterConfig: {
    schemaVersion: 1,
    definitions: [
      { key: "participants", label: "Số người", defaultValue: "85", scope: "SHARED" },
      { key: "days", label: "Số ngày", defaultValue: "2", scope: "SHARED" },
      { key: "nights", label: "Số đêm", defaultValue: "1", scope: "SHARED" },
      { key: "rooms", label: "Số phòng", defaultValue: "43", scope: "SHARED" },
    ],
    sharedValues: { participants: "85", days: "2", nights: "1", rooms: "43" },
    modules: [
      { id: "tb-a", label: "Ý tưởng và thiết kế", eventType: "Teambuilding", overrides: {} },
      { id: "tb-b", label: "Di chuyển", eventType: "Teambuilding", overrides: {} },
      { id: "tb-c", label: "Ăn uống - lưu trú", eventType: "Teambuilding", overrides: {} },
      { id: "tb-d", label: "Hoạt động Teambuilding", eventType: "Teambuilding", overrides: {} },
      { id: "tb-e", label: "Gala dinner ballroom", eventType: "Gala", overrides: {} },
      { id: "tb-f", label: "Nhân sự", eventType: "Production", overrides: {} },
      { id: "tb-g", label: "Chi phí khác", eventType: "Teambuilding", overrides: {} },
    ],
  } satisfies QuotationParameterSnapshot,
  notes: [
    "LOẠI PROJECT: TEAMBUILDING.",
    "Template tham khảo từ bảng báo giá mẫu do người dùng cung cấp ngày 06/10/2026.",
    "VAT mặc định 8% theo cấu hình dòng mới hiện tại; Account phải rà soát VAT, giá bán và các dòng phí trước khi chốt.",
    "Thành tiền mỗi dòng = số lượng × số ngày × đơn giá; số ngày chương trình chỉ cấp giá trị cho công thức số ngày của từng dòng.",
  ].join(" "),
  rows: [
    group("tb-a", "A. Ý TƯỞNG VÀ THIẾT KẾ"),
    item("tb-a-1", "tb-a", "Ý tưởng thiết kế xuyên suốt chương trình", { unit: "Gói", quantity: 1, days: 1, focReferencePrice: 3_000_000 }),

    group("tb-b", "B. DI CHUYỂN"),
    item("tb-b-1", "tb-b", "Xe 29c", { unit: "Xe", quantity: 4, days: 1, unitPrice: 9_000_000 }),

    group("tb-c", "C. ĂN UỐNG - LƯU TRÚ"),
    item("tb-c-1", "tb-c", "Lưu trú", { description: "Lan Rừng", unit: "Phòng", quantity: 43, days: 1, unitPrice: 1_650_000, quantityFormula: { op: "MUL", left: { op: "PARAM", key: "rooms" }, right: { op: "PARAM", key: "nights" } } }),
    item("tb-c-2", "tb-c", "Ăn sáng", { description: "Bánh canh Long Hương", unit: "Người", quantity: 85, days: 1, unitPrice: 75_000, quantityFormula: { op: "PARAM", key: "participants" } }),
    item("tb-c-3", "tb-c", "Ăn trưa ngày 1", { description: "Ăn trưa dã chiến rừng Phước Bửu", unit: "Người", quantity: 85, days: 1, unitPrice: 180_000, quantityFormula: { op: "PARAM", key: "participants" } }),
    item("tb-c-4", "tb-c", "Galadinner tối ngày 1", { unit: "Người", quantity: 85, days: 1, unitPrice: 450_000, quantityFormula: { op: "PARAM", key: "participants" } }),
    item("tb-c-5", "tb-c", "Ăn trưa ngày 2", { description: "Cơm Niêu Long Hương", unit: "Người", quantity: 85, days: 1, unitPrice: 150_000, quantityFormula: { op: "PARAM", key: "participants" } }),
    item("tb-c-6", "tb-c", "Bánh bông lan trứng muối", { unit: "Phần", quantity: 85, days: 1, unitPrice: 80_000, quantityFormula: { op: "PARAM", key: "participants" } }),
    parentItem("tb-c-7", "tb-c", "Menu nước"),
    item("tb-c-7-1", "tb-c-7", "Bia Heineken", { unit: "Lon", days: 1, unitPrice: 45_000 }),
    item("tb-c-7-2", "tb-c-7", "Nước ngọt", { unit: "Lon", days: 1, unitPrice: 35_000 }),
    item("tb-c-7-3", "tb-c-7", "Nước suối", { unit: "Chai", days: 1, unitPrice: 30_000 }),

    group("tb-d", "D. HOẠT ĐỘNG TEAMBUILDING"),
    item("tb-d-1", "tb-d", "Trekking rừng Phước Bửu", { unit: "Vé", quantity: 85, days: 1, unitPrice: 50_000, quantityFormula: { op: "PARAM", key: "participants" } }),
    item("tb-d-2", "tb-d", "Kiểm Lâm", { unit: "Người", quantity: 4, days: 1, unitPrice: 700_000 }),
    item("tb-d-3", "tb-d", "Âm thanh team", { unit: "Gói", quantity: 1, days: 1, unitPrice: 3_000_000 }),
    item("tb-d-4", "tb-d", "Game Teambuilding", { unit: "Gói", quantity: 1, days: 1, unitPrice: 5_000_000 }),
    item("tb-d-5", "tb-d", "Backdrop Team Building", { description: "KT: 5m x 3m", unit: "m2", quantity: 15, days: 1, unitPrice: 350_000 }),
    parentItem("tb-d-6", "tb-d", "Thuê bàn ghế camping"),
    item("tb-d-6-1", "tb-d-6", "Ghế", { unit: "Cái", quantity: 85, days: 1, unitPrice: 50_000, optional: true }),
    item("tb-d-6-2", "tb-d-6", "Bàn", { unit: "Cái", quantity: 22, days: 1, unitPrice: 100_000, optional: true }),

    group("tb-e", "E. GALA DINNER BALLROOM"),
    item("tb-e-1", "tb-e", "Âm thanh ánh sáng", { unit: "Gói", quantity: 1, days: 1, unitPrice: 9_000_000 }),
    item("tb-e-2", "tb-e", "Sân khấu", { unit: "m2", quantity: 18, days: 1, unitPrice: 300_000 }),
    item("tb-e-3", "tb-e", "LED", { description: "4m3 x 2m6", unit: "Gói", quantity: 1, days: 1, unitPrice: 4_500_000 }),

    group("tb-f", "F. NHÂN SỰ"),
    item("tb-f-1", "tb-f", "Project Leader", { unit: "Người-ngày", quantity: 1, days: 2, unitPrice: 1_000_000, daysFormula: { op: "PARAM", key: "days" } }),
    item("tb-f-2", "tb-f", "Supporter", { description: "Hỗ trợ logistic", unit: "Người-ngày", quantity: 2, days: 2, unitPrice: 700_000, daysFormula: { op: "PARAM", key: "days" } }),
    item("tb-f-3", "tb-f", "MC", { description: "Teambuilding + Gala", unit: "Show", quantity: 1, days: 1, unitPrice: 8_000_000 }),
    item("tb-f-4", "tb-f", "Band nhạc", { unit: "Gói", quantity: 1, days: 1, unitPrice: 9_000_000 }),
    item("tb-f-5", "tb-f", "Hướng dẫn viên", { unit: "Người-ngày", quantity: 4, days: 2, unitPrice: 700_000, daysFormula: { op: "PARAM", key: "days" } }),
    item("tb-f-6", "tb-f", "DJ", { unit: "Show", quantity: 1, days: 1, unitPrice: 5_000_000 }),
    item("tb-f-7", "tb-f", "Quay phim - chụp hình", { description: "1 quay\n1 chụp\nClip recap", unit: "Gói", quantity: 1, days: 1, unitPrice: 9_000_000 }),

    group("tb-g", "G. CHI PHÍ KHÁC"),
    item("tb-g-1", "tb-g", "Chi phí lưu trú và ăn uống nhân sự", { unit: "Gói", quantity: 1, days: 1, unitPrice: 3_000_000 }),
    item("tb-g-2", "tb-g", "Chi phí vận chuyển setup", { unit: "Gói", quantity: 1, days: 1, unitPrice: 3_000_000 }),
    item("tb-g-3", "tb-g", "Bảo hiểm", { unit: "Gói", quantity: 85, days: 2, unitPrice: 10_000, quantityFormula: { op: "PARAM", key: "participants" }, daysFormula: { op: "PARAM", key: "days" } }),
    item("tb-g-4", "tb-g", "Workshop", { unit: "Người", quantity: 85, days: 1, unitPrice: 50_000, quantityFormula: { op: "PARAM", key: "participants" } }),
    item("tb-g-5", "tb-g", "Bình nước", { unit: "Cái", quantity: 85, days: 1, complimentaryReferencePrice: 50_000, quantityFormula: { op: "PARAM", key: "participants" } }),
  ],
  totalLines: [],
  totalLayout: [
    { id: "SYSTEM_NET", label: "TỔNG TIỀN CHƯA BAO GỒM THUẾ" },
    { id: "SYSTEM_VAT", label: "VAT" },
    { id: "SYSTEM_GROSS", label: "TỔNG TIỀN BAO GỒM THUẾ" },
  ],
};

export async function seedQuotationTemplates(prisma: PrismaClient, createdBy: string) {
  const existing = await prisma.quotationTemplate.findUnique({ where: { id: TEAMBUILDING_TEMPLATE_ID } });
  if (existing) return { template: existing, created: false };
  const template = await prisma.quotationTemplate.create({
    data: {
      id: TEAMBUILDING_TEMPLATE_ID,
      name: TEAMBUILDING_TEMPLATE_NAME,
      description: TEAMBUILDING_TEMPLATE_DESCRIPTION,
      snapshot: TEAMBUILDING_TEMPLATE_SNAPSHOT,
      status: "ACTIVE",
      createdBy,
    },
  });
  return { template, created: true };
}
