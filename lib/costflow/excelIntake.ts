import { compare, decimal, normalizeDecimalInput } from "./money";

export const EXCEL_INTAKE_SCHEMA_VERSION = 4 as const;
export const CUSTOMER_EXCEL_INTAKE_FIELDS = [
  "level", "rowType", "name", "description", "unit", "quantity", "days", "unitPrice", "vatPercent", "basis", "note",
] as const;
export const INTERNAL_EXCEL_INTAKE_FIELDS = ["buy", "supplier", "internalNote"] as const;
export const HIDDEN_TECHNICAL_EXCEL_INTAKE_FIELDS = ["candidateKey", "parentCandidateKey", "order", "coordinates", "observations"] as const;

export type ExcelIntakeSourceCoordinate = { sheet: string; row: number; column: number; cell: string };
export type ExcelIntakeObservation = { formula: string; cachedValue: unknown };
export type ExcelIntakePrimitiveCell = {
  value: unknown;
  source: ExcelIntakeSourceCoordinate;
  observation?: ExcelIntakeObservation;
};
export type ExcelIntakeSource = { kind: "PASTE" | "XLSX" | "TEMPLATE"; sheet: string; range: string };
export type ExcelIntakeMetadata = { projectName: string; customer: string; preparedAt: string; location: string };
export type ExcelIntakeSideInput = {
  unit: ExcelIntakePrimitiveCell;
  quantity: ExcelIntakePrimitiveCell;
  days: ExcelIntakePrimitiveCell;
  unitPrice: ExcelIntakePrimitiveCell;
  vatPercent: ExcelIntakePrimitiveCell;
  basis: ExcelIntakePrimitiveCell;
  note: ExcelIntakePrimitiveCell;
};
export type ExcelIntakeRowInput = {
  level: ExcelIntakePrimitiveCell;
  rowType: ExcelIntakePrimitiveCell;
  parentRow: ExcelIntakePrimitiveCell;
  name: ExcelIntakePrimitiveCell;
  description: ExcelIntakePrimitiveCell;
  sell: ExcelIntakeSideInput;
  buy: ExcelIntakeSideInput & { supplier: ExcelIntakePrimitiveCell };
  previewNet?: ExcelIntakePrimitiveCell;
  previewVat?: ExcelIntakePrimitiveCell;
  previewGross?: ExcelIntakePrimitiveCell;
};
export type ExcelIntakeInput = {
  schemaVersion: number;
  source: ExcelIntakeSource;
  metadata: ExcelIntakeMetadata;
  rows: ExcelIntakeRowInput[];
};
export type NormalizedExcelIntakeSide = {
  unit: string;
  quantity: string | null;
  days: string | null;
  unitPrice: string | null;
  vatPercent: string | null;
  basis: "NET" | "GROSS" | null;
  note: string;
};
export type NormalizedExcelIntakeRow = {
  candidateKey: string;
  parentCandidateKey: string | null;
  order: number;
  level: 1 | 2 | 3;
  rowType: "GROUP" | "ITEM";
  name: string;
  description: string;
  sell: NormalizedExcelIntakeSide;
  buy: NormalizedExcelIntakeSide & { supplier: string };
  coordinates: Record<string, ExcelIntakeSourceCoordinate>;
};
export type ExcelIntakeIssueCode = "INVALID_NUMBER" | "INVALID_QUANTITY" | "INVALID_DAYS" | "INVALID_VAT" | "INVALID_BASIS" | "FOC_NOTE_REQUIRED" | "INVALID_HIERARCHY" | "INVALID_ROW_TYPE";
export type ExcelIntakeBlockingError = { code: ExcelIntakeIssueCode; message: string; field: string; source: ExcelIntakeSourceCoordinate; blocking: true };
export type ExcelIntakeWarning = { code: "FORMULA_IGNORED"; message: string; field: string; source: ExcelIntakeSourceCoordinate; blocking: false };
export type NormalizedExcelIntake = {
  schemaVersion: typeof EXCEL_INTAKE_SCHEMA_VERSION;
  source: ExcelIntakeSource;
  metadata: ExcelIntakeMetadata;
  rows: NormalizedExcelIntakeRow[];
  observations: Array<ExcelIntakeObservation & { field: string; source: ExcelIntakeSourceCoordinate }>;
  errors: ExcelIntakeBlockingError[];
  warnings: ExcelIntakeWarning[];
};

