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
import { executeActualCostBulkDecision, executeActualCostCommand, type ActualCostBulkSelection, type ActualCostCommand } from "@/lib/costflow/actualCostService";
import { executeSettlementCommand, isSettlementCommand } from "@/lib/costflow/settlementService";
import { addSupplierBankAccount, archiveSupplierBankAccount, createSupplier, publishSupplierBankVersion, publishSupplierLegalVersion, setPrimarySupplierBankAccount, verifySupplierTuple } from "@/lib/costflow/supplierService";

export type CostFlowActionState = { error?: string; success?: string; requestId?: string; closeRequestId?: string; financialCloseState?: "OPEN" | "CLOSED"; revisionId?: string; quotationId?: string; draftId?: string; beneficiaryId?: string; cashId?: string; customerAcceptanceId?: string; customerAcceptanceVersion?: number; settlementVersion?: number; idempotent?: boolean; savedScopes?: string[]; version?: number; lineErrors?: { lineId: string; message: string }[] };

export type ActualCostActionState = { error?: string; success?: string; lineId?: string; version?: number };
export type SupplierActionState = { error?: string; success?: string; supplierId?: string; bankAccountId?: string; version?: number };

const supplierText = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

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
    if (action === "BULK_DECIDE") {
      const decision = String(form.get("decision") ?? "");
      if (decision !== "APPROVED" && decision !== "RETURNED") return { error: "Quyết định AC không hợp lệ." };
      const selections: ActualCostBulkSelection[] = form.getAll("bulkSelection").map(value => {
        const parsed = JSON.parse(String(value)) as Record<string, unknown>;
        if (typeof parsed.lineId !== "string" || !Number.isSafeInteger(parsed.version) || typeof parsed.reviewToken !== "string") throw new Error("Dòng AC được chọn không hợp lệ.");
        return { lineId: parsed.lineId, version: Number(parsed.version), reviewToken: parsed.reviewToken };
      });
      const result = await executeActualCostBulkDecision(actor, { projectId, action: decision, reason: String(form.get("reason") ?? ""), acknowledgeMissingEvidence: form.get("acknowledgeMissingEvidence") === "yes", selections });
      revalidatePath(`/projects/${projectId}/costflow`);
      return { success: `Đã ${decision === "APPROVED" ? "duyệt" : "trả lại"} ${result.count} dòng AC.` };
    }
    let command: ActualCostCommand;
    if (action === "CREATE_AND_SUBMIT") {
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
    } else if (action === "RESUBMIT") {
      command = {
        command: action,
        projectId,
        lineId: String(form.get("lineId") ?? ""),
        expectedVersion: Number(form.get("version")),
        description: String(form.get("description") ?? ""),
        fundingSource: String(form.get("fundingSource") ?? ""),
        quantity: String(form.get("quantity") ?? ""),
        days: String(form.get("days") ?? ""),
        unitPrice: String(form.get("unitPrice") ?? ""),
      };
    } else if (action === "DECIDE") {
      const decision = String(form.get("decision") ?? "");
      if (decision !== "APPROVED" && decision !== "RETURNED") return { error: "Quyết định AC không hợp lệ." };
      command = {
        command: action,
        projectId,
        lineId: String(form.get("lineId") ?? ""),
        version: Number(form.get("version")),
        action: decision,
        reason: String(form.get("reason") ?? ""),
        reviewToken: String(form.get("reviewToken") ?? ""),
        acknowledgeMissingEvidence: form.get("acknowledgeMissingEvidence") === "yes",
      };
    } else {
      return { error: "Thao tác AC không hợp lệ." };
    }
    const result = await executeActualCostCommand(actor, command);
    revalidatePath(`/projects/${projectId}/costflow`);
    return { success: action === "DECIDE" ? "Đã lưu quyết định AC." : "AC đã được gửi DD.", lineId: result.lineId, version: result.version };
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
