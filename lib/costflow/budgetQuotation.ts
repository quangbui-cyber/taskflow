import type { IcLine, IcRevision, Quotation, QuotationLine, PairedRow } from "./types";

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

export type IcQuotationMatch = {
  quotation: Quotation;
  line: QuotationLine;
  salesRow?: PairedRow | Omit<PairedRow, "buy" | "icLineId">;
  isDirectLink: boolean;
};

export function matchIcLineToQuotation(
  icLine: IcLine,
  quotations: Quotation[],
  preferredQuotationId?: string
): IcQuotationMatch | null {
  if (!quotations || quotations.length === 0) return null;

  const targetQuoteId = icLine.quotationId || preferredQuotationId;
  const preferredQuote = targetQuoteId
    ? quotations.find(q => q.id === targetQuoteId)
    : quotations[quotations.length - 1];

  const searchQuotes = preferredQuote
    ? [preferredQuote, ...quotations.filter(q => q.id !== preferredQuote.id)]
    : quotations;

  for (const quote of searchQuotes) {
    if (icLine.quotationLineId) {
      const qLine = quote.lines.find(l => l.id === icLine.quotationLineId);
      if (qLine) {
        return {
          quotation: quote,
          line: qLine,
          salesRow: quote.salesRows?.find(r => r.quotationLineId === qLine.id || r.itemId === icLine.itemId),
          isDirectLink: true,
        };
      }
    }

    if (icLine.itemId) {
      const salesRow = quote.salesRows?.find(r => r.itemId === icLine.itemId);
      if (salesRow) {
        const qLine = quote.lines.find(l => l.id === salesRow.quotationLineId) || quote.lines.find(l => l.id === salesRow.itemId);
        if (qLine) {
          return {
            quotation: quote,
            line: qLine,
            salesRow,
            isDirectLink: icLine.quotationLineId === qLine.id,
          };
        }
      }
      const directLine = quote.lines.find(l => l.id === icLine.itemId);
      if (directLine) {
        return {
          quotation: quote,
          line: directLine,
          isDirectLink: icLine.quotationLineId === directLine.id,
        };
      }
    }

    const normDesc = (icLine.description || "").trim().toLowerCase();
    if (normDesc) {
      const qLine = quote.lines.find(l => (l.description || "").trim().toLowerCase() === normDesc);
      if (qLine) {
        return {
          quotation: quote,
          line: qLine,
          salesRow: quote.salesRows?.find(r => r.quotationLineId === qLine.id || r.itemId === icLine.itemId),
          isDirectLink: icLine.quotationLineId === qLine.id,
        };
      }
    }
  }

  return null;
}
