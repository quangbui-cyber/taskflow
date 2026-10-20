"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { readProjectUpload } from "@/lib/projectFiles";
import { IcEvidenceError } from "@/lib/costflow/icEvidence";
import { assertCostFlowMutationAllowed, executeFinance } from "@/lib/costflow/service";
import { executePaymentCash } from "@/lib/costflow/paymentCash";
import { publicPaymentErrorMessage } from "@/lib/costflow/paymentPolicy";
import { dispatchWorkflowNotifications } from "@/lib/workflow/notifications";
import { executeActualCostCommand, type ActualCostCommand } from "@/lib/costflow/actualCostService";
import { ACTUAL_COST_FUNDING_SOURCES, ACTUAL_COST_INTERNAL_STATUSES, type ActualCostFundingAllocation, type ActualCostInternalStatus } from "@/lib/costflow/actualCost";
import { executeSettlementCommand, isSettlementCommand } from "@/lib/costflow/settlementService";
import { addSupplierBankAccount, archiveSupplierBankAccount, createSupplier, publishSupplierBankVersion, publishSupplierLegalVersion, setPrimarySupplierBankAccount, verifySupplierTuple } from "@/lib/costflow/supplierService";
import { createVendorPaymentDossier } from "@/lib/costflow/vendorPaymentService";

export type CostFlowActionState = { error?: string; success?: string; requestId?: string; closeRequestId?: string; financialCloseState?: "OPEN" | "CLOSED"; revisionId?: string; quotationId?: string; draftId?: string; beneficiaryId?: string; cashId?: string; customerAcceptanceId?: string; customerAcceptanceVersion?: number; settlementVersion?: number; idempotent?: boolean; savedScopes?: string[]; version?: number; lineErrors?: { lineId: string; message: string }[] };

export type ActualCostActionState = { error?: string; success?: string; lineId?: string; version?: number };
export type SupplierActionState = { error?: string; success?: string; supplierId?: string; bankAccountId?: string; version?: number };
export type VendorPaymentActionState = { error?: string; success?: string; requestId?: string; invoiceId?: string; idempotent?: boolean };

const supplierText = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function actualCostStatus(value: FormDataEntryValue | null, fallback?: ActualCostInternalStatus): ActualCostInternalStatus | undefined {
  return ACTUAL_COST_INTERNAL_STATUSES.find(status => status === value) ?? fallback;
}

function actualCostAllocations(value: FormDataEntryValue | null): ActualCostFundingAllocation[] | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("Phân bổ nguồn tiền không hợp lệ."); }
  if (!Array.isArray(parsed) || parsed.length > 20 || parsed.some(item =>
    !item || typeof item !== "object" || Array.isArray(item)
      || !ACTUAL_COST_FUNDING_SOURCES.includes(item.source)
      || typeof item.amount !== "string"
      || (item.note !== undefined && typeof item.note !== "string")
  )) throw new Error("Phân bổ nguồn tiền không hợp lệ.");
  return parsed as ActualCostFundingAllocation[];
}

async function readVendorInvoiceUpload(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > 4 * 1024 * 1024) throw new Error("File hóa đơn phải nhỏ hơn 4 MB.");
  return { name: value.name, mimeType: value.type, size: value.size, data: new Uint8Array(await value.arrayBuffer()) };
}

