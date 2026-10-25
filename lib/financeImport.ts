import type { Cell, Workbook, Worksheet } from "exceljs";
import { toDateInputVN } from "./dates";
import { costAmount, costVat, roundVnd, sellAmount, sheetTotals, type SheetTotals } from "./financeCalc";
import { searchKey } from "./supplierMatch";

// Đọc file IC/AC Excel theo mẫu công ty. Tìm cột theo chữ tiêu đề ("HẠNG MỤC", "ĐVT",
// "ĐƠN GIÁ"…) chứ không cố định vị trí cột, nên đọc được cả file IC (Báo giá + IC)
// lẫn file AC (Báo giá + Nghiệm thu + IC + AC). Đồng thời kiểm lỗi bằng code.

// ---------- Kết quả ----------

export type ImportSeverity = "error" | "warning" | "info";

export type ImportIssue = {
  code: string;
  severity: ImportSeverity;
  title: string;
  detail?: string;
};

export type ImportedCost = {
  description: string | null;
  unit: string | null;
  icQuantity: number | null;
  icUnitPrice: number | null;
  icVatRate: number | null;
  icSupplierId: string | null;
  /** Tên ghi ở cột SUP trong file (kể cả khi chưa có trong danh bạ). */
  supplierName: string | null;
  icNote: string | null;
  row: number;
};

export type ImportedLine = {
  stt: string | null;
  name: string;
  description: string | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  note: string | null;
  costs: ImportedCost[];
  row: number;
};

export type ImportedSection = { name: string; lines: ImportedLine[] };

export type ImportedHeader = {
  clientName: string;
  programName: string;
  headcount: string;
  location: string;
  eventStart: string; // yyyy-MM-dd hoặc ""
  eventEnd: string;
};

export type FinanceImportResult = {
  sheetName: string;
  header: ImportedHeader;
  sellVatRate: number;
  sections: ImportedSection[];
  totals: SheetTotals;
  /** File có khối Nghiệm thu / AC (sẽ dùng khi làm phần AC). */
  hasAcceptance: boolean;
  acCostTotal: number | null;
  unmatchedSuppliers: string[];
  issues: ImportIssue[];
};

export type ImportContext = {
  suppliers: { id: string; name: string; shortName: string | null }[];
  /** Tên các Client trong danh mục, để phát hiện sheet copy từ file khách khác. */
  clientNames: string[];
};

export class FinanceImportError extends Error {}

// ---------- Đọc ô ----------

type Raw = { value: number | string | Date | null; formula: string | null; error: string | null };

function readCell(cell: Cell): Raw {
  const value = cell.value as unknown;
  if (value === null || value === undefined) return { value: null, formula: null, error: null };
  if (typeof value === "number" || typeof value === "string") {
    return { value, formula: null, error: null };
  }
  if (value instanceof Date) return { value, formula: null, error: null };
  if (typeof value === "boolean") return { value: null, formula: null, error: null };
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.error === "string") return { value: null, formula: null, error: record.error };
    if ("formula" in record || "sharedFormula" in record) {
      // Ô dùng công thức chung chỉ lưu địa chỉ ô gốc; `cell.formula` trả về công thức đã dịch
      // cho đúng ô này (vd "V12*8%"), cần để đọc thuế suất.
      const formula = String((cell as { formula?: string }).formula ?? record.formula ?? "");
      const result = record.result as unknown;
      if (result && typeof result === "object" && "error" in (result as object)) {
        return { value: null, formula, error: String((result as { error: unknown }).error) };
      }
      if (typeof result === "number" || typeof result === "string" || result instanceof Date) {
        return { value: result, formula, error: null };
      }
      return { value: null, formula, error: null };
    }
    if (Array.isArray(record.richText)) {
      const text = (record.richText as { text?: string }[]).map((part) => part.text ?? "").join("");
      return { value: text, formula: null, error: null };
    }
    if (typeof record.text === "string") return { value: record.text, formula: null, error: null };
  }
  return { value: null, formula: null, error: null };
}

function text(raw: Raw): string | null {
  if (raw.value === null) return null;
  if (raw.value instanceof Date) return toDateInputVN(raw.value);
  const value = String(raw.value).normalize("NFC").replace(/\s+/g, " ").trim();
  return value || null;
}

