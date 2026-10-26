import { readFinanceHeader, type FinanceHeader } from "./financeHeader";

// Dữ liệu bảng tài chính gửi từ trình duyệt lên khi bấm Lưu.
// Hàm ở đây kiểm tra và làm sạch trước khi ghi vào database.

export type CostLineInput = {
  id?: string;
  description: string | null;
  unit: string | null;
  icQuantity: number | null;
  icUnitPrice: number | null;
  icVatRate: number | null;
  icSupplierId: string | null;
  icNote: string | null;
};

export type SellLineInput = {
  id?: string;
  stt: string | null;
  name: string;
  description: string | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  note: string | null;
  costs: CostLineInput[];
};

export type SectionInput = {
  id?: string;
  name: string;
  lines: SellLineInput[];
};

export type FinanceSheetInput = {
  header: FinanceHeader;
  sellVatRate: number;
  sections: SectionInput[];
};

export const FINANCE_SHEET_LIMITS = {
  sections: 50,
  linesPerSection: 200,
  costsPerLine: 30,
  maxQuantity: 1_000_000_000,
  maxMoney: 10_000_000_000_000,
  maxVatRate: 0.2,
} as const;

const TEXT_LIMITS = {
  sectionName: 200,
  stt: 20,
  name: 300,
  description: 2000,
  unit: 40,
  note: 1000,
} as const;

/** Các mức VAT hay dùng, cho ô chọn trên giao diện. */
export const VAT_RATE_OPTIONS = [
  { value: null, label: "Không VAT" },
  { value: 0, label: "0%" },
  { value: 0.05, label: "5%" },
  { value: 0.08, label: "8%" },
  { value: 0.1, label: "10%" },
] as const;

class InputError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new InputError(`"${label}" không hợp lệ.`);
  const cleaned = value.normalize("NFC").trim();
  if (!cleaned) return null;
  if (cleaned.length > limit) throw new InputError(`"${label}" dài quá ${limit} ký tự.`);
  return cleaned;
}

function number(
  value: unknown,
  label: string,
  options: { max: number; decimals: number },
): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InputError(`"${label}" phải là số.`);
  }
  if (value < 0) throw new InputError(`"${label}" không được âm.`);
  if (value > options.max) throw new InputError(`"${label}" quá lớn.`);
  const factor = 10 ** options.decimals;
  return Math.round(value * factor) / factor;
}

function vatRate(value: unknown, label: string): number | null {
  return number(value, label, { max: FINANCE_SHEET_LIMITS.maxVatRate, decimals: 4 });
}

function optionalId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 40 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InputError("Dữ liệu bảng không hợp lệ. Hãy tải lại trang.");
  }
  return value;
}

function list(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value)) throw new InputError("Dữ liệu bảng không hợp lệ. Hãy tải lại trang.");
  if (value.length > max) throw new InputError(`Tối đa ${max} ${label}.`);
  return value;
}

function readCost(raw: unknown): CostLineInput {
  if (!isRecord(raw)) throw new InputError("Dữ liệu bảng không hợp lệ. Hãy tải lại trang.");
  return {
    id: optionalId(raw.id),
    description: text(raw.description, TEXT_LIMITS.description, "Nội dung chi phí"),
    unit: text(raw.unit, TEXT_LIMITS.unit, "ĐVT"),
    icQuantity: number(raw.icQuantity, "Số lượng (IC)", { max: FINANCE_SHEET_LIMITS.maxQuantity, decimals: 3 }),
    icUnitPrice: number(raw.icUnitPrice, "Đơn giá (IC)", { max: FINANCE_SHEET_LIMITS.maxMoney, decimals: 2 }),
    icVatRate: vatRate(raw.icVatRate, "VAT (IC)"),
    icSupplierId: optionalId(raw.icSupplierId) ?? null,
    icNote: text(raw.icNote, TEXT_LIMITS.note, "Ghi chú chi phí"),
  };
}

