import type { PurchaseOrder } from "./types";

/** IDs always identify an immutable source version, including legacy records. */
export function currentPurchaseOrders(pos: PurchaseOrder[]) {
  const replaced = new Set(pos.flatMap(po => [po.parentPoId, po.replacesPoId].filter((id): id is string => !!id)));
  return pos.filter(po => !replaced.has(po.id));
}

export function resolvePurchaseOrderHistory(pos: PurchaseOrder[], id: string) {
  const found = pos.find(po => po.id === id);
  if (!found) return [];
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const po of pos) {
      const links = [po.id, po.parentPoId, po.replacesPoId].filter((v): v is string => !!v);
      if (links.some(v => ids.has(v))) for (const v of links) if (!ids.has(v)) { ids.add(v); changed = true; }
    }
  }
  return pos.filter(po => ids.has(po.id));
}
