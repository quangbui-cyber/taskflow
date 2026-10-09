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
import { executeActualCostCommand, type ActualCostCommand } from "@/lib/costflow/actualCostService";

export type CostFlowActionState = { error?: string; success?: string; requestId?: string; revisionId?: string; quotationId?: string; draftId?: string; beneficiaryId?: string; cashId?: string; idempotent?: boolean; savedScopes?: string[]; version?: number; lineErrors?: { lineId: string; message: string }[] };

export type ActualCostActionState = { error?: string; success?: string; lineId?: string; version?: number };

export async function actualCostAction(_previous: ActualCostActionState, form: FormData): Promise<ActualCostActionState> {
  const actor = await requireUser();
  const projectId = String(form.get("projectId") ?? "").trim();
  const action = String(form.get("actualCostCommand") ?? "").trim();
  if (!projectId) return { error: "Thiếu Project." };
  try {
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
  const projectId = String(form.get("projectId") ?? "");
  const version = Number(form.get("version"));
  if (!projectId || !Number.isSafeInteger(version) || version < 0) return { error: "Phiên bản hồ sơ không hợp lệ." };
  try {
    const upload = await readProjectUpload(form.get("proof"));
    const result = String(form.get("command") ?? "") === "CASH"
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
