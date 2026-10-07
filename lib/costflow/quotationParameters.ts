import { calculateCost, decimal, divide, exact, multiply, source, totals, type Rational } from "./money";
import type { PairedRow } from "./types";

export type FormulaNode =
  | { op: "PARAM"; key: string; moduleId?: string }
  | { op: "CONST"; value: string }
  | { op: "MUL" | "DIV"; left: FormulaNode; right: FormulaNode }
  | { op: "CEIL" | "FLOOR"; value: FormulaNode };

export type ParameterDefinition = {
  key: string;
  label: string;
  defaultValue: string;
  scope: "SHARED" | "MODULE";
};

export type EventParameterModule = {
  id: string;
  label: string;
  eventType?: string;
  overrides: Record<string, string>;
};

export type QuotationParameterSnapshot = {
  schemaVersion: 1;
  definitions: ParameterDefinition[];
  sharedValues: Record<string, string>;
  modules: EventParameterModule[];
};

export type ParameterBinding = {
  mode: "MANUAL" | "PARAMETER" | "FORMULA" | "OVERRIDDEN";
  moduleId?: string;
  quantityFormula?: FormulaNode;
  unitPriceFormula?: FormulaNode;
  lastCalculated?: { quantity?: string; unitPrice?: string };
};

export type ParameterIssue = {
  code: "MISSING_PARAMETER" | "UNKNOWN_PARAMETER" | "DIVISION_BY_ZERO" | "INVALID_RESULT";
  message: string;
  rowId?: string;
  rowName?: string;
  side?: "sell" | "buy";
  field?: "quantity" | "unitPrice";
};

export type FormulaEvaluation = { value: string; issue?: never } | { value?: never; issue: ParameterIssue };

export type ParameterImpact = {
  rowId: string;
  rowName: string;
  side: "sell" | "buy";
  field: "quantity" | "unitPrice";
  oldValue: string;
  newValue: string;
};

export type ParameterImpactTotals = {
  rawNet: string;
  rawVat: string;
  rawGross: string;
  net: string;
  vat: string;
  gross: string;
  incomplete: boolean;
};

export type ParameterImpactPreview = {
  baseFingerprint: string;
  parameterConfig: QuotationParameterSnapshot;
  affected: ParameterImpact[];
  issues: ParameterIssue[];
  oldTotals: Record<"sell" | "buy", ParameterImpactTotals>;
  newTotals: Record<"sell" | "buy", ParameterImpactTotals>;
};

const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const MAX_ITEMS = 100;
const MAX_DEPTH = 12;

function numeric(value: unknown, label: string, allowEmpty = false) {
  const text = String(value ?? "").trim();
  if (!text && allowEmpty) return "";
  if (!text) throw new Error(`${label} không được để trống.`);
  let parsed: Rational;
  try { parsed = decimal(text); } catch { throw new Error(`${label} phải là số hữu hạn hợp lệ.`); }
  if (parsed.numerator < BigInt(0)) throw new Error(`${label} không được âm.`);
  return text.replace(",", ".");
}

function normalizeFormulaNode(value: unknown, depth = 1): FormulaNode {
  if (depth > MAX_DEPTH || !value || typeof value !== "object") throw new Error("Công thức không hợp lệ hoặc vượt quá độ sâu 12.");
  const node = value as Record<string, unknown>;
  if (node.op === "PARAM") {
    const key = String(node.key ?? "");
    if (!KEY.test(key)) throw new Error("Khóa tham số trong công thức không hợp lệ.");
    const moduleId = node.moduleId === undefined ? undefined : String(node.moduleId);
    if (moduleId !== undefined && !KEY.test(moduleId)) throw new Error("Mã module trong công thức không hợp lệ.");
    return { op: "PARAM", key, ...(moduleId ? { moduleId } : {}) };
  }
  if (node.op === "CONST") return { op: "CONST", value: numeric(node.value, "Hằng số") };
  if (node.op === "MUL" || node.op === "DIV") return { op: node.op, left: normalizeFormulaNode(node.left, depth + 1), right: normalizeFormulaNode(node.right, depth + 1) };
  if (node.op === "CEIL" || node.op === "FLOOR") return { op: node.op, value: normalizeFormulaNode(node.value, depth + 1) };
  throw new Error("Toán tử công thức không được hỗ trợ.");
}