function numberOf(raw: Raw): number | null {
  if (typeof raw.value === "number" && Number.isFinite(raw.value)) return raw.value;
  if (typeof raw.value === "string") {
    const cleaned = raw.value.replace(/\s/g, "");
    if (/^-?\d+([.,]\d+)?$/.test(cleaned)) return Number(cleaned.replace(",", "."));
  }
  return null;
}

/** Ô ghi "-" nghĩa là không tính tiền riêng. */
function isDash(raw: Raw) {
  return typeof raw.value === "string" && /^[-–—]+$/.test(raw.value.trim());
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const hasFraction2 = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) > 1e-6;

// ---------- Tiêu đề cột ----------

type Field =
  | "stt"
  | "name"
  | "description"
  | "unit"
  | "quantity"
  | "unitPrice"
  | "amount"
  | "note"
  | "vat"
  | "total"
  | "supplier";

const FIELD_BY_LABEL: Record<string, Field> = {
  stt: "stt",
  "hang muc": "name",
  "mo ta": "description",
  dvt: "unit",
  "so luong": "quantity",
  sl: "quantity",
  "don gia": "unitPrice",
  "thanh tien": "amount",
  "ghi chu": "note",
  vat: "vat",
  "tong cong": "total",
  sup: "supplier",
  ncc: "supplier",
  "nha cung cap": "supplier",
};

type Block = {
  columns: Partial<Record<Field, number>>;
  first: number;
  last: number;
  marker: string;
};

function labelKey(value: string | null) {
  return value ? searchKey(value) : "";
}

function findHeaderRow(sheet: Worksheet) {
  const limit = Math.min(sheet.rowCount, 60);
  for (let row = 1; row <= limit; row += 1) {
    const labels = new Set<string>();
    sheet.getRow(row).eachCell({ includeEmpty: false }, (cell) => {
      labels.add(labelKey(text(readCell(cell))));
    });
    if (labels.has("hang muc") && labels.has("dvt")) return row;
  }
  return null;
}

/** Chia dòng tiêu đề thành các khối (Báo giá, Nghiệm thu, IC, AC…), ngăn bởi cột trống. */
function readBlocks(sheet: Worksheet, headerRow: number): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let lastColumn = 0;
  const row = sheet.getRow(headerRow);
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const label = labelKey(text(readCell(row.getCell(column))));
    const field = FIELD_BY_LABEL[label];
    if (!label) continue;
    const startNew =
      !current ||
      column - lastColumn > 1 ||
      field === "stt" ||
      (field !== undefined && current.columns[field] !== undefined);
    if (startNew) {
      current = { columns: {}, first: column, last: column, marker: "" };
      blocks.push(current);
    }
    if (current) {
      if (field && current.columns[field] === undefined) current.columns[field] = column;
      current.last = column;
    }
    lastColumn = column;
  }
  // Nhãn khối ở 1–2 dòng phía trên tiêu đề: "BÁO GIÁ", "NGHIỆM THU", "INTERNAL COST", "ACTUAL COST".
  for (const block of blocks) {
    for (let r = Math.max(1, headerRow - 2); r < headerRow; r += 1) {
      for (let c = block.first; c <= block.last; c += 1) {
        const label = labelKey(text(readCell(sheet.getRow(r).getCell(c))));
        if (label) block.marker = `${block.marker} ${label}`.trim();
      }
    }
  }
  return blocks;
}

function classifyBlocks(blocks: Block[]) {
  const sellLike = blocks.filter((block) => block.columns.name !== undefined);
  const costLike = blocks.filter(
    (block) =>
      block.columns.name === undefined &&
      block.columns.unitPrice !== undefined &&
      (block.columns.amount !== undefined || block.columns.quantity !== undefined),
  );
  const markedAccepted = sellLike.find((block) => block.marker.includes("nghiem thu"));
  const quote = sellLike.find((block) => block !== markedAccepted) ?? null;
  const accepted = markedAccepted ?? sellLike.find((block) => block !== quote) ?? null;
  const isAc = (block: Block) => /\bactual\b|^ac\b/.test(block.marker);
  const markedAc = costLike.find(isAc);
  const ic = costLike.find((block) => !isAc(block)) ?? null;
  const ac = markedAc ?? costLike.find((block) => block !== ic) ?? null;
  return { quote, accepted, ic, ac };
}

// ---------- Thông tin chung ----------

