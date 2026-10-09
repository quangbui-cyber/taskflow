import type { CalculatedCost } from "./money";

export type CustomerEvidenceMetadata = { id: string; name: string; sha256: string };
export type CustomerLiquidationFact = {
  id: string;
  version: number;
  documentNumber: string;
  signedAt: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  evidence: CustomerEvidenceMetadata;
  createdAt: string;
};
export type CustomerCashInFact = {
  id: string;
  liquidationId: string | null;
  milestone: string;
  occurredAt: string;
  amount: string;
  reference: string;
  evidence: CustomerEvidenceMetadata | null;
  createdAt: string;
};
export type ActualCostMarginFact = { stableLineId: string; source: "normalized" | "legacy"; cost: CalculatedCost };

const exactVnd = (value: string, label: string, allowZero = true) => {
  if (!/^\d+$/.test(value) || (!allowZero && value === "0")) throw new Error(`${label} phải là số nguyên VND ${allowZero ? "không âm" : "dương"}.`);
  return BigInt(value);
};

export function validateLiquidationAmounts(input: { netAmount: string; vatAmount: string; grossAmount: string }) {
  const net = exactVnd(input.netAmount, "Giá trị net");
  const vat = exactVnd(input.vatAmount, "VAT");
  const gross = exactVnd(input.grossAmount, "Tổng gross", false);
  if (net + vat !== gross) throw new Error("Tổng gross phải bằng đúng giá trị net cộng VAT.");
  return { netAmount: net.toString(), vatAmount: vat.toString(), grossAmount: gross.toString() };
}

function percent(margin: bigint, revenue: bigint) {
  if (revenue === BigInt(0)) return null;
  const negative = margin < BigInt(0);
  const absolute = negative ? -margin : margin;
  const basisPoints = (absolute * BigInt(10000) + revenue / BigInt(2)) / revenue;
  const whole = basisPoints / BigInt(100);
  const fraction = (basisPoints % BigInt(100)).toString().padStart(2, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function deriveCustomerAccounting(input: {
  liquidations: CustomerLiquidationFact[];
  cashIns: CustomerCashInFact[];
  quotation: { net: string; gross: string } | null;
  purchaseOrderNet: string;
  actualCosts: ActualCostMarginFact[];
}) {
  const liquidations = [...input.liquidations].sort((a, b) => a.version - b.version);
  const currentLiquidation = liquidations.at(-1) ?? null;
  const quotationNet = input.quotation ? exactVnd(input.quotation.net, "Báo giá net") : BigInt(0);
  const quotationGross = input.quotation ? exactVnd(input.quotation.gross, "Báo giá gross") : BigInt(0);
  const purchaseOrderNet = exactVnd(input.purchaseOrderNet, "PO net");
  const revenueNet = currentLiquidation ? exactVnd(currentLiquidation.netAmount, "Thanh lý net") : input.quotation ? quotationNet : purchaseOrderNet;
  const revenueSource = currentLiquidation ? "SIGNED_LIQUIDATION_NET" as const : input.quotation ? "FINALIZED_QUOTATION_NET" as const : purchaseOrderNet > BigInt(0) ? "CURRENT_PO_NET" as const : "NO_REVENUE_SOURCE" as const;

  const costs = new Map<string, ActualCostMarginFact>();
  for (const row of input.actualCosts.filter(row => row.source === "legacy")) costs.set(row.stableLineId, row);
  for (const row of input.actualCosts.filter(row => row.source === "normalized")) costs.set(row.stableLineId, row);
  const included = [...costs.values()];
  const incurredNet = included.reduce((total, row) => total + exactVnd(row.cost.net, "AC net"), BigInt(0));
  const netMargin = revenueNet - incurredNet;

  const targetGross = currentLiquidation ? exactVnd(currentLiquidation.grossAmount, "Thanh lý gross") : input.quotation ? quotationGross : purchaseOrderNet;
  const receivableSource = currentLiquidation ? "LIQUIDATION_GROSS" as const : input.quotation ? "QUOTATION_GROSS" as const : purchaseOrderNet > BigInt(0) ? "PO_NET_FALLBACK" as const : "NO_RECEIVABLE_SOURCE" as const;
  const collectedGross = input.cashIns.reduce((total, row) => total + exactVnd(row.amount, "Tiền khách hàng đã thu", false), BigInt(0));

  return {
    currentLiquidation,
    liquidations,
    cashIns: [...input.cashIns].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    receivable: { source: receivableSource, targetGross: targetGross.toString(), collectedGross: collectedGross.toString(), outstandingGross: (targetGross - collectedGross).toString() },
    margin: {
      source: revenueSource,
      revenueNet: revenueNet.toString(),
      incurredNet: incurredNet.toString(),
      netMargin: netMargin.toString(),
      percent: percent(netMargin, revenueNet),
      legacyCompatibility: included.some(row => row.source === "legacy"),
    },
  };
}

export type CustomerAccountingReadModel = ReturnType<typeof deriveCustomerAccounting>;
