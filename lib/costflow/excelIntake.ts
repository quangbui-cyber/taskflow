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
  canonical?: { value: string; source: ExcelIntakeSourceCoordinate };
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
  previewBuyNet?: ExcelIntakePrimitiveCell;
  previewBuyVat?: ExcelIntakePrimitiveCell;
  previewBuyGross?: ExcelIntakePrimitiveCell;
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
export type ExcelIntakeIssueCode = "INVALID_NUMBER" | "AMBIGUOUS_DECIMAL" | "INVALID_QUANTITY" | "INVALID_DAYS" | "INVALID_VAT" | "INVALID_BASIS" | "FOC_NOTE_REQUIRED" | "INVALID_HIERARCHY" | "INVALID_ROW_TYPE";
export type ExcelIntakeDiagnosticIdentity = {
  candidateKey: string;
  side?: "sell" | "buy";
  field: string;
  source: ExcelIntakeSourceCoordinate;
  conflictId?: string;
};
export type ExcelIntakeBlockingError = ExcelIntakeDiagnosticIdentity & { code: ExcelIntakeIssueCode; message: string; blocking: true };
export type ExcelDecimalConflict = {
  conflictId: string;
  candidateKey: string;
  side: "sell" | "buy";
  field: "sell.quantity" | "sell.days" | "sell.unitPrice" | "sell.vatPercent" | "buy.quantity" | "buy.days" | "buy.unitPrice" | "buy.vatPercent";
  visible: string;
  canonical: string;
  source: ExcelIntakeSourceCoordinate;
  canonicalSource: ExcelIntakeSourceCoordinate;
  reason: "VISIBLE_CANONICAL_MISMATCH" | "AMBIGUOUS_DECIMAL";
};
export type ExcelDecimalResolution = "VISIBLE" | "CANONICAL";
export type ExcelIntakeWarning = ExcelIntakeDiagnosticIdentity & { code: "FORMULA_IGNORED"; message: string; blocking: false };
export type NormalizedExcelIntake = {
  schemaVersion: typeof EXCEL_INTAKE_SCHEMA_VERSION;
  source: ExcelIntakeSource;
  metadata: ExcelIntakeMetadata;
  rows: NormalizedExcelIntakeRow[];
  observations: Array<ExcelIntakeObservation & { field: string; source: ExcelIntakeSourceCoordinate }>;
  errors: ExcelIntakeBlockingError[];
  warnings: ExcelIntakeWarning[];
  decimalConflicts: ExcelDecimalConflict[];
};

const ZERO = decimal("0");
const HUNDRED = decimal("100");

function text(cell: ExcelIntakePrimitiveCell) {
  return cell.value === null || cell.value === undefined ? "" : String(cell.value).trim();
}

function diagnosticSide(field: string) {
  return field.startsWith("sell.") ? "sell" as const : field.startsWith("buy.") ? "buy" as const : undefined;
}

function targetPart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

export function excelIntakeDiagnosticTargetId(issue: ExcelIntakeDiagnosticIdentity) {
  const prefix = issue.conflictId ? "excel-intake-conflict" : "excel-intake-row";
  const parts = [prefix, issue.candidateKey, issue.field];
  if (issue.conflictId) parts.push(issue.conflictId);
  return parts.map(targetPart).join("-");
}

export function roundTripRowTargetId(itemId: string, field?: string, sourceCell?: string) {
  return ["excel-round-trip-row", itemId, field, sourceCell].filter((value): value is string => Boolean(value)).map(targetPart).join("-");
}

export function roundTripAggregateTargetId(section: "subtree-delete" | "stale-draft") {
  return `excel-round-trip-section-${section}`;
}

function issue(errors: ExcelIntakeBlockingError[], candidateKey: string, code: ExcelIntakeIssueCode, field: string, source: ExcelIntakeSourceCoordinate, message: string) {
  errors.push({ code, candidateKey, side: diagnosticSide(field), field, source, message, blocking: true });
}

function parseExcelDecimal(raw: string): { kind: "VALUE"; value: string } | { kind: "AMBIGUOUS" } {
  const value = raw.trim().replace(/\s/g, "");
  if (!value) throw new Error("blank");
  if (/^-?\d{1,3}(?:\.\d{3})+,\d+$/.test(value)) return { kind: "VALUE", value: normalizeDecimalInput(value.replace(/\./g, "").replace(",", ".")) };
  if (/^-?\d{1,3}(?:,\d{3})+\.\d+$/.test(value)) return { kind: "VALUE", value: normalizeDecimalInput(value.replace(/,/g, "")) };
  if (/^-?\d+[.,]\d{3}$/.test(value)) return { kind: "AMBIGUOUS" };
  if (/^-?\d+(?:,\d+)?$/.test(value)) return { kind: "VALUE", value: normalizeDecimalInput(value.replace(",", ".")) };
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return { kind: "VALUE", value: normalizeDecimalInput(value) };
  throw new Error("invalid");
}

