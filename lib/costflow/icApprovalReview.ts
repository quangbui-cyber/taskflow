import { calculateMargin, compare, displayMoney, exact, totals, type CalculatedCost } from "./money";
import { projectQuotation } from "./quotationProjection";
import type { Beneficiary, IcEvidenceSupplement, IcLine, Quotation } from "./types";

export type IcReviewIssueCode =
  | "MISSING_EVIDENCE"
  | "EVIDENCE_REASON_ONLY"
  | "MISSING_VENDOR"
  | "UNKNOWN_VENDOR"
  | "UNLINKED_QUOTATION"
  | "IC_ABOVE_QUOTATION";

export type IcApprovalReviewRow = {
  id: string;
  description: string;
  vendorId: string | null;
  vendorName: string | null;
  icCost: CalculatedCost | null;
  quotationCost: CalculatedCost | null;
  evidenceIds: string[];
  evidenceNames: string[];
  evidenceReason: string;
  hasSupplement: boolean;
  evidenceState: "FILE" | "REASON" | "MISSING";
  issues: IcReviewIssueCode[];
};

export type IcApprovalReviewWarning = {
  code: "MISSING_EVIDENCE" | "MISSING_VENDOR" | "SHARED_EVIDENCE" | "INCOMPLETE_COST" | "NEGATIVE_MARGIN" | "QUOTATION_UNAVAILABLE";
  tone: "info" | "warning" | "danger";
  title: string;
  detail: string;
};

export type IcApprovalReview = {
  rows: IcApprovalReviewRow[];
  totals: {
    ic: CalculatedCost;
    quotation: CalculatedCost | null;
    margin: ReturnType<typeof calculateMargin>;
  };
  coverage: {
    totalLines: number;
    evidenceFileLines: number;
    evidenceReasonLines: number;
    missingEvidenceLines: number;
    evidenceGross: string;
    evidencePercent: string;
    vendorLines: number;
    missingVendorLines: number;
    vendorGross: string;
    vendorPercent: string;
  };
  sharedEvidence: { id: string; name: string; lineCount: number; gross: string }[];
  warnings: IcApprovalReviewWarning[];
  quotation: { id: string; number: number; title: string } | null;
};

const ZERO_COST: CalculatedCost = {
  rawNet: "0/1",
  rawVat: "0/1",
  rawGross: "0/1",
  net: "0",
  vat: "0",
  gross: "0",
};

function aggregate(costs: (CalculatedCost | null | undefined)[]) {
  const present = costs.filter((cost): cost is CalculatedCost => Boolean(cost));
  return present.length ? totals(present) : ZERO_COST;
}

function percent(part: string, whole: string) {
  const denominator = BigInt(whole);
  if (denominator <= BigInt(0)) return "0%";
  const tenths = (BigInt(part) * BigInt(1000) + denominator / BigInt(2)) / denominator;
  const wholePercent = tenths / BigInt(10);
  const decimalPart = tenths % BigInt(10);
  return decimalPart === BigInt(0) ? `${wholePercent}%` : `${wholePercent},${decimalPart}%`;
}