const ZERO = decimal("0");
const HUNDRED = decimal("100");

function text(cell: ExcelIntakePrimitiveCell) {
  return cell.value === null || cell.value === undefined ? "" : String(cell.value).trim();
}

function issue(errors: ExcelIntakeBlockingError[], code: ExcelIntakeIssueCode, field: string, source: ExcelIntakeSourceCoordinate, message: string) {
  errors.push({ code, field, source, message, blocking: true });
}

function numberValue(cell: ExcelIntakePrimitiveCell, field: string, errors: ExcelIntakeBlockingError[], rule: "NON_NEGATIVE" | "POSITIVE" | "VAT") {
  const raw = text(cell);
  if (!raw) return null;
  try {
    const normalized = normalizeDecimalInput(raw);
    const value = decimal(normalized);
    if (rule === "POSITIVE" && compare(value, ZERO) <= 0) issue(errors, field.endsWith("days") ? "INVALID_DAYS" : "INVALID_QUANTITY", field, cell.source, "Giá trị phải lớn hơn 0.");
    if (rule === "NON_NEGATIVE" && compare(value, ZERO) < 0) issue(errors, "INVALID_NUMBER", field, cell.source, "Giá trị không được âm.");
    if (rule === "VAT" && (compare(value, ZERO) < 0 || compare(value, HUNDRED) > 0)) issue(errors, "INVALID_VAT", field, cell.source, "VAT phải từ 0 đến 100.");
    return normalized;
  } catch {
    issue(errors, rule === "VAT" ? "INVALID_VAT" : field.endsWith("days") ? "INVALID_DAYS" : "INVALID_NUMBER", field, cell.source, "Nhập số hợp lệ, không dùng dấu phân cách hàng nghìn.");
    return null;
  }
}

function sideValue(side: ExcelIntakeSideInput, prefix: "sell" | "buy", rowType: "GROUP" | "ITEM", errors: ExcelIntakeBlockingError[]): NormalizedExcelIntakeSide {
  if (rowType === "GROUP") return { unit: "", quantity: null, days: null, unitPrice: null, vatPercent: null, basis: null, note: "" };
  const quantity = numberValue(side.quantity, `${prefix}.quantity`, errors, "POSITIVE");
  const days = numberValue(side.days, `${prefix}.days`, errors, "POSITIVE");
  const unitPrice = numberValue(side.unitPrice, `${prefix}.unitPrice`, errors, "NON_NEGATIVE");
  const vatPercent = numberValue(side.vatPercent, `${prefix}.vatPercent`, errors, "VAT");
  const basisText = text(side.basis).toUpperCase();
  const basis = basisText === "NET" || basisText === "GROSS" ? basisText : null;
  if (basisText && !basis) issue(errors, "INVALID_BASIS", `${prefix}.basis`, side.basis.source, "Căn cứ phải là NET hoặc GROSS.");
  const note = text(side.note).slice(0, 5000);
  if (unitPrice === "0" && !note) issue(errors, "FOC_NOTE_REQUIRED", `${prefix}.note`, side.note.source, "Dòng FOC có đơn giá 0 phải kèm ghi chú.");
  return { unit: text(side.unit).slice(0, 100), quantity, days, unitPrice, vatPercent, basis, note };
}