function numberValue(cell: ExcelIntakePrimitiveCell, candidateKey: string, field: ExcelDecimalConflict["field"], errors: ExcelIntakeBlockingError[], conflicts: ExcelDecimalConflict[], rule: "NON_NEGATIVE" | "POSITIVE" | "VAT") {
  const raw = text(cell);
  const canonicalRaw = cell.canonical?.value.trim() ?? "";
  if (!raw && !canonicalRaw) return null;
  try {
    const canonical = canonicalRaw ? normalizeDecimalInput(canonicalRaw) : null;
    const visibleResult = raw ? parseExcelDecimal(raw) : null;
    if (visibleResult?.kind === "AMBIGUOUS") {
      if (!canonical || !cell.canonical) {
        issue(errors, candidateKey, "AMBIGUOUS_DECIMAL", field, cell.source, "Cách viết số có thể là hàng nghìn hoặc thập phân; hãy chọn giá trị rõ ràng.");
        return null;
      }
      conflicts.push({ conflictId: `${candidateKey}:${field}:${cell.source.cell}`, candidateKey, side: field.startsWith("sell.") ? "sell" : "buy", field, visible: raw, canonical, source: cell.source, canonicalSource: cell.canonical.source, reason: "AMBIGUOUS_DECIMAL" });
    }
    const visible = visibleResult?.kind === "VALUE" ? visibleResult.value : null;
    if (canonical && visible && compare(decimal(canonical), decimal(visible)) !== 0 && cell.canonical) {
      conflicts.push({ conflictId: `${candidateKey}:${field}:${cell.source.cell}`, candidateKey, side: field.startsWith("sell.") ? "sell" : "buy", field, visible, canonical, source: cell.source, canonicalSource: cell.canonical.source, reason: "VISIBLE_CANONICAL_MISMATCH" });
    }
    const normalized = canonical ?? visible;
    if (!normalized) return null;
    const value = decimal(normalized);
    if (rule === "POSITIVE" && compare(value, ZERO) <= 0) issue(errors, candidateKey, field.endsWith("days") ? "INVALID_DAYS" : "INVALID_QUANTITY", field, cell.source, "Giá trị phải lớn hơn 0.");
    if (rule === "NON_NEGATIVE" && compare(value, ZERO) < 0) issue(errors, candidateKey, "INVALID_NUMBER", field, cell.source, "Giá trị không được âm.");
    if (rule === "VAT" && (compare(value, ZERO) < 0 || compare(value, HUNDRED) > 0)) issue(errors, candidateKey, "INVALID_VAT", field, cell.source, "VAT phải từ 0 đến 100.");
    return normalized;
  } catch {
    issue(errors, candidateKey, rule === "VAT" ? "INVALID_VAT" : field.endsWith("days") ? "INVALID_DAYS" : "INVALID_NUMBER", field, cell.source, "Nhập số hợp lệ, không dùng dấu phân cách hàng nghìn.");
    return null;
  }
}

function sideValue(side: ExcelIntakeSideInput, prefix: "sell" | "buy", candidateKey: string, rowType: "GROUP" | "ITEM", errors: ExcelIntakeBlockingError[], conflicts: ExcelDecimalConflict[]): NormalizedExcelIntakeSide {
  if (rowType === "GROUP") return { unit: "", quantity: null, days: null, unitPrice: null, vatPercent: null, basis: null, note: "" };
  const quantity = numberValue(side.quantity, candidateKey, `${prefix}.quantity`, errors, conflicts, "POSITIVE");
  const days = numberValue(side.days, candidateKey, `${prefix}.days`, errors, conflicts, "POSITIVE");
  const unitPrice = numberValue(side.unitPrice, candidateKey, `${prefix}.unitPrice`, errors, conflicts, "NON_NEGATIVE");
  const vatPercent = numberValue(side.vatPercent, candidateKey, `${prefix}.vatPercent`, errors, conflicts, "VAT");
  const basisText = text(side.basis).toUpperCase();
  const basis = basisText === "NET" || basisText === "GROSS" ? basisText : null;
  if (basisText && !basis) issue(errors, candidateKey, "INVALID_BASIS", `${prefix}.basis`, side.basis.source, "Căn cứ phải là NET hoặc GROSS.");
  const note = text(side.note).slice(0, 5000);
  if (unitPrice === "0" && !note) issue(errors, candidateKey, "FOC_NOTE_REQUIRED", `${prefix}.note`, side.note.source, "Dòng FOC có đơn giá 0 phải kèm ghi chú.");
  return { unit: text(side.unit).slice(0, 100), quantity, days, unitPrice, vatPercent, basis, note };
}

