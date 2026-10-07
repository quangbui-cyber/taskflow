import { add, compare, decimal, divide, exact, multiply, round, source, sum, totals, type CalculatedCost } from "./money";

export type TotalReference = { source: string; basis: "NET" | "VAT" | "GROSS" };
export type QuotationTotalLine = { id: string; label: string; kind: "PERCENT" | "FIXED" | "SUBTOTAL"; value: string; vatPercent: string; references: TotalReference[] };
export type QuotationTotalLayoutRow = { id: string; label: string };

export const SYSTEM_TOTALS = [
  { id: "SYSTEM_NET", label: "TỔNG TIỀN CHƯA BAO GỒM THUẾ" },
  { id: "SYSTEM_VAT", label: "VAT" },
  { id: "SYSTEM_GROSS", label: "TỔNG TIỀN BAO GỒM THUẾ" },
] as const;

export function normalizeQuotationTotalLayout(lines: QuotationTotalLine[], input?: unknown): QuotationTotalLayoutRow[] {
  const allowed = new Map<string, string>([
    ...SYSTEM_TOTALS.map(row => [row.id, row.label] as const),
    ...lines.map(row => [row.id, row.label || "Dòng chưa đặt tên"] as const),
  ]);
  const supplied = Array.isArray(input) ? input : [];
  const result: QuotationTotalLayoutRow[] = [];
  for (const value of supplied) {
    if (!value || typeof value !== "object") continue;
    const id = String((value as QuotationTotalLayoutRow).id ?? "");
    if (!allowed.has(id) || result.some(row => row.id === id)) continue;
    result.push({ id, label: String((value as QuotationTotalLayoutRow).label ?? allowed.get(id)).trim().slice(0, 500) || allowed.get(id)! });
  }
  for (const [id, label] of allowed) if (!result.some(row => row.id === id)) {
    const row = { id, label };
    if (!id.startsWith("SYSTEM_") && result.some(value => value.id === "SYSTEM_GROSS")) result.splice(result.findIndex(value => value.id === "SYSTEM_GROSS"), 0, row);
    else result.push(row);
  }
  return result;
}

export function normalizeQuotationTotals(input: unknown): QuotationTotalLine[] {
  if (!Array.isArray(input) || input.length > 50) throw new Error("Tối đa 50 dòng tính tổng.");
  const lines = input.map(value => {
    const row = value as QuotationTotalLine;
    if (!row || !/^[\w-]{1,100}$/.test(row.id) || row.id === "ITEMS" || !["PERCENT", "FIXED", "SUBTOTAL"].includes(row.kind)) throw new Error("Dòng tính tổng không hợp lệ.");
    if (!Array.isArray(row.references) || row.references.length > 50 || row.references.some(ref => !ref || typeof ref.source !== "string" || !["NET", "VAT", "GROSS"].includes(ref.basis))) throw new Error("Căn cứ tính không hợp lệ.");
    if (new Set(row.references.map(ref => `${ref.source}:${ref.basis}`)).size !== row.references.length) throw new Error("Căn cứ tính bị trùng.");
    for (const field of ["value", "vatPercent"] as const) if (row[field] && compare(decimal(row[field]), decimal("0")) < 0) throw new Error("Giá trị và VAT không được âm.");
    return { id: row.id, label: String(row.label ?? "").slice(0, 500), kind: row.kind, value: String(row.value ?? "").trim(), vatPercent: String(row.vatPercent ?? "").trim(), references: row.references.map(ref => ({ source: ref.source, basis: ref.basis })) };
  });
  const ids = new Set(lines.map(line => line.id));
  if (ids.size !== lines.length) throw new Error("Mã dòng tổng bị trùng.");
  const visit = (id: string, path = new Set<string>()) => {
    if (id === "ITEMS") return;
    if (!ids.has(id) || path.has(id)) throw new Error("Căn cứ tính bị thiếu hoặc tạo vòng tham chiếu.");
    const next = new Set(path).add(id);
    lines.find(line => line.id === id)!.references.forEach(ref => visit(ref.source, next));
  };
  lines.forEach(line => visit(line.id));
  return lines;
}

export function calculateQuotationTotals(items: CalculatedCost, input: QuotationTotalLine[] = []) {
  const lines = normalizeQuotationTotals(input);
  const amounts = new Map<string, CalculatedCost | null>([["ITEMS", items]]);
  const calculate = (id: string): CalculatedCost | null => {
    if (amounts.has(id)) return amounts.get(id)!;
    const line = lines.find(row => row.id === id)!;
    let amount: CalculatedCost | null = null;
    try {
      if (!line.label.trim() || (line.kind !== "SUBTOTAL" && (!line.value || !line.vatPercent)) || (line.kind !== "FIXED" && !line.references.length)) throw new Error("Thiếu dữ liệu.");
      const basis = sum(line.references.map(ref => {
        const value = calculate(ref.source);
        if (!value) throw new Error("Căn cứ chưa đủ dữ liệu.");
        return exact(ref.basis === "NET" ? value.rawNet : ref.basis === "VAT" ? value.rawVat : value.rawGross);
      }));
      const net = line.kind === "FIXED" ? decimal(line.value) : line.kind === "PERCENT" ? multiply(basis, divide(decimal(line.value), decimal("100"))) : basis;
      const vat = line.kind === "SUBTOTAL" ? decimal("0") : multiply(net, divide(decimal(line.vatPercent), decimal("100")));
      const gross = add(net, vat);
      amount = { rawNet: source(net), rawVat: source(vat), rawGross: source(gross), net: round(net), vat: round(vat), gross: round(gross) };
    } catch { /* Incomplete drafts remain editable. */ }
    amounts.set(id, amount);
    return amount;
  };
  const results = lines.map(line => ({ ...line, amount: calculate(line.id) }));
  return { lines: results, amount: totals([items, ...results.flatMap(line => line.kind !== "SUBTOTAL" && line.amount ? [line.amount] : [])]), incomplete: results.some(line => !line.amount) };
}