export async function vendorPaymentAction(_previous: VendorPaymentActionState, form: FormData): Promise<VendorPaymentActionState> {
  const actor = await requireUser();
  const projectId = supplierText(form, "projectId");
  try {
    const parsed = JSON.parse(supplierText(form, "acSelections") || "[]") as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) throw new Error("Danh sách AC không hợp lệ.");
    const files = (await Promise.all([readVendorInvoiceUpload(form.get("invoiceXml")), readVendorInvoiceUpload(form.get("invoicePdf"))])).filter((file): file is NonNullable<typeof file> => !!file);
    const result = await createVendorPaymentDossier(actor, {
      projectId,
      title: supplierText(form, "title"),
      recipientKey: supplierText(form, "recipientKey"),
      invoice: { invoiceNumber: supplierText(form, "invoiceNumber"), symbol: supplierText(form, "symbol"), issuedAt: supplierText(form, "issuedAt"), sellerTaxCode: supplierText(form, "sellerTaxCode"), netAmount: supplierText(form, "netAmount"), vatAmount: supplierText(form, "vatAmount"), grossAmount: supplierText(form, "grossAmount") },
      files,
      selections: parsed.map(item => ({ stableLineId: String(item.stableLineId ?? ""), versionId: String(item.versionId ?? ""), approvalId: String(item.approvalId ?? ""), approvalAttemptId: String(item.approvalAttemptId ?? ""), amount: String(item.amount ?? "") })),
      idempotencyKey: supplierText(form, "idempotencyKey"),
      signatureData: form.get("signatureData"),
      signaturePin: form.get("signaturePin"),
    });
    revalidatePath(`/projects/${projectId}/costflow`);
    revalidatePath("/workflow");
    return { success: result.idempotent ? "Hồ sơ ĐNTT đã tồn tại." : "Đã trình ĐNTT sau AC.", ...result };
  } catch (error) {
    return { error: publicPaymentErrorMessage(error) };
  }
}

export async function supplierAction(_previous: SupplierActionState, form: FormData): Promise<SupplierActionState> {
  const actor = await requireUser();
  const command = supplierText(form, "supplierCommand");
  const legal = { legalName: supplierText(form, "legalName"), taxCode: supplierText(form, "taxCode"), address: supplierText(form, "address"), contactName: supplierText(form, "contactName"), contactEmail: supplierText(form, "contactEmail"), contactPhone: supplierText(form, "contactPhone") };
  const bank = { bankName: supplierText(form, "bankName"), bankCode: supplierText(form, "bankCode"), accountHolder: supplierText(form, "accountHolder"), accountNumber: supplierText(form, "accountNumber") };
  try {
    let result: { supplierId: string; bankAccountId?: string; version?: number };
    if (command === "CREATE") result = await createSupplier(actor, { ...legal, ...bank });
    else if (command === "UPDATE_LEGAL") result = await publishSupplierLegalVersion(actor, { ...legal, supplierId: supplierText(form, "supplierId"), expectedVersion: Number(form.get("expectedVersion")), reason: supplierText(form, "reason") });
    else if (command === "ADD_BANK") result = await addSupplierBankAccount(actor, { ...bank, supplierId: supplierText(form, "supplierId"), makePrimary: form.get("makePrimary") === "yes", reason: supplierText(form, "reason") });
    else if (command === "UPDATE_BANK") result = await publishSupplierBankVersion(actor, { ...bank, supplierId: supplierText(form, "supplierId"), bankAccountId: supplierText(form, "bankAccountId"), expectedVersion: Number(form.get("expectedVersion")), reason: supplierText(form, "reason") });
    else if (command === "SET_PRIMARY") result = await setPrimarySupplierBankAccount(actor, { supplierId: supplierText(form, "supplierId"), bankAccountId: supplierText(form, "bankAccountId") });
    else if (command === "ARCHIVE_BANK") result = await archiveSupplierBankAccount(actor, { supplierId: supplierText(form, "supplierId"), bankAccountId: supplierText(form, "bankAccountId"), reason: supplierText(form, "reason") });
    else if (command === "VERIFY") {
      const proof = await readProjectUpload(form.get("proof"));
      result = await verifySupplierTuple(actor, { projectId: supplierText(form, "projectId"), supplierId: supplierText(form, "supplierId"), supplierVersionId: supplierText(form, "supplierVersionId"), bankAccountId: supplierText(form, "bankAccountId"), bankAccountVersionId: supplierText(form, "bankAccountVersionId"), decision: supplierText(form, "decision") === "REJECTED" ? "REJECTED" : "VERIFIED", reason: supplierText(form, "reason"), proof: proof ?? undefined });
    } else return { error: "Thao tác NCC không hợp lệ." };
    revalidatePath("/suppliers");
    const projectId = supplierText(form, "projectId");
    if (projectId) revalidatePath(`/projects/${projectId}/costflow`);
    return { success: command === "VERIFY" ? "Đã lưu xác minh NCC." : "Đã cập nhật danh bạ NCC.", supplierId: result.supplierId, bankAccountId: result.bankAccountId, version: result.version };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "Mã số thuế hoặc tài khoản NCC đã tồn tại." };
    return { error: publicPaymentErrorMessage(error) };
  }
}