export function normalizeExcelIntake(input: ExcelIntakeInput): NormalizedExcelIntake {
  if (input.schemaVersion !== EXCEL_INTAKE_SCHEMA_VERSION) throw new Error(`Excel Intake phải dùng schemaVersion ${EXCEL_INTAKE_SCHEMA_VERSION}.`);
  if (!Array.isArray(input.rows) || input.rows.length > 500) throw new Error("Excel Intake tối đa 500 dòng.");
  const errors: ExcelIntakeBlockingError[] = [];
  const warnings: ExcelIntakeWarning[] = [];
  const decimalConflicts: ExcelDecimalConflict[] = [];
  const observations: NormalizedExcelIntake["observations"] = [];
  const sourceRowToCandidate = new Map<string, string>();
  input.rows.forEach((row, index) => sourceRowToCandidate.set(`${row.level.source.sheet}:${row.level.source.row}`, `candidate-${index + 1}`));
  const rows = input.rows.map((row, index): NormalizedExcelIntakeRow => {
    const candidateKey = `candidate-${index + 1}`;
    const levelNumber = Number(text(row.level));
    const level = ([1, 2, 3].includes(levelNumber) ? levelNumber : 1) as 1 | 2 | 3;
    const rowTypeText = text(row.rowType).toUpperCase();
    const rowType = rowTypeText === "GROUP" ? "GROUP" : "ITEM";
    if (rowTypeText !== "GROUP" && rowTypeText !== "ITEM") issue(errors, candidateKey, "INVALID_ROW_TYPE", "rowType", row.rowType.source, "Loại dòng phải là GROUP hoặc ITEM.");
    const parentSourceRow = Number(text(row.parentRow));
    const parentCandidateKey = Number.isInteger(parentSourceRow) ? sourceRowToCandidate.get(`${row.level.source.sheet}:${parentSourceRow}`) ?? null : null;
    const validStructure = rowType === "GROUP" ? level === 1 && !parentCandidateKey : level === 1 ? !parentCandidateKey : Boolean(parentCandidateKey);
    if (!validStructure) issue(errors, candidateKey, "INVALID_HIERARCHY", "parentRow", row.parentRow.source, "Cấp và dòng cha không tạo thành cấu trúc ba cấp hợp lệ.");
    const sell = sideValue(row.sell, "sell", candidateKey, rowType, errors, decimalConflicts);
    const buyBase = sideValue(row.buy, "buy", candidateKey, rowType, errors, decimalConflicts);
    for (const [field, primitive] of [
      ["previewNet", row.previewNet],
      ["previewVat", row.previewVat],
      ["previewGross", row.previewGross],
      ["previewBuyNet", row.previewBuyNet],
      ["previewBuyVat", row.previewBuyVat],
      ["previewBuyGross", row.previewBuyGross],
    ] as const) {
      if (!primitive?.observation) continue;
      observations.push({ ...primitive.observation, field, source: primitive.source });
      warnings.push({ code: "FORMULA_IGNORED", candidateKey, field, source: primitive.source, message: "Công thức và giá trị cache chỉ dùng xem trước; máy chủ tính lại từ dữ liệu nguyên thủy.", blocking: false });
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
  return { schemaVersion: EXCEL_INTAKE_SCHEMA_VERSION, source: { ...input.source }, metadata: { ...input.metadata }, rows, observations, errors, warnings, decimalConflicts };
}

export function resolveExcelIntakeDecimalConflicts<T extends NormalizedExcelIntake>(input: T, resolutions: Record<string, ExcelDecimalResolution>): T {
  const conflicts = new Map(input.decimalConflicts.map(conflict => [conflict.conflictId, conflict]));
  const keys = Object.keys(resolutions);
  if (keys.some(key => !conflicts.has(key)) || keys.some(key => resolutions[key] !== "VISIBLE" && resolutions[key] !== "CANONICAL")) {
    throw new Error("Cách xử lý số thập phân không hợp lệ cho phiên xem trước này.");
  }
  if (keys.length !== conflicts.size || [...conflicts.keys()].some(key => !(key in resolutions))) {
    throw new Error("Cần chọn đầy đủ cách xử lý cho từng ô số thập phân xung đột.");
  }
  const resolved = structuredClone(input) as T;
  for (const conflict of input.decimalConflicts) {
    const row = resolved.rows.find(candidate => candidate.candidateKey === conflict.candidateKey);
    if (!row) throw new Error("Xung đột số thập phân không còn khớp dòng xem trước.");
    const field = conflict.field.split(".")[1] as "quantity" | "days" | "unitPrice" | "vatPercent";
    row[conflict.side][field] = resolutions[conflict.conflictId] === "VISIBLE" ? conflict.visible : conflict.canonical;
  }
  return resolved;
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