export function normalizeExcelIntake(input: ExcelIntakeInput): NormalizedExcelIntake {
  if (input.schemaVersion !== EXCEL_INTAKE_SCHEMA_VERSION) throw new Error(`Excel Intake phải dùng schemaVersion ${EXCEL_INTAKE_SCHEMA_VERSION}.`);
  if (!Array.isArray(input.rows) || input.rows.length > 500) throw new Error("Excel Intake tối đa 500 dòng.");
  const errors: ExcelIntakeBlockingError[] = [];
  const warnings: ExcelIntakeWarning[] = [];
  const observations: NormalizedExcelIntake["observations"] = [];
  const sourceRowToCandidate = new Map<number, string>();
  input.rows.forEach((row, index) => sourceRowToCandidate.set(row.level.source.row, `candidate-${index + 1}`));
  const rows = input.rows.map((row, index): NormalizedExcelIntakeRow => {
    const candidateKey = `candidate-${index + 1}`;
    const levelNumber = Number(text(row.level));
    const level = ([1, 2, 3].includes(levelNumber) ? levelNumber : 1) as 1 | 2 | 3;
    const rowTypeText = text(row.rowType).toUpperCase();
    const rowType = rowTypeText === "GROUP" ? "GROUP" : "ITEM";
    if (rowTypeText !== "GROUP" && rowTypeText !== "ITEM") issue(errors, "INVALID_ROW_TYPE", "rowType", row.rowType.source, "Loại dòng phải là GROUP hoặc ITEM.");
    const parentSourceRow = Number(text(row.parentRow));
    const parentCandidateKey = Number.isInteger(parentSourceRow) ? sourceRowToCandidate.get(parentSourceRow) ?? null : null;
    const validStructure = rowType === "GROUP" ? level === 1 && !parentCandidateKey : level === 1 ? !parentCandidateKey : Boolean(parentCandidateKey);
    if (!validStructure) issue(errors, "INVALID_HIERARCHY", "parentRow", row.parentRow.source, "Cấp và dòng cha không tạo thành cấu trúc ba cấp hợp lệ.");
    const sell = sideValue(row.sell, "sell", rowType, errors);
    const buyBase = sideValue(row.buy, "buy", rowType, errors);
    for (const [field, primitive] of [["previewNet", row.previewNet], ["previewVat", row.previewVat], ["previewGross", row.previewGross]] as const) {
      if (!primitive?.observation) continue;
      observations.push({ ...primitive.observation, field, source: primitive.source });
      warnings.push({ code: "FORMULA_IGNORED", field, source: primitive.source, message: "Công thức và giá trị cache chỉ dùng xem trước; máy chủ tính lại từ dữ liệu nguyên thủy.", blocking: false });
    }
    return {
      candidateKey,
      parentCandidateKey,
      order: index,
      level,
      rowType,
      name: text(row.name).slice(0, 500),
      description: text(row.description).slice(0, 5000),
      sell,
      buy: { ...buyBase, supplier: rowType === "GROUP" ? "" : text(row.buy.supplier).slice(0, 500) },
      coordinates: {
        level: row.level.source, rowType: row.rowType.source, parentRow: row.parentRow.source, name: row.name.source,
        sellQuantity: row.sell.quantity.source, sellDays: row.sell.days.source, sellUnitPrice: row.sell.unitPrice.source,
        sellVatPercent: row.sell.vatPercent.source, sellBasis: row.sell.basis.source,
        buyQuantity: row.buy.quantity.source, buyDays: row.buy.days.source, buyUnitPrice: row.buy.unitPrice.source,
        buyVatPercent: row.buy.vatPercent.source, buyBasis: row.buy.basis.source,
      },
    };
  });
  return { schemaVersion: EXCEL_INTAKE_SCHEMA_VERSION, source: { ...input.source }, metadata: { ...input.metadata }, rows, observations, errors, warnings };
}

export function projectCustomerExcelIntake(input: NormalizedExcelIntake) {
  return {
    schemaVersion: input.schemaVersion,
    metadata: { projectName: input.metadata.projectName, customer: input.metadata.customer, preparedAt: input.metadata.preparedAt, location: input.metadata.location },
    rows: input.rows.map(row => ({
      level: row.level,
      rowType: row.rowType,
      name: row.name,
      description: row.description,
      unit: row.sell.unit,
      quantity: row.sell.quantity,
      days: row.sell.days,
      unitPrice: row.sell.unitPrice,
      vatPercent: row.sell.vatPercent,
      basis: row.sell.basis,
      note: row.sell.note,
    })),
  };
}