function parseDateText(value: string): string {
  const match = value.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function readHeader(sheet: Worksheet, headerRow: number, lastColumn: number): ImportedHeader {
  const header: ImportedHeader = {
    clientName: "",
    programName: "",
    headcount: "",
    location: "",
    eventStart: "",
    eventEnd: "",
  };
  for (let r = 1; r < headerRow; r += 1) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= lastColumn; c += 1) {
      const raw = readCell(row.getCell(c));
      const cellText = text(raw);
      if (!cellText) continue;
      const [labelPart, ...rest] = cellText.split(":");
      const label = labelKey(labelPart);
      const target =
        label === "khach hang"
          ? "clientName"
          : label === "thoi gian"
            ? "eventTime"
            : label === "so luong"
              ? "headcount"
              : label === "dia diem"
                ? "location"
                : label === "du an" || label === "chuong trinh" || label === "ten chuong trinh"
                  ? "programName"
                  : null;
      if (!target) continue;
      // Giá trị nằm sau dấu ":" trong cùng ô, hoặc ở ô kế bên.
      let valueRaw: Raw | null = null;
      let valueText = rest.join(":").replace(/[.…]{2,}/g, "").trim() || null;
      if (!valueText) {
        for (let next = c + 1; next <= Math.min(lastColumn, c + 4); next += 1) {
          const candidate = readCell(row.getCell(next));
          const candidateText = text(candidate);
          if (candidateText) {
            valueRaw = candidate;
            valueText = candidateText;
            break;
          }
        }
      }
      if (!valueText) continue;
      if (target === "eventTime") {
        header.eventStart =
          valueRaw?.value instanceof Date ? toDateInputVN(valueRaw.value) : parseDateText(valueText);
      } else {
        header[target] = valueText;
      }
    }
  }
  return header;
}

// ---------- Đọc dòng ----------

const ROMAN_SECTION = /^[IVXLC]+\s*[.)]\s*\S/i;

function vatRateFrom(vatRaw: Raw, amount: number): number | null {
  const percent = vatRaw.formula?.match(/\*\s*(\d+(?:[.,]\d+)?)\s*%/);
  if (percent) {
    const rate = Number(percent[1].replace(",", ".")) / 100;
    return rate > 0 ? rate : null;
  }
  const vat = numberOf(vatRaw);
  if (!vat || !amount) return null;
  const ratio = vat / amount;
  const standard = [0.05, 0.08, 0.1].find((rate) => Math.abs(rate - ratio) < 0.0005);
  return standard ?? Math.round(ratio * 10000) / 10000;
}

type RowCells = (field: Field) => Raw;

function cellsOf(sheet: Worksheet, rowNumber: number, block: Block | null): RowCells {
  const row = sheet.getRow(rowNumber);
  return (field) => {
    const column = block?.columns[field];
    return column ? readCell(row.getCell(column)) : { value: null, formula: null, error: null };
  };
}

// ---------- Hàm chính ----------

/** Chọn sheet có bảng IC/AC (sheet đầu tiên có dòng tiêu đề "HẠNG MỤC" + "ĐVT"). */
function pickSheet(workbook: Workbook) {
  for (const sheet of workbook.worksheets) {
    if (sheet.state && sheet.state !== "visible") continue;
    const headerRow = findHeaderRow(sheet);
    if (headerRow) return { sheet, headerRow };
  }
  return null;
}