export async function actualCostAction(_previous: ActualCostActionState, form: FormData): Promise<ActualCostActionState> {
  const actor = await requireUser();
  const projectId = String(form.get("projectId") ?? "").trim();
  const action = String(form.get("actualCostCommand") ?? "").trim();
  if (!projectId) return { error: "Thiếu Project." };
  try {
    await assertCostFlowMutationAllowed(projectId, action);
    if (["CREATE_AND_SUBMIT", "RESUBMIT", "DECIDE", "BULK_DECIDE"].includes(action)) {
      return { error: "Bảng AC chỉ được gửi, duyệt hoặc trả lại toàn bộ; thao tác theo từng dòng đã ngừng sử dụng." };
    }
    let command: ActualCostCommand;
    if (action === "CREATE_SUCCESSOR") {
      command = {
        command: action,
        projectId,
        revisionId: String(form.get("sheetRevisionId") ?? ""),
        expectedMutationVersion: Number(form.get("sheetMutationVersion")),
      };
    } else if (action === "CREATE_AND_SUBMIT") {
      command = {
        command: action,
        projectId,
        stableLineId: String(form.get("stableLineId") ?? ""),
        sourceKind: String(form.get("sourceKind") ?? "IC_LINKED") === "UNBUDGETED" ? "UNBUDGETED" : "IC_LINKED",
        revisionId: String(form.get("revisionId") ?? ""),
        icLineId: String(form.get("icLineId") ?? ""),
        recipientKey: String(form.get("recipientKey") ?? ""),
        description: String(form.get("description") ?? ""),
        reason: String(form.get("reason") ?? ""),
        fundingSource: String(form.get("fundingSource") ?? ""),
        quantity: String(form.get("quantity") ?? ""),
        days: String(form.get("days") ?? ""),
        unitPrice: String(form.get("unitPrice") ?? ""),
        unit: String(form.get("unit") ?? ""),
        basis: String(form.get("basis") ?? "GROSS") === "NET" ? "NET" : "GROSS",
        vatPercent: String(form.get("vatPercent") ?? "0"),
        evidenceIds: form.getAll("evidenceIds").map(String),
        billable: form.get("billable") === "true",
        saleQuantity: String(form.get("saleQuantity") ?? ""),
        saleDays: String(form.get("saleDays") ?? ""),
        saleUnitPrice: String(form.get("saleUnitPrice") ?? ""),
      };
    } else if (action === "SAVE_LINES") {
      const raw = String(form.get("lines") ?? "");
      if (raw.length > 50000) return { error: "Dữ liệu dán quá lớn. Hãy chia thành các nhóm tối đa 100 khoản." };
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return { error: "Dữ liệu dán không hợp lệ. Hãy kiểm tra lại bảng xem trước." }; }
      if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 100 || parsed.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
        return { error: "Mỗi lần chỉ dán từ 1 đến 100 khoản thực chi hợp lệ." };
      }
      const lines: Extract<ActualCostCommand, { command: "SAVE_LINES" }>["lines"] = parsed.map((item: Record<string, unknown>) => ({
        sourceKind: item.sourceKind === "UNBUDGETED" ? "UNBUDGETED" : "IC_LINKED",
        icLineId: String(item.icLineId ?? ""),
        recipientKey: String(item.recipientKey ?? ""),
        description: String(item.description ?? ""),
        reason: String(item.reason ?? ""),
        fundingSource: String(item.fundingSource ?? "EMPLOYEE_OUT_OF_POCKET"),
        quantity: String(item.quantity ?? ""),
        days: String(item.days ?? ""),
        unitPrice: String(item.unitPrice ?? ""),
        unit: String(item.unit ?? ""),
        basis: item.basis === "NET" ? "NET" : "GROSS",
        vatPercent: String(item.vatPercent ?? "0"),
        billable: false,
        evidenceIds: [],
      }));
      command = {
        command: action,
        projectId,
        revisionId: String(form.get("revisionId") ?? ""),
        sheetRevisionId: String(form.get("sheetRevisionId") ?? "").trim() || undefined,
        expectedMutationVersion: form.get("sheetMutationVersion") === null ? undefined : Number(form.get("sheetMutationVersion")),
        lines,
      };
    } else if (action === "SAVE_LINE") {
      const fundingAllocations = actualCostAllocations(form.get("fundingAllocations"));
      command = {
        command: action,
        projectId,
        lineId: String(form.get("lineId") ?? "").trim() || undefined,
        sourceKind: String(form.get("sourceKind") ?? "IC_LINKED") === "UNBUDGETED" ? "UNBUDGETED" : "IC_LINKED",
        revisionId: String(form.get("revisionId") ?? ""),
        icLineId: String(form.get("icLineId") ?? ""),
        recipientKey: String(form.get("recipientKey") ?? ""),
        description: String(form.get("description") ?? ""),
        reason: String(form.get("reason") ?? ""),
        fundingSource: String(form.get("fundingSource") ?? "EMPLOYEE_OUT_OF_POCKET"),
        fundingAllocations,
        quantity: String(form.get("quantity") ?? "1"),
        days: String(form.get("days") ?? "1"),
        unitPrice: String(form.get("unitPrice") ?? "0"),
        unit: String(form.get("unit") ?? ""),
        basis: String(form.get("basis") ?? "GROSS") === "NET" ? "NET" : "GROSS",
        vatPercent: String(form.get("vatPercent") ?? "0"),
        evidenceIds: form.getAll("evidenceIds").map(String),
        billable: form.get("billable") === "true",
        saleQuantity: String(form.get("saleQuantity") ?? ""),
        saleDays: String(form.get("saleDays") ?? ""),
        saleUnitPrice: String(form.get("saleUnitPrice") ?? ""),
        internalStatus: actualCostStatus(form.get("internalStatus")),
        accountNote: String(form.get("accountNote") ?? "").trim() || undefined,
        sheetRevisionId: String(form.get("sheetRevisionId") ?? "").trim() || undefined,
        expectedMutationVersion: form.get("sheetMutationVersion") === null ? undefined : Number(form.get("sheetMutationVersion")),
      };
    } else if (action === "DELETE_LINE") {
      command = {
        command: action,
        projectId,
        lineId: String(form.get("lineId") ?? ""),
        revisionId: String(form.get("sheetRevisionId") ?? ""),
        expectedMutationVersion: Number(form.get("sheetMutationVersion")),
        restore: form.get("restore") === "true",
      };
    } else if (action === "UPDATE_LINE_STATUS") {
      command = {
        command: action,
        projectId,
        lineId: String(form.get("lineId") ?? ""),
        internalStatus: actualCostStatus(form.get("internalStatus"), "PENDING_ACCOUNT_REVIEW")!,
        accountNote: String(form.get("accountNote") ?? "").trim() || undefined,
        revisionId: String(form.get("sheetRevisionId") ?? ""),
        expectedMutationVersion: Number(form.get("sheetMutationVersion")),
      };
    } else if (action === "UPDATE_LINES_STATUS") {
      command = {
        command: action,
        projectId,
        lineIds: form.getAll("lineId").map(String),
        internalStatus: actualCostStatus(form.get("internalStatus"), "ACCOUNT_REVIEWED")!,
        revisionId: String(form.get("sheetRevisionId") ?? ""),
        expectedMutationVersion: Number(form.get("sheetMutationVersion")),
      };
    } else if (action === "SUBMIT_SHEET") {
      command = {
        command: action,
        projectId,
        note: String(form.get("note") ?? ""),
        missingEvidenceExplanation: String(form.get("missingEvidenceExplanation") ?? ""),
        overBudgetExplanation: String(form.get("overBudgetExplanation") ?? ""),
        revisionId: String(form.get("sheetRevisionId") ?? ""),
        expectedMutationVersion: Number(form.get("sheetMutationVersion")),
      };
    } else if (action === "DECIDE_SHEET") {
      const decision = String(form.get("decision") ?? "");
      if (decision !== "APPROVED" && decision !== "RETURNED") return { error: "Quyết định AC không hợp lệ." };
      let lineNotes: Record<string, string> | undefined = undefined;
      const rawNotes = form.get("lineNotes");
      if (rawNotes && typeof rawNotes === "string") {
        try { lineNotes = JSON.parse(rawNotes); } catch {}
      }
      command = {
        command: action,
        projectId,
        action: decision,
        reason: String(form.get("reason") ?? ""),
        lineNotes,
        acknowledgeMissingEvidence: form.get("acknowledgeMissingEvidence") === "yes" || form.get("acknowledgeMissingEvidence") === "true",
        revisionId: String(form.get("sheetRevisionId") ?? ""),
        manifestHash: String(form.get("manifestHash") ?? ""),
        expectedMutationVersion: Number(form.get("sheetMutationVersion")),
      };
    } else {
      return { error: "Thao tác AC không hợp lệ." };
    }
    const result = await executeActualCostCommand(actor, command);
    revalidatePath(`/projects/${projectId}/costflow`);
    revalidatePath("/workflow");
    return {
      success: result.success ?? "Đã cập nhật Bảng AC.",
      lineId: result.lineId,
      version: result.version,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return { error: "Dòng, phiên bản hoặc quyết định AC đã tồn tại." };
      if (error.code === "P2034") return { error: "Có thao tác AC đồng thời. Tải lại rồi thử lại." };
    }
    return { error: publicPaymentErrorMessage(error) };
  }
}