export function normalizeParameterBinding(value: unknown): ParameterBinding | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new Error("Liên kết tham số không hợp lệ.");
  const input = value as Partial<ParameterBinding>;
  if (!input.mode || !["MANUAL", "PARAMETER", "FORMULA", "OVERRIDDEN"].includes(input.mode)) throw new Error("Chế độ liên kết tham số không hợp lệ.");
  const moduleId = input.moduleId === undefined ? undefined : String(input.moduleId);
  if (moduleId !== undefined && !KEY.test(moduleId)) throw new Error("Mã module của dòng không hợp lệ.");
  const quantityFormula = input.quantityFormula === undefined ? undefined : normalizeFormulaNode(input.quantityFormula);
  const unitPriceFormula = input.unitPriceFormula === undefined ? undefined : normalizeFormulaNode(input.unitPriceFormula);
  if (["PARAMETER", "FORMULA", "OVERRIDDEN"].includes(input.mode) && !quantityFormula && !unitPriceFormula) throw new Error("Liên kết tính toán phải có công thức.");
  const lastCalculated = input.lastCalculated && typeof input.lastCalculated === "object" ? {
    ...(input.lastCalculated.quantity === undefined ? {} : { quantity: String(input.lastCalculated.quantity) }),
    ...(input.lastCalculated.unitPrice === undefined ? {} : { unitPrice: String(input.lastCalculated.unitPrice) }),
  } : undefined;
  return { mode: input.mode, ...(moduleId ? { moduleId } : {}), ...(quantityFormula ? { quantityFormula } : {}), ...(unitPriceFormula ? { unitPriceFormula } : {}), ...(lastCalculated ? { lastCalculated } : {}) };
}

export function normalizeParameterSnapshot(value: unknown): QuotationParameterSnapshot {
  if (!value || typeof value !== "object") throw new Error("Thiết lập tham số không hợp lệ.");
  const input = value as Partial<QuotationParameterSnapshot>;
  if (input.schemaVersion !== 1) throw new Error("Phiên bản schema tham số không được hỗ trợ.");
  if (!Array.isArray(input.definitions) || !Array.isArray(input.modules) || input.definitions.length > MAX_ITEMS || input.modules.length > MAX_ITEMS) throw new Error("Tối đa 100 tham số và 100 module.");
  const definitions = input.definitions.map(definition => {
    if (!definition || typeof definition !== "object" || !KEY.test(String(definition.key ?? "")) || !["SHARED", "MODULE"].includes(definition.scope)) throw new Error("Định nghĩa tham số không hợp lệ.");
    return { key: String(definition.key), label: String(definition.label ?? "").slice(0, 200), defaultValue: numeric(definition.defaultValue, `Giá trị mặc định ${definition.key}`, true), scope: definition.scope } as ParameterDefinition;
  });
  if (new Set(definitions.map(item => item.key)).size !== definitions.length) throw new Error("Khóa tham số bị trùng.");
  const sharedInput = input.sharedValues && typeof input.sharedValues === "object" ? input.sharedValues : {};
  const sharedValues = Object.fromEntries(Object.entries(sharedInput).map(([key, value]) => {
    if (!KEY.test(key)) throw new Error("Khóa giá trị dùng chung không hợp lệ.");
    return [key, numeric(value, `Giá trị ${key}`, true)];
  }));
  const modules = input.modules.map(module => {
    if (!module || typeof module !== "object" || !KEY.test(String(module.id ?? ""))) throw new Error("Module chương trình không hợp lệ.");
    const overridesInput = module.overrides && typeof module.overrides === "object" ? module.overrides : {};
    const overrides = Object.fromEntries(Object.entries(overridesInput).map(([key, value]) => {
      if (!KEY.test(key)) throw new Error("Khóa override module không hợp lệ.");
      return [key, numeric(value, `Giá trị ${key}`, true)];
    }));
    return { id: String(module.id), label: String(module.label ?? "").slice(0, 200), ...(module.eventType ? { eventType: String(module.eventType).slice(0, 100) } : {}), overrides };
  });
  if (new Set(modules.map(item => item.id)).size !== modules.length) throw new Error("Mã module bị trùng.");
  return { schemaVersion: 1, definitions, sharedValues, modules };
}