export function buildIcApprovalReview(input: {
  lines: IcLine[];
  quotation?: Quotation;
  beneficiaries: Beneficiary[];
  supplements?: IcEvidenceSupplement[];
  evidence: { id: string; name: string }[];
}): IcApprovalReview {
  const vendors = new Map(input.beneficiaries.map(vendor => [vendor.id, vendor.name]));
  const files = new Map(input.evidence.map(file => [file.id, file.name]));
  const quotationLines = new Map((input.quotation?.lines ?? []).map(line => [line.id, line]));
  const supplementsByLine = new Map<string, IcEvidenceSupplement[]>();
  for (const supplement of input.supplements ?? []) {
    supplementsByLine.set(supplement.lineId, [...(supplementsByLine.get(supplement.lineId) ?? []), supplement]);
  }

  const rows = input.lines.map<IcApprovalReviewRow>(line => {
    const supplements = supplementsByLine.get(line.id) ?? [];
    const evidenceIds = [...new Set([
      ...(line.evidenceIds ?? []),
      ...supplements.flatMap(supplement => supplement.evidenceIds),
    ])];
    const evidenceReason = [line.evidenceReason, ...supplements.map(supplement => supplement.reason)]
      .map(value => value?.trim() ?? "")
      .filter(Boolean)
      .join(" · ");
    const evidenceState = evidenceIds.length ? "FILE" as const : evidenceReason ? "REASON" as const : "MISSING" as const;
    const vendorName = line.vendorId ? vendors.get(line.vendorId) ?? null : null;
    const quotationLine = line.quotationLineId ? quotationLines.get(line.quotationLineId) : undefined;
    const issues: IcReviewIssueCode[] = [];
    if (evidenceState === "MISSING") issues.push("MISSING_EVIDENCE");
    if (evidenceState === "REASON") issues.push("EVIDENCE_REASON_ONLY");
    if (!line.vendorId) issues.push("MISSING_VENDOR");
    else if (!vendorName) issues.push("UNKNOWN_VENDOR");
    if (!quotationLine) issues.push("UNLINKED_QUOTATION");
    if (line.cost && quotationLine?.cost && compare(exact(line.cost.rawNet), exact(quotationLine.cost.rawNet)) > 0) {
      issues.push("IC_ABOVE_QUOTATION");
    }
    return {
      id: line.id,
      description: line.description,
      vendorId: line.vendorId ?? null,
      vendorName,
      icCost: line.cost,
      quotationCost: quotationLine?.cost ?? null,
      evidenceIds,
      evidenceNames: evidenceIds.map(id => files.get(id) ?? "Minh chứng"),
      evidenceReason,
      hasSupplement: supplements.length > 0,
      evidenceState,
      issues,
    };
  });

  const ic = aggregate(rows.map(row => row.icCost));
  let quotationTotal: CalculatedCost | null = null;
  if (input.quotation) {
    try {
      quotationTotal = projectQuotation(input.quotation).amount;
    } catch {
      quotationTotal = null;
    }
  }
  const evidenceRows = rows.filter(row => row.evidenceState === "FILE");
  const vendorRows = rows.filter(row => row.vendorId && row.vendorName);
  const evidenceGross = aggregate(evidenceRows.map(row => row.icCost)).gross;
  const vendorGross = aggregate(vendorRows.map(row => row.icCost)).gross;

  const evidenceUsage = new Map<string, IcApprovalReviewRow[]>();
  for (const row of rows) {
    for (const evidenceId of row.evidenceIds) {
      evidenceUsage.set(evidenceId, [...(evidenceUsage.get(evidenceId) ?? []), row]);
    }
  }
  const sharedEvidence = [...evidenceUsage.entries()]
    .filter(([, linkedRows]) => linkedRows.length > 1)
    .map(([id, linkedRows]) => ({
      id,
      name: files.get(id) ?? "Minh chứng",
      lineCount: linkedRows.length,
      gross: aggregate(linkedRows.map(row => row.icCost)).gross,
    }))
    .sort((left, right) => right.lineCount - left.lineCount);

  const missingEvidence = rows.filter(row => row.evidenceState === "MISSING");
  const missingVendors = rows.filter(row => !row.vendorId || !row.vendorName);
  const incompleteCost = rows.filter(row => !row.icCost);
  const margin = calculateMargin(quotationTotal, ic);
  const warnings: IcApprovalReviewWarning[] = [];
  if (missingEvidence.length) warnings.push({
    code: "MISSING_EVIDENCE",
    tone: "danger",
    title: `${missingEvidence.length} dòng chưa có minh chứng hoặc lý do`,
    detail: `Giá trị IC gồm VAT cần kiểm tra: ${displayMoney(aggregate(missingEvidence.map(row => row.icCost)).gross)}.`,
  });
  if (missingVendors.length) warnings.push({
    code: "MISSING_VENDOR",
    tone: "warning",
    title: `${missingVendors.length} dòng chưa xác định được NCC`,
    detail: `Giá trị IC gồm VAT liên quan: ${displayMoney(aggregate(missingVendors.map(row => row.icCost)).gross)}.`,
  });
  if (sharedEvidence.length) warnings.push({
    code: "SHARED_EVIDENCE",
    tone: "info",
    title: `${sharedEvidence.length} file đang liên kết với nhiều dòng IC`,
    detail: `File dùng rộng nhất áp dụng cho ${sharedEvidence[0].lineCount} dòng; đây là tín hiệu cần kiểm tra, không tự kết luận hồ sơ sai.`,
  });
  if (incompleteCost.length) warnings.push({
    code: "INCOMPLETE_COST",
    tone: "warning",
    title: `${incompleteCost.length} dòng chưa có giá trị IC hoàn chỉnh`,
    detail: "Các dòng này không được cộng vào tổng giá trị và coverage theo tiền.",
  });
  if (input.quotation && !quotationTotal) warnings.push({
    code: "QUOTATION_UNAVAILABLE",
    tone: "warning",
    title: "Chưa thể tính tổng báo giá nguồn",
    detail: "Reviewer vẫn có thể kiểm tra IC, NCC và minh chứng; biên dự kiến tạm chưa hiển thị.",
  });
  if (margin && !margin.isPositive) warnings.push({
    code: "NEGATIVE_MARGIN",
    tone: "warning",
    title: "Tổng IC đang cao hơn báo giá nguồn",
    detail: `Biên dự kiến theo Net là ${margin.marginDisplay} (${margin.percentDisplay}).`,
  });

  return {
    rows,
    totals: { ic, quotation: quotationTotal, margin },
    coverage: {
      totalLines: rows.length,
      evidenceFileLines: evidenceRows.length,
      evidenceReasonLines: rows.filter(row => row.evidenceState === "REASON").length,
      missingEvidenceLines: missingEvidence.length,
      evidenceGross,
      evidencePercent: percent(evidenceGross, ic.gross),
      vendorLines: vendorRows.length,
      missingVendorLines: missingVendors.length,
      vendorGross,
      vendorPercent: percent(vendorGross, ic.gross),
    },
    sharedEvidence,
    warnings,
    quotation: input.quotation ? { id: input.quotation.id, number: input.quotation.number, title: input.quotation.title } : null,
  };
}