export async function costFlowAction(_previous: CostFlowActionState, form: FormData): Promise<CostFlowActionState> {
  const actor = await requireUser();
  const projectId = String(form.get("projectId") ?? "").trim();
  const command = String(form.get("command") ?? "").trim();
  if (!projectId) return { error: "Thiếu Project." };
  try {
    await assertCostFlowMutationAllowed(projectId, command);
  } catch (error) {
    return { error: publicPaymentErrorMessage(error) };
  }
  if (isSettlementCommand(command)) {
    try {
      const upload = await readProjectUpload(form.get("proof"));
      const result = await executeSettlementCommand(actor, form, upload);
      await dispatchWorkflowNotifications(result.requestId).catch(() => undefined);
      revalidatePath(`/projects/${projectId}/costflow`);
      revalidatePath("/workflow");
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") return { error: "Nguồn, phiên bản hoặc khóa quyết toán đã được sử dụng." };
        if (error.code === "P2034") return { error: "Có thao tác quyết toán đồng thời. Tải lại rồi thử lại." };
      }
      return { error: publicPaymentErrorMessage(error) };
    }
  }
  const version = Number(form.get("version"));
  if (!Number.isSafeInteger(version) || version < 0) return { error: "Phiên bản hồ sơ không hợp lệ." };
  try {
    const upload = await readProjectUpload(form.get("proof"));
    const result = ["CASH", "SETTLEMENT_CASH"].includes(String(form.get("command") ?? ""))
      ? await executePaymentCash(projectId, version, actor, form, upload)
      : await executeFinance(projectId, version, actor, form, upload);
    await dispatchWorkflowNotifications(result.requestId).catch(() => undefined);
    revalidatePath(`/projects/${projectId}/costflow`);
    revalidatePath("/workflow");
    return result;
  } catch (error) {
    if (error instanceof IcEvidenceError) return { error: publicPaymentErrorMessage(error), lineErrors: error.lineErrors.map(item => ({ ...item, message: publicPaymentErrorMessage(new Error(item.message)) })) };
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return { error: command === "REQUEST_REOPEN_PROJECT" ? "Project đang có một vòng sửa quyết toán chưa kết thúc." : "Mã giao dịch hoặc phiên bản đã tồn tại. Không ghi tiền hai lần." };
      if (error.code === "P2034") return { error: "Có thao tác đồng thời. Tải lại trang rồi thử lại." };
      return { error: "Chưa lưu được hồ sơ. Kiểm tra kết nối dữ liệu." };
    }
    return { error: publicPaymentErrorMessage(error) };
  }
}