function parameterValue(snapshot: QuotationParameterSnapshot, key: string, moduleId?: string): FormulaEvaluation {
  const definition = snapshot.definitions.find(item => item.key === key);
  if (!definition) return { issue: { code: "UNKNOWN_PARAMETER", message: `Không nhận diện tham số ${key}.` } };
  const eventModule = moduleId ? snapshot.modules.find(item => item.id === moduleId) : undefined;
  const value = eventModule?.overrides[key] ?? snapshot.sharedValues[key] ?? definition.defaultValue;
  if (value === undefined || value === "") return { issue: { code: "MISSING_PARAMETER", message: `Thiếu giá trị tham số ${definition.label || key}.` } };
  return { value };
}

function evaluateExact(node: FormulaNode, snapshot: QuotationParameterSnapshot, moduleId?: string): { rational: Rational } | { issue: ParameterIssue } {
  if (node.op === "PARAM") {
    const result = parameterValue(snapshot, node.key, node.moduleId ?? moduleId);
    return result.issue ? result : { rational: decimal(result.value) };
  }
  if (node.op === "CONST") return { rational: decimal(node.value) };
  if (node.op === "CEIL" || node.op === "FLOOR") {
    const value = evaluateExact(node.value, snapshot, moduleId);
    if ("issue" in value) return value;
    const { numerator, denominator } = value.rational;
    const integer = node.op === "FLOOR" ? numerator / denominator : (numerator + denominator - BigInt(1)) / denominator;
    return { rational: exact(integer.toString()) };
  }
  if (node.op !== "MUL" && node.op !== "DIV") return { issue: { code: "INVALID_RESULT", message: "Toán tử công thức không hợp lệ." } };
  const left = evaluateExact(node.left, snapshot, moduleId);
  if ("issue" in left) return left;
  const right = evaluateExact(node.right, snapshot, moduleId);
  if ("issue" in right) return right;
  if (node.op === "DIV" && right.rational.numerator === BigInt(0)) return { issue: { code: "DIVISION_BY_ZERO", message: "Công thức chia cho 0." } };
  return { rational: node.op === "MUL" ? multiply(left.rational, right.rational) : divide(left.rational, right.rational) };
}

