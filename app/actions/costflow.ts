"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { readProjectUpload } from "@/lib/projectFiles";
import { IcEvidenceError } from "@/lib/costflow/icEvidence";
import { executeFinance } from "@/lib/costflow/service";
import { executePaymentCash } from "@/lib/costflow/paymentCash";
import { publicPaymentErrorMessage } from "@/lib/costflow/paymentPolicy";
import { dispatchWorkflowNotifications } from "@/lib/workflow/notifications";
import { executeActualCostBulkDecision, executeActualCostCommand, type ActualCostBulkSelection, type ActualCostCommand } from "@/lib/costflow/actualCostService";
import { executeSettlementCommand, isSettlementCommand } from "@/lib/costflow/settlementService";

export type CostFlowActionState = { error?: string; success?: string; requestId?: string; revisionId?: string; quotationId?: string; draftId?: string; beneficiaryId?: string; cashId?: string; customerAcceptanceId?: string; customerAcceptanceVersion?: number; settlementVersion?: number; idempotent?: boolean; savedScopes?: string[]; version?: number; lineErrors?: { lineId: string; message: string }[] };

export type ActualCostActionState = { error?: string; success?: string; lineId?: string; version?: number };

export async function actualCostAction(_previous: ActualCostActionState, form: FormData): Promise<ActualCostActionState> {
  const actor = await requireUser();
  const projectId = String(form.get("projectId") ?? "").trim();
  const action = String(form.get("actualCostCommand") ?? "").trim();
  if (!projectId) return { error: "Thiếu Project." };
  try {
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
      if (error.code === "P2002") return { error: "Mã giao dịch hoặc phiên bản đã tồn tại. Không ghi tiền hai lần." };
      if (error.code === "P2034") return { error: "Có thao tác đồng thời. Tải lại trang rồi thử lại." };
      return { error: "Chưa lưu được hồ sơ. Kiểm tra kết nối dữ liệu." };
    }
    return { error: publicPaymentErrorMessage(error) };
  }
}