function readLine(raw: unknown, position: string): SellLineInput {
  if (!isRecord(raw)) throw new InputError("Dữ liệu bảng không hợp lệ. Hãy tải lại trang.");
  const name = text(raw.name, TEXT_LIMITS.name, "Hạng mục");
  if (!name) throw new InputError(`Hạng mục ${position} chưa có tên.`);
  return {
    id: optionalId(raw.id),
    stt: text(raw.stt, TEXT_LIMITS.stt, "STT"),
    name,
    description: text(raw.description, TEXT_LIMITS.description, "Mô tả"),
    unit: text(raw.unit, TEXT_LIMITS.unit, "ĐVT"),
    quantity: number(raw.quantity, "Số lượng", { max: FINANCE_SHEET_LIMITS.maxQuantity, decimals: 3 }),
    unitPrice: number(raw.unitPrice, "Đơn giá", { max: FINANCE_SHEET_LIMITS.maxMoney, decimals: 2 }),
    note: text(raw.note, TEXT_LIMITS.note, "Ghi chú"),
    costs: list(raw.costs, FINANCE_SHEET_LIMITS.costsPerLine, "dòng chi phí mỗi hạng mục").map(readCost),
  };
}

function readSection(raw: unknown, index: number): SectionInput {
  if (!isRecord(raw)) throw new InputError("Dữ liệu bảng không hợp lệ. Hãy tải lại trang.");
  const name = text(raw.name, TEXT_LIMITS.sectionName, "Tên nhóm");
  if (!name) throw new InputError(`Nhóm thứ ${index + 1} chưa có tên.`);
  const lines = list(raw.lines, FINANCE_SHEET_LIMITS.linesPerSection, "hạng mục mỗi nhóm");
  return {
    id: optionalId(raw.id),
    name,
    lines: lines.map((line, lineIndex) => readLine(line, `số ${lineIndex + 1} trong nhóm "${name}"`)),
  };
}

/** Kiểm tra toàn bộ bảng; lỗi trả về câu báo tiếng Việt để hiện cho người dùng. */
export function readFinanceSheetInput(raw: unknown): FinanceSheetInput | { error: string } {
  try {
    if (!isRecord(raw) || !isRecord(raw.header)) {
      throw new InputError("Dữ liệu bảng không hợp lệ. Hãy tải lại trang.");
    }
    const headerSource = raw.header;
    const header = readFinanceHeader({
      get: (name: string) => {
        const value = headerSource[name];
        return typeof value === "string" ? value : null;
      },
    });
    if ("error" in header) return header;
    const sellVatRate = vatRate(raw.sellVatRate, "VAT bán ra") ?? 0;
    const sections = list(raw.sections, FINANCE_SHEET_LIMITS.sections, "nhóm").map(readSection);
    return { header, sellVatRate, sections };
  } catch (error) {
    if (error instanceof InputError) return { error: error.message };
    throw error;
  }
}

/** Gom id đang có trong bảng gửi lên, để biết dòng nào cần xoá. */
export function collectInputIds(input: FinanceSheetInput) {
  const sections = new Set<string>();
  const lines = new Set<string>();
  const costs = new Set<string>();
  for (const section of input.sections) {
    if (section.id) sections.add(section.id);
    for (const line of section.lines) {
      if (line.id) lines.add(line.id);
      for (const cost of line.costs) if (cost.id) costs.add(cost.id);
    }
  }
  return { sections, lines, costs };
}

/** Các nhà cung cấp được chọn trong bảng (để kiểm tra còn tồn tại). */
export function collectSupplierIds(input: FinanceSheetInput) {
  const ids = new Set<string>();
  for (const section of input.sections) {
    for (const line of section.lines) {
      for (const cost of line.costs) if (cost.icSupplierId) ids.add(cost.icSupplierId);
    }
  }
  return [...ids];
}
