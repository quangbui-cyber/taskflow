import { totals } from "./money";
import type { IcLine } from "./types";

export type IcVendorLineFilter = "ALL" | "MISSING_COST";
export type IcVendorLineSort = "GROSS_DESC" | "IC_ORDER" | "NAME_ASC" | "QUANTITY_DESC";

export function filterAndSortIcVendorLines(
  lines: IcLine[],
  query: string,
  filter: IcVendorLineFilter,
  sort: IcVendorLineSort,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase("vi");
  const indexed = lines.map((line, index) => ({ line, index })).filter(({ line }) => {
    if (filter === "MISSING_COST" && line.cost) return false;
    if (!normalizedQuery) return true;
    return line.description.toLocaleLowerCase("vi").includes(normalizedQuery)
      || line.unit.toLocaleLowerCase("vi").includes(normalizedQuery);
  });

  indexed.sort((a, b) => {
    if (sort === "IC_ORDER") return a.index - b.index;
    if (sort === "NAME_ASC") {
      return a.line.description.localeCompare(b.line.description, "vi") || a.index - b.index;
    }
    if (sort === "QUANTITY_DESC") {
      return Number(b.line.quantity || 0) - Number(a.line.quantity || 0) || a.index - b.index;
    }
    return Number(b.line.cost?.gross ?? -1) - Number(a.line.cost?.gross ?? -1) || a.index - b.index;
  });

  return indexed.map(({ line }) => line);
}

export function icVendorShare(gross: string, totalGross: string) {
  const total = Number(totalGross);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const share = Number(gross) / total * 100;
  return Number.isFinite(share) ? Math.max(0, share) : 0;
}

export function groupIcLinesByVendor(lines: IcLine[], vendors: { id: string; name: string }[]) {
  const names = new Map(vendors.map(vendor => [vendor.id, vendor.name]));
  const grouped = new Map<string | null, IcLine[]>();
  for (const line of lines) {
    const vendorId = line.vendorId || null;
    grouped.set(vendorId, [...(grouped.get(vendorId) ?? []), line]);
  }

  return [...grouped].map(([vendorId, vendorLines]) => ({
    vendorId,
    name: vendorId ? names.get(vendorId) ?? "NCC không còn trong danh bạ" : "Chưa gắn NCC",
    lines: vendorLines,
    missingCostCount: vendorLines.filter(line => !line.cost).length,
    amount: totals(vendorLines.flatMap(line => line.cost ? [line.cost] : [])),
  })).sort((a, b) => {
    if (!a.vendorId) return 1;
    if (!b.vendorId) return -1;
    return Number(b.amount.gross) - Number(a.amount.gross) || a.name.localeCompare(b.name, "vi");
  });
}
