import type { FinanceData, IcLine } from "./types";

export function resolveIcLineOrigin(data: FinanceData, revisionId: string, lineId: string) {
  return data.lineArchive?.find(entry => entry.revisionId === revisionId && entry.line.id === lineId)?.line ?? data.revisions.find(r => r.id === revisionId)?.lines.find(l => l.id === lineId);
}

export function validateIcLineOrigins(data: FinanceData, line: IcLine, revisionId: string) {
  const seen = new Set<string>();
  const visit = (ref: { revisionId: string; lineId: string }, path: Set<string>) => {
    const key = `${ref.revisionId}:${ref.lineId}`;
    if ((ref.revisionId === revisionId && ref.lineId === line.id) || path.has(key)) throw new Error("Nguồn dòng có vòng tham chiếu.");
    const source = resolveIcLineOrigin(data, ref.revisionId, ref.lineId);
    if (!source) throw new Error("Nguồn dòng không thuộc phiên bản trong project.");
    const next = new Set(path); next.add(key);
    for (const parent of source.originLines ?? []) visit(parent, next);
  };
  for (const ref of line.originLines ?? []) {
    const key = `${ref.revisionId}:${ref.lineId}`;
    if (seen.has(key)) throw new Error("Nguồn dòng bị trùng.");
    seen.add(key); visit(ref, new Set());
  }
}
