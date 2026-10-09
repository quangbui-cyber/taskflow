import { calculateLineCost, totals, type CalculatedCost } from "./money";
import type { PairedRow } from "./types";

export function childrenOf(rows: PairedRow[], parent: string | null) { return rows.filter(row => row.parentItemId === parent); }
export function orderedRows(rows: PairedRow[], parent: string | null = null, depth = 0): { row: PairedRow; depth: number }[] {
  return childrenOf(rows, parent).flatMap(row => [{ row, depth }, ...orderedRows(rows, row.itemId, depth + 1)]);
}
export function rowCost(row: PairedRow, scope: "sell" | "buy"): CalculatedCost | null {
  try {
    return calculateLineCost(row[scope]);
  } catch {
    return null;
  }
}
export function saleContributors(rows: PairedRow[], parent: string | null = null): PairedRow[] {
  return childrenOf(rows, parent).filter(row => !row.saleRemoved).flatMap(row => {
    const children = childrenOf(rows, row.itemId);
    if (row.rowType === "GROUP") return saleContributors(rows, row.itemId);
    return children.length && row.pricingMode === "DETAIL" ? saleContributors(rows, row.itemId) : [row];
  });
}
export function buyingRows(rows: PairedRow[]) { return rows.filter(row => row.rowType !== "GROUP" && !childrenOf(rows, row.itemId).length); }
export function pricedTotal(rows: PairedRow[], scope: "sell" | "buy") {
  const inputs = scope === "sell" ? saleContributors(rows) : buyingRows(rows);
  const costs = inputs.map(row => rowCost(row, scope));
  return { ...totals(costs.filter(cost => cost !== null)), incomplete: costs.some(c => c === null) || inputs.length === 0 };
}
export function groupAmount(rows: PairedRow[], row: PairedRow, scope: "sell" | "buy") {
  const descendants = orderedRows(rows, row.itemId).map(entry => entry.row);
  if (row.rowType === "GROUP") {
    const inputs = scope === "sell" ? saleContributors(rows, row.itemId) : buyingRows(descendants);
    const costs = inputs.map(input => rowCost(input, scope));
    return costs.some(cost => cost === null) || !costs.length ? null : totals(costs.filter(cost => cost !== null));
  }
  if (!descendants.length || (scope === "sell" && row.pricingMode === "PACKAGE")) return rowCost(row, scope);
  const inputs = scope === "sell" ? saleContributors(rows, row.itemId) : buyingRows(descendants);
  const costs = inputs.map(row => rowCost(row, scope));
  return costs.some(cost => cost === null) || !costs.length ? null : totals(costs.filter(cost => cost !== null));
}
