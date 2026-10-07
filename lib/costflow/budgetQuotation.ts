import type { IcRevision, Quotation } from "./types";

export function quotationUpdates(revision: IcRevision, quotations: Quotation[]) {
  const linked = new Set(revision.lines.map(l => l.quotationId).filter(Boolean));
  return quotations.filter(q => {
    let parentId = q.parentId; const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (linked.has(parentId)) return !linked.has(q.id);
      visited.add(parentId); parentId = quotations.find(p => p.id === parentId)?.parentId ?? null;
    }
    return false;
  });
}

export function quotationLineAncestors(quotations: Quotation[], quotationId: string, lineId: string) {
  const refs: { quotationId: string; lineId: string }[] = [];
  let quote = quotations.find(q => q.id === quotationId);
  let line = quote?.lines.find(l => l.id === lineId);
  const seen = new Set<string>();
  while (quote && line && !seen.has(line.id)) {
    seen.add(line.id); refs.push({ quotationId: quote.id, lineId: line.id });
    const parentLineId = line.parentQuotationLineId;
    quote = quotations.find(q => q.id === quote?.parentId);
    line = quote?.lines.find(l => l.id === parentLineId);
  }
  return refs;
}