export function parseFinanceWorkbook(workbook: Workbook, context: ImportContext): FinanceImportResult {
  const picked = pickSheet(workbook);
  if (!picked) {
    throw new FinanceImportError(
      'Không tìm thấy bảng IC trong file. File cần có dòng tiêu đề gồm "HẠNG MỤC" và "ĐVT".',
    );
  }
  const { sheet, headerRow } = picked;
  const { quote, accepted, ic, ac } = classifyBlocks(readBlocks(sheet, headerRow));
  if (!quote) throw new FinanceImportError('Không tìm thấy khối Báo giá (cột "HẠNG MỤC").');

  const issues: ImportIssue[] = [];
  const supplierIndex = new Map<string, string>();
  for (const supplier of context.suppliers) {
    supplierIndex.set(searchKey(supplier.name), supplier.id);
    if (supplier.shortName) supplierIndex.set(searchKey(supplier.shortName), supplier.id);
  }
  const unmatched = new Set<string>();

  const sections: ImportedSection[] = [];
  const itemRows: number[] = [];
  const sectionItemSpans: [number, number][] = [];
  let section: ImportedSection | null = null;
  let line: ImportedLine | null = null;
  let totalsRow: number | null = null;
  let sellVatRate = 0.08;
  const fileSellAmounts: { row: number; amount: number; line: ImportedLine }[] = [];
  const fileCostAmounts: { row: number; amount: number; cost: ImportedCost }[] = [];
  const fractionalPrices: number[] = [];
  let acCostTotal = 0;
  let hasAcData = false;

  const closeSectionSpan = () => {
    if (!section) return;
    const rows = section.lines.flatMap((item) => [item.row, ...item.costs.map((cost) => cost.row)]);
    if (rows.length) sectionItemSpans.push([Math.min(...rows), Math.max(...rows)]);
  };

  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const sell = cellsOf(sheet, rowNumber, quote);
    const icCells = cellsOf(sheet, rowNumber, ic);
    const acCells = cellsOf(sheet, rowNumber, ac);
    const sttText = text(sell("stt"));
    const nameText = text(sell("name"));
    const firstLabel = labelKey(sttText ?? nameText);

    if (firstLabel.startsWith("tong")) {
      totalsRow ??= rowNumber;
      const vatLabel = (sttText ?? nameText ?? "").match(/vat\s*\(?\s*(\d+(?:[.,]\d+)?)\s*%/i);
      if (vatLabel) sellVatRate = Number(vatLabel[1].replace(",", ".")) / 100;
      continue;
    }
    if (totalsRow) {
      const label = sttText ?? nameText ?? "";
      const vatLabel = label.match(/vat\s*\(?\s*(\d+(?:[.,]\d+)?)\s*%/i);
      if (vatLabel) sellVatRate = Number(vatLabel[1].replace(",", ".")) / 100;
      continue;
    }

    // Nhóm: "I. SẢN XUẤT" ở cột STT (hoặc HẠNG MỤC) và không có số liệu bán riêng.
    const sectionText =
      sttText && !nameText && ROMAN_SECTION.test(sttText)
        ? sttText
        : !sttText && nameText && ROMAN_SECTION.test(nameText)
          ? nameText
          : null;
    if (sectionText) {
      closeSectionSpan();
      section = { name: sectionText, lines: [] };
      sections.push(section);
      line = null;
      continue;
    }

    const icQuantity = numberOf(icCells("quantity"));
    const icPriceRaw = icCells("unitPrice");
    const icPrice = numberOf(icPriceRaw);
    const supplierText = text(icCells("supplier"));
    const hasIc = Boolean(ic) && (icPrice !== null || icQuantity !== null || supplierText !== null);
    const acPrice = numberOf(acCells("unitPrice"));
    const acQuantity = numberOf(acCells("quantity"));
    if (ac && (acPrice !== null || acQuantity !== null)) {
      hasAcData = true;
      acCostTotal += roundVnd((acQuantity ?? 0) * (acPrice ?? 0));
    }
    const descText = text(sell("description"));

    if (nameText) {
      if (!section) {
        section = { name: "I. HẠNG MỤC", lines: [] };
        sections.push(section);
      }
      const priceRaw = sell("unitPrice");
      const amountRaw = sell("amount");
      const quantity = numberOf(sell("quantity"));
      let unitPrice: number | null = isDash(priceRaw) || isDash(amountRaw) ? null : numberOf(priceRaw);
      const fileAmount = numberOf(amountRaw);
      if (unitPrice === null && !isDash(amountRaw) && fileAmount && quantity) {
        unitPrice = fileAmount / quantity;
      }
      if (unitPrice !== null && hasFraction2(unitPrice)) fractionalPrices.push(rowNumber);
      line = {
        stt: sttText,
        name: nameText,
        description: descText,
        unit: text(sell("unit")),
        quantity: quantity === null ? null : round3(quantity),
        unitPrice: unitPrice === null ? null : round2(unitPrice),
        note: text(sell("note")),
        costs: [],
        row: rowNumber,
      };
      section.lines.push(line);
      itemRows.push(rowNumber);
      if (fileAmount !== null && line.unitPrice !== null) {
        fileSellAmounts.push({ row: rowNumber, amount: fileAmount, line });
      }
    } else if (!hasIc && !descText) {
      continue; // dòng trống
    }

    if (hasIc && line) {
      if (icPrice !== null && hasFraction2(icPrice)) fractionalPrices.push(rowNumber);
      const quantity = icQuantity === null ? null : round3(icQuantity);
      const unitPrice = icPrice === null ? null : round2(icPrice);
      const amount = roundVnd((quantity ?? 0) * (unitPrice ?? 0));
      const supplierId = supplierText ? supplierIndex.get(searchKey(supplierText)) ?? null : null;
      if (supplierText && !supplierId) unmatched.add(supplierText);
      const cost: ImportedCost = {
        description: nameText ? null : descText,
        unit: text(icCells("unit")) ?? (nameText ? null : text(sell("unit"))),
        icQuantity: quantity,
        icUnitPrice: unitPrice,
        icVatRate: vatRateFrom(icCells("vat"), amount),
        icSupplierId: supplierId,
        supplierName: supplierText,
        icNote: text(icCells("note")),
        row: rowNumber,
      };
      line.costs.push(cost);
      if (!nameText) itemRows.push(rowNumber);
      const fileAmount = numberOf(icCells("amount"));
      if (fileAmount !== null) fileCostAmounts.push({ row: rowNumber, amount: fileAmount, cost });
    }
  }
  closeSectionSpan();

  const nonEmpty = sections.filter((item) => item.lines.length > 0);
  if (nonEmpty.length === 0) {
    throw new FinanceImportError("Không đọc được hạng mục nào trong file.");
  }

  const header = readHeader(sheet, headerRow, quote.last);
  const totals = sheetTotals(nonEmpty.map((item) => ({ lines: item.lines })), sellVatRate);

  // ---------- Kiểm lỗi bằng code ----------
  const cellName = (column: number | undefined, row: number) =>
    column ? `${columnLetter(column)}${row}` : `dòng ${row}`;

  // R01: thành tiền bán trong file khác số lượng × đơn giá.
  for (const item of fileSellAmounts) {
    const computed = sellAmount(item.line);
    if (Math.abs(item.amount - computed) > 1) {
      issues.push({
        code: "R01",
        severity: "error",
        title: `Thành tiền bán sai ở ô ${cellName(quote.columns.amount, item.row)}`,
        detail: `File ghi ${formatNumber(item.amount)}, tính lại ${formatNumber(computed)} (${item.line.name}).`,
      });
    }
  }
  // R04: thành tiền vốn trong file khác số lượng × đơn giá.
  for (const item of fileCostAmounts) {
    const computed = costAmount(item.cost);
    if (Math.abs(item.amount - computed) > 1) {
      issues.push({
        code: "R04",
        severity: "error",
        title: `Thành tiền vốn sai ở ô ${cellName(ic?.columns.amount, item.row)}`,
        detail: `File ghi ${formatNumber(item.amount)}, tính lại ${formatNumber(computed)}.`,
      });
    }
  }
  // R03: tổng tiền trong file khác tổng tính lại.
  if (totalsRow) {
    const fileSell = numberOf(cellsOf(sheet, totalsRow, quote)("amount"));
    if (fileSell !== null && Math.abs(fileSell - totals.sellSubtotal) > 1) {
      issues.push({
        code: "R03",
        severity: "error",
        title: `Tổng tiền bán trong file khác tổng tính lại`,
        detail: `Ô ${cellName(quote.columns.amount, totalsRow)} ghi ${formatNumber(fileSell)}, tính lại ${formatNumber(totals.sellSubtotal)}.`,
      });
    }
    const fileCost = numberOf(cellsOf(sheet, totalsRow, ic)("amount"));
    if (ic && fileCost !== null && Math.abs(fileCost - totals.costSubtotal) > 1) {
      issues.push({
        code: "R03",
        severity: "error",
        title: `Tổng chi phí trong file khác tổng tính lại`,
        detail: `Ô ${cellName(ic.columns.amount, totalsRow)} ghi ${formatNumber(fileCost)}, tính lại ${formatNumber(totals.costSubtotal)}.`,
      });
    }
  }
  // R06: đơn giá có số lẻ phần thập phân (vd =2160000/1.08) — đã làm tròn khi nhập.
  if (fractionalPrices.length) {
    issues.push({
      code: "R06",
      severity: "info",
      title: `${fractionalPrices.length} đơn giá có phần lẻ, đã làm tròn 2 chữ số`,
      detail: `Dòng ${[...new Set(fractionalPrices)].slice(0, 8).join(", ")}.`,
    });
  }

  // F01: công thức có vùng dừng giữa chừng, không phủ hết các dòng hạng mục.
  issues.push(...checkPartialRanges(sheet, itemRows, sectionItemSpans));
  // F04: ô lỗi #VALUE!, #REF!… ở mọi sheet.
  issues.push(...checkErrorCells(workbook));

  // C01: thiếu thông tin chung (chỉ nhắc, khi xuất file mục trống tự ẩn).
  const missing = [
    !header.clientName && "Khách hàng",
    !header.headcount && "Số lượng",
    !header.location && "Địa điểm",
    !header.eventStart && "Thời gian",
  ].filter(Boolean);
  if (missing.length) {
    issues.push({
      code: "C01",
      severity: "info",
      title: `File thiếu: ${missing.join(", ")}`,
      detail: "Bổ sung sau trong app; mục trống sẽ không in ra khi xuất file.",
    });
  }
  // C03: dòng chi phí có tiền nhưng chưa có NCC.
  const allCosts = nonEmpty.flatMap((item) => item.lines.flatMap((entry) => entry.costs));
  const noSupplier = allCosts.filter((cost) => !cost.supplierName && costAmount(cost) > 0);
  if (noSupplier.length) {
    issues.push({
      code: "C03",
      severity: "warning",
      title: `${noSupplier.length}/${allCosts.length} dòng chi phí chưa có nhà cung cấp`,
      detail: "Cột SUP trống. Chọn nhà cung cấp trong app trước khi lập phiếu tạm ứng.",
    });
  }
  // C05: tên sheet là tên một khách hàng khác (file copy từ IC cũ).
  const sheetKey = searchKey(sheet.name);
  const clientKey = searchKey(header.clientName);
  const genericSheetName = /^(sheet|trang|bang tinh)\s*\d*$|^(ic|ac|bao gia)$/.test(sheetKey);
  const otherClient =
    sheetKey.length >= 3 && !genericSheetName && !clientKey.includes(sheetKey)
      ? context.clientNames.find((name) => {
          const key = searchKey(name);
          return key && (key === sheetKey || key.includes(sheetKey) || sheetKey.includes(key)) && !clientKey.includes(key);
        })
      : undefined;
  if (otherClient) {
    issues.push({
      code: "C05",
      severity: "warning",
      title: `Tên sheet "${sheet.name}" là tên khách hàng khác`,
      detail: "Có thể file được copy từ IC cũ — nên rà lại mô tả còn sót của khách khác.",
    });
  }
  // C07: STT nhảy cóc hoặc trùng trong một nhóm.
  for (const item of nonEmpty) {
    const numbers = item.lines
      .map((entry) => (entry.stt && /^\d+$/.test(entry.stt) ? Number(entry.stt) : null))
      .filter((value): value is number => value !== null);
    const broken = numbers.some((value, index) => index > 0 && value !== numbers[index - 1] + 1);
    if (broken) {
      issues.push({
        code: "C07",
        severity: "warning",
        title: `STT không liên tục trong nhóm "${item.name}"`,
        detail: `Thứ tự trong file: ${numbers.join(", ")}.`,
      });
    }
  }
  // C08: tên NCC trong file chưa có trong danh bạ.
  if (unmatched.size) {
    issues.push({
      code: "C08",
      severity: "warning",
      title: `${unmatched.size} nhà cung cấp chưa có trong danh bạ`,
      detail: `${[...unmatched].join(", ")}. Thêm vào danh bạ rồi nhập lại, hoặc chọn sau trong app.`,
    });
  }
  // B02: margin từng hạng mục bất thường.
  for (const item of nonEmpty) {
    for (const entry of item.lines) {
      const sell = sellAmount(entry);
      if (!sell) continue;
      const cost = entry.costs.reduce((sum, value) => sum + costAmount(value), 0);
      const margin = (sell - cost) / sell;
      if (margin > 0.8 || margin < 0) {
        issues.push({
          code: "B02",
          severity: "warning",
          title: `Margin ${(margin * 100).toFixed(1).replace(".", ",")}% ở "${entry.name}"`,
          detail: `Bán ${formatNumber(sell)}, vốn ${formatNumber(cost)}. ${margin < 0 ? "Hạng mục đang lỗ." : "Kiểm tra giá vốn có nhập thiếu không."}`,
        });
      }
    }
  }
  // B04: dòng không có VAT đầu vào trong khi dòng khác có.
  const withVat = allCosts.some((cost) => (cost.icVatRate ?? 0) > 0);
  const noVat = allCosts.filter((cost) => !cost.icVatRate && costAmount(cost) > 0);
  if (withVat && noVat.length) {
    issues.push({
      code: "B04",
      severity: "info",
      title: `${noVat.length} dòng chi phí không có VAT đầu vào`,
      detail: "Xác nhận các NCC này không xuất hoá đơn (cá nhân, nội bộ…).",
    });
  }
  // B07: VAT đầu vào ra số lẻ, nên làm tròn đơn giá.
  const oddVat = allCosts.filter(
    (cost) => cost.icVatRate && Math.abs(costAmount(cost) * cost.icVatRate - costVat(cost)) > 1e-6,
  );
  if (oddVat.length) {
    issues.push({
      code: "B07",
      severity: "info",
      title: `${oddVat.length} dòng có VAT đầu vào ra số lẻ`,
      detail: `App làm tròn tới đồng. Dòng ${oddVat.map((cost) => cost.row).join(", ")}.`,
    });
  }

  const order: Record<ImportSeverity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    sheetName: sheet.name,
    header,
    sellVatRate,
    sections: nonEmpty,
    totals,
    hasAcceptance: Boolean(accepted) || hasAcData,
    acCostTotal: hasAcData ? acCostTotal : null,
    unmatchedSuppliers: [...unmatched],
    issues,
  };
}

