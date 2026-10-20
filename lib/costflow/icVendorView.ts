import { totals } from "./money";
import type { IcLine } from "./types";

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
    return Number(b.amount.rawGross) - Number(a.amount.rawGross) || a.name.localeCompare(b.name, "vi");
  });
}
