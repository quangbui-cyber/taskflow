import { calculateCost, compare, decimal, type CalculatedCost } from "./money";
import type { IcLine } from "./types";

export function draftLineIssues(line: Partial<IcLine>) {
  const issues: string[] = [];
  if (!line.description?.trim()) issues.push("missing-description");
  for (const key of ["quantity", "unitPrice", "vatPercent"] as const) {
    const value = line[key]?.trim() ?? "";
    if (!value) issues.push(key === "unitPrice" ? "missing-price" : key === "vatPercent" ? "missing-VAT" : "missing-quantity");
    else if (compare(decimal(value), decimal("0")) < 0) throw new Error("Số lượng, đơn giá và VAT không được âm.");
  }
  if (line.basis !== undefined && !["NET", "GROSS"].includes(line.basis)) throw new Error("Chọn net hoặc gross.");
  return issues;
}

export function completeIcLines(lines: IcLine[]): (IcLine & { cost: CalculatedCost })[] {
  if (!lines.length || lines.some(line => draftLineIssues(line).length)) throw new Error("IC cần đủ nội dung, số lượng, giá vốn và VAT trước khi gửi duyệt.");
  return lines.map(line => ({ ...line, cost: calculateCost(line) }));
}