// ---------- Kiểm công thức & ô lỗi ----------

function columnLetter(column: number) {
  let result = "";
  let value = column;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
}

const RANGE = /\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)/g;

function checkPartialRanges(
  sheet: Worksheet,
  itemRows: number[],
  spans: [number, number][],
): ImportIssue[] {
  if (itemRows.length < 2) return [];
  const firstItem = Math.min(...itemRows);
  const lastItem = Math.max(...itemRows);
  const found = new Map<number, { ranges: Set<string>; cells: Set<string> }>();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const formula = readCell(cell).formula;
      if (!formula || !/SUM|SUBTOTAL|UNIQUE|COUNT/i.test(formula)) return;
      for (const match of formula.matchAll(RANGE)) {
        const start = Number(match[2]);
        const end = Number(match[4]);
        const insideOneSection = spans.some(([from, to]) => start >= from && end <= to);
        if (start <= firstItem && end >= firstItem && end < lastItem && !insideOneSection) {
          // Gom theo dòng kết thúc: nhiều vùng cùng dừng ở một dòng là cùng một lỗi.
          const entry = found.get(end) ?? { ranges: new Set<string>(), cells: new Set<string>() };
          entry.ranges.add(`${match[1]}${start}:${match[3]}${end}`);
          entry.cells.add(`${columnLetter(column)}${rowNumber}`);
          found.set(end, entry);
        }
      }
    });
  });
  return [...found.entries()].map(([end, { ranges, cells }]) => {
    const cellList = [...cells];
    return {
      code: "F01",
      severity: "warning" as const,
      title: `Công thức chỉ tính tới dòng ${end}, trong khi hạng mục kéo tới dòng ${lastItem}`,
      detail: `Vùng ${[...ranges].join(", ")} (ô ${cellList.slice(0, 6).join(", ")}${cellList.length > 6 ? "…" : ""}). App tự tính lại nên IC trong app không bị ảnh hưởng.`,
    };
  });
}

function checkErrorCells(workbook: Workbook): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const sheet of workbook.worksheets) {
    const cells: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        if (readCell(cell).error) cells.push(`${columnLetter(column)}${rowNumber}`);
      });
    });
    if (cells.length) {
      issues.push({
        code: "F04",
        severity: "warning",
        title: `${cells.length} ô bị lỗi công thức ở sheet "${sheet.name}"`,
        detail: `Ô ${cells.slice(0, 8).join(", ")}${cells.length > 8 ? "…" : ""} (#VALUE!, #REF!…).`,
      });
    }
  }
  return issues;
}
