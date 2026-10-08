import type { QuotationTotalLayoutRow, QuotationTotalLine } from "./quotationTotals";
import type { CalculatedCost, CostInput } from "./money";
import type { ParameterBinding, QuotationParameterSnapshot } from "./quotationParameters";

export type IcLine = CostInput & { id: string; description: string; unit: string; cost: CalculatedCost | null; parameterBinding?: ParameterBinding; quotationId?: string; quotationLineId?: string; originLines?: { revisionId: string; lineId: string }[]; vendorId?: string; itemId?: string; evidenceIds?: string[]; evidenceReason?: string; internalNotes?: string };
export type PairedSide = CostInput & { unit: string; notes: string; parameterBinding?: ParameterBinding };
export type PairedRow = { itemId: string; parentItemId: string | null; rowType: "GROUP" | "ITEM"; description: string; name: string; pricingMode: "PACKAGE" | "DETAIL"; showChildren: boolean; showGroupSubtotal: boolean; packageChildDisplay: "CONTENT" | "QUANTITY"; saleRemoved?: boolean; quotationLineId?: string; icLineId?: string; sell: PairedSide; buy: PairedSide & { vendorId: string; evidenceIds: string[]; evidenceReason: string } };
export type QuotationReuseKind = "TEMPLATE" | "HISTORICAL_QUOTATION";
export type QuotationReuseDraftSource = { kind: QuotationReuseKind; label: string; sourceDate: string };
export type PairedDraft = { workspaceMode?: "quote" | "paired" | "ic"; parameterConfig?: QuotationParameterSnapshot; totalLines?: QuotationTotalLine[]; totalLayout?: QuotationTotalLayoutRow[]; id: string; version: number; createdBy: string; title: string; clientId: string; customer: string; notes: string; rows: PairedRow[]; sourceQuotationId?: string; sourceQuoteDraftId?: string; latestQuotationId?: string; icRevisionId?: string; globalEvidenceIds: string[]; reuseSource?: QuotationReuseDraftSource; priceReviewRequired?: boolean };
export type IcEvidenceSupplement = { evidenceHashes?: Record<string,string>; operationId: string; requestId: string; requestVersion: number; lineId: string; evidenceIds: string[]; reason: string; actorId: string; createdAt: string };
export type QuotationLine = CostInput & { id: string; description: string; unit: string; cost: CalculatedCost; parentQuotationLineId?: string };
export type Quotation = { parameterConfig?: QuotationParameterSnapshot; totalLines?: QuotationTotalLine[]; totalLayout?: QuotationTotalLayoutRow[]; id: string; number: number; parentId: string | null; title: string; customer: string; notes: string; lines: QuotationLine[]; poIds: string[]; briefIds?: string[]; evidenceIds: string[]; createdBy: string; createdAt: string; salesRows?: Omit<PairedRow, "buy" | "icLineId">[] };
export type IcRevision = { parameterConfig?: QuotationParameterSnapshot; pairedDraftId?: string; quotationId?: string; tree?: { itemId: string; parentItemId: string | null; name: string; description: string }[]; evidenceHashes?: Record<string,string>; id: string; number: number; requestId: string; effective: boolean; lines: IcLine[]; poIds: string[]; briefIds?: string[]; evidenceIds?: string[]; createdBy: string; parentRevisionId?: string; supersededByRevisionId?: string; lineageReason?: string; internalNotes?: string; submissions?: { parameterConfig?: QuotationParameterSnapshot; tree?: { itemId: string; parentItemId: string | null; name: string; description: string }[]; evidenceHashes?: Record<string,string>; requestId: string; requestVersion: number; submittedAt: string | null; title: string; explanation?: string; baselineRevisionId?: string | null; lines: IcLine[]; poIds: string[]; briefIds: string[]; evidenceIds?: string[] }[] };
export type Beneficiary = { id: string; name: string; bank: string; account: string; version: number; verifiedVersion: number | null; proofId: string };
/**
 * Nguồn quỹ chi trả của khoản AC:
 * - ADVANCE: Trừ vào quỹ tạm ứng của nhân sự (liên kết ĐNTU).
 * - OUT_OF_POCKET: Nhân sự tự ứng tiền túi trước -> Thu hồi qua Phiếu Hoàn Tạm Ứng (ĐNHTU).
 * - VENDOR_DIRECT: Chi trả trực tiếp cho đối tác/NCC -> Thanh toán qua Phiếu Đề Nghị Thanh Toán (ĐNTT).
 * Cả ĐNHTU và ĐNTT đều có thể tạo trước; có hiệu lực thanh toán khi AC tương ứng được duyệt.
 */
export type ExpenseFundingSource = "ADVANCE" | "OUT_OF_POCKET" | "VENDOR_DIRECT";
export type Expense = {
  id: string;
  revisionId: string;
  lineId: string;
  recipientKey: string;
  description: string;
  input: CostInput;
  cost: CalculatedCost;
  invoiceId: string | null;
  paymentProofId: string | null;
  createdBy: string;
  version?: number;
  fundingSource?: ExpenseFundingSource;
  exceptionReason?: string;
  exceptionStatus?: "PENDING" | "APPROVED" | "REJECTED";
  spentAt?: string;
};
export type PurchaseOrder = { id: string; number: string; net: string; sourceId: string; poKey?: string; version?: number; parentPoId?: string; replacesPoId?: string; confirmedBy?: string; confirmedAt?: string };
export type ProjectBrief = { id: string; title: string; sourceId: string };
export type VendorPaymentMilestone = {
  id: string;
  vendorId: string;
  revisionId?: string;
  installmentNumber: number;
  title: string;
  percentage: number;
  amount: string;
  dueDate: string;
  paymentMethod: "ADVANCE" | "VENDOR_DIRECT";
  conditions?: string;
  notes?: string;
  linkedRequestId?: string;
};
export type FinanceData = {
  config: { accountantId: string; ceoId: string; managerId: string };
  closed: boolean;
  revisions: IcRevision[];
  beneficiaries: Beneficiary[];
  expenses: Expense[];
  pos: PurchaseOrder[];
  quotations?: Quotation[];
  briefs?: ProjectBrief[];
  workingRevisionId?: string;
  lineArchive?: { revisionId: string; line: IcLine }[];
  quotationDrafts?: PairedDraft[];
  evidenceSupplements?: IcEvidenceSupplement[];
  vendorPaymentMilestones?: VendorPaymentMilestone[];
};
export type CashRow = { id: string; requestId: string; recipientKey: string; direction: string; amount: string; reference: string; evidenceId: string };
export type RequestPayload = { revisionId?: string; recipientKey?: string; amount?: string; beneficiaryVersion?: number; explanation?: string; targetRequestId?: string; expenseIds?: string[]; evidenceIds?: string[]; actualGross?: string; advance?: string; additional?: string; refund?: string; reconciliation?: string; lines?: IcLine[]; beneficiary?: { name: string; bank: string; account: string }; expenseRevision?: { previousVersion: number; proposed: Expense }; resubmission?: { sourceRequestId: string; sourceAttemptId: string; response: string } };
export function emptyFinance(): FinanceData {
  return { config: { accountantId: "", ceoId: "", managerId: "" }, closed: false, revisions: [], beneficiaries: [], expenses: [], pos: [], quotations: [], briefs: [], vendorPaymentMilestones: [] };
}
