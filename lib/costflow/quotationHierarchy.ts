import { childrenOf, orderedRows } from "./pairedPricing";
import type { PairedRow } from "./types";

export type QuotationOutlineRole = "GROUP" | "ITEM" | "DETAIL";
export type QuotationOutlineRow = { row: PairedRow; depth: number; role: QuotationOutlineRole; numberLabel: string };

function alphaLabel(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value--;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function quotationOutline(rows: PairedRow[]): QuotationOutlineRow[] {
  const result: QuotationOutlineRow[] = [];
  let groupIndex = 0;
  let flatItemIndex = 0;
  const walk = (parent: string | null, depth: number, itemIndex = { value: 0 }) => {
    for (const row of childrenOf(rows, parent)) {
      let role: QuotationOutlineRole = "DETAIL";
      let numberLabel = "";
      if (row.rowType === "GROUP" && depth === 0) {
        role = "GROUP";
        numberLabel = alphaLabel(groupIndex++);
      } else if (depth === 0) {
        role = "ITEM";
        numberLabel = String(++flatItemIndex);
      } else {
        const parentRow = rows.find(candidate => candidate.itemId === parent);
        if (parentRow?.rowType === "GROUP") {
          role = "ITEM";
          numberLabel = String(++itemIndex.value);
        }
      }
      result.push({ row, depth, role, numberLabel });
      walk(row.itemId, depth + 1, role === "GROUP" ? { value: 0 } : itemIndex);
    }
  };
  walk(null, 0);
  return result;
}

function subtreeHeight(rows: PairedRow[], id: string): number {
  const children = childrenOf(rows, id);
  return children.length ? 1 + Math.max(...children.map(child => subtreeHeight(rows, child.itemId))) : 0;
}

function flatten(rows: PairedRow[], parent: string | null = null): PairedRow[] {
  return childrenOf(rows, parent).flatMap(row => [row, ...flatten(rows, row.itemId)]);
}

export function moveQuotationTree(rows: PairedRow[], sourceId: string, targetParentId: string | null, targetIndex: number): PairedRow[] {
  const source = rows.find(row => row.itemId === sourceId);
  if (!source) throw new Error("Không tìm thấy dòng cần di chuyển.");
  const descendants = new Set(orderedRows(rows, sourceId).map(entry => entry.row.itemId));
  if (targetParentId === sourceId || (targetParentId && descendants.has(targetParentId))) throw new Error("Không thể chuyển một dòng vào chính cây con của nó.");
  const targetParent = targetParentId ? rows.find(row => row.itemId === targetParentId) : null;
  if (targetParentId && !targetParent) throw new Error("Không tìm thấy dòng cha đích.");
  if (source.rowType === "GROUP" && targetParentId) throw new Error("Nhóm chỉ được đặt ở cấp gốc.");
  if (targetParent?.rowType === "ITEM" && subtreeHeight(rows, sourceId) > 0) throw new Error("Chi tiết con không thể chứa thêm một cấp bên dưới.");

  const targetDepth = targetParent ? (orderedRows(rows).find(entry => entry.row.itemId === targetParent.itemId)?.depth ?? 0) + 1 : 0;
  if (targetDepth + subtreeHeight(rows, sourceId) > 2) throw new Error("Nội dung hỗ trợ tối đa ba cấp.");

  const moved = rows.map(row => row.itemId === sourceId ? { ...row, parentItemId: targetParentId } : row);
  const siblings = childrenOf(moved, targetParentId).filter(row => row.itemId !== sourceId);
  siblings.splice(Math.max(0, Math.min(targetIndex, siblings.length)), 0, moved.find(row => row.itemId === sourceId)!);
  const order = new Map<string, number>();
  childrenOf(moved, targetParentId).forEach((row, index) => order.set(row.itemId, index));
  siblings.forEach((row, index) => order.set(row.itemId, index));
  const sorted = [...moved].sort((a, b) => {
    if (a.parentItemId === targetParentId && b.parentItemId === targetParentId) return (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0);
    return 0;
  });
  return flatten(sorted);
}