function decimalResult(value: Rational): string | undefined {
  let denominator = value.denominator;
  let twos = 0; let fives = 0;
  while (denominator % BigInt(2) === BigInt(0)) { denominator /= BigInt(2); twos++; }
  while (denominator % BigInt(5) === BigInt(0)) { denominator /= BigInt(5); fives++; }
  if (denominator !== BigInt(1)) return undefined;
  const scale = Math.max(twos, fives);
  const scaled = value.numerator * (BigInt(2) ** BigInt(scale - twos)) * (BigInt(5) ** BigInt(scale - fives));
  if (!scale) return scaled.toString();
  const negative = scaled < BigInt(0);
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, "0");
  const rendered = `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "");
  return rendered === "-0" ? "0" : rendered;
}

export function evaluateFormula(node: FormulaNode, snapshot: QuotationParameterSnapshot, moduleId?: string): FormulaEvaluation {
  try {
    const result = evaluateExact(node, snapshot, moduleId);
    if ("issue" in result) return { issue: result.issue };
    if (result.rational.numerator < BigInt(0)) return { issue: { code: "INVALID_RESULT", message: "Kết quả công thức không được âm." } };
    const value = decimalResult(result.rational);
    return value === undefined ? { issue: { code: "INVALID_RESULT", message: `Kết quả ${source(result.rational)} không thể lưu chính xác dưới dạng số thập phân.` } } : { value };
  } catch {
    return { issue: { code: "INVALID_RESULT", message: "Không thể tính công thức." } };
  }
}

function fingerprint(rows: PairedRow[], parameterConfig?: QuotationParameterSnapshot) {
  return JSON.stringify({ rows: rows.map(row => ({ id: row.itemId, sell: row.sell, buy: row.buy })), parameterConfig });
}

function safeTotals(rows: PairedRow[], side: "sell" | "buy") {
  const calculated = rows.filter(row => row.rowType !== "GROUP").map(row => { try { return calculateCost(row[side]); } catch { return null; } });
  const valid = calculated.filter((item): item is NonNullable<typeof item> => item !== null);
  return { ...totals(valid), incomplete: valid.length !== calculated.length };
}

function calculatedRows(rows: PairedRow[], snapshot: QuotationParameterSnapshot) {
  const next = structuredClone(rows);
  const affected: ParameterImpact[] = [];
  const issues: ParameterIssue[] = [];
  for (const row of next) for (const side of ["sell", "buy"] as const) {
    const binding = row[side].parameterBinding;
    if (!binding || binding.mode === "MANUAL" || binding.mode === "OVERRIDDEN") continue;
    for (const field of ["quantity", "unitPrice"] as const) {
      const formula = field === "quantity" ? binding.quantityFormula : binding.unitPriceFormula;
      if (!formula) continue;
      const result = evaluateFormula(formula, snapshot, binding.moduleId);
      if (result.issue) issues.push({ ...result.issue, rowId: row.itemId, rowName: row.name, side, field });
      else {
        const oldValue = row[side][field];
        binding.lastCalculated = { ...(binding.lastCalculated ?? {}), [field]: result.value };
        if (oldValue !== result.value) {
          row[side][field] = result.value;
          affected.push({ rowId: row.itemId, rowName: row.name, side, field, oldValue, newValue: result.value });
        }
      }
    }
  }
  return { rows: next, affected, issues };
}

export function previewParameterImpact(rows: PairedRow[], current: QuotationParameterSnapshot, proposed: QuotationParameterSnapshot): ParameterImpactPreview {
  const normalizedCurrent = normalizeParameterSnapshot(current);
  const normalizedProposed = normalizeParameterSnapshot(proposed);
  const next = calculatedRows(rows, normalizedProposed);
  return {
    baseFingerprint: fingerprint(rows, normalizedCurrent),
    parameterConfig: structuredClone(normalizedProposed),
    affected: next.affected,
    issues: next.issues,
    oldTotals: { sell: safeTotals(rows, "sell"), buy: safeTotals(rows, "buy") },
    newTotals: { sell: safeTotals(next.rows, "sell"), buy: safeTotals(next.rows, "buy") },
  };
}

export function applyParameterImpact(rows: PairedRow[], current: QuotationParameterSnapshot, preview: ParameterImpactPreview) {
  if (fingerprint(rows, normalizeParameterSnapshot(current)) !== preview.baseFingerprint) throw new Error("Bảng đã thay đổi. Tính lại tác động trước khi áp dụng.");
  const result = calculatedRows(rows, preview.parameterConfig);
  return { rows: result.rows, parameterConfig: structuredClone(preview.parameterConfig), issues: result.issues };
}

export function parameterFinalizationIssues(rows: PairedRow[], snapshot: QuotationParameterSnapshot | undefined, side: "sell" | "buy") {
  if (!snapshot) return [];
  const normalized = normalizeParameterSnapshot(snapshot);
  return calculatedRows(rows, normalized).issues.filter(issue => issue.side === side);
}
