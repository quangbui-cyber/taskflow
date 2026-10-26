"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { confirmExcelIntake, confirmRoundTripMerge, rebuildRoundTripExcelIntakePreview, ExcelIntakeStaleDraftError, type ConfirmExcelIntakeCommand, type ConfirmExcelIntakeResult, type ConfirmRoundTripMergeCommand, type ConfirmRoundTripMergeResult } from "@/lib/costflow/excelIntakeService";
import { publicPaymentErrorMessage } from "@/lib/costflow/paymentPolicy";

export async function confirmExcelIntakeAction(command: ConfirmExcelIntakeCommand): Promise<ConfirmExcelIntakeResult | { error: string }> {
  const actor = await requireUser();
  try {
    const result = await confirmExcelIntake(actor, command);
    revalidatePath(`/projects/${command.projectId}/costflow`);
    return { draftId: result.draftId, version: result.version, idempotent: result.idempotent };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { error: "Có thao tác đồng thời. Tải lại rồi thử lại." };
    return { error: publicPaymentErrorMessage(error) };
  }
}

export async function confirmRoundTripMergeAction(command: ConfirmRoundTripMergeCommand): Promise<ConfirmRoundTripMergeResult | { error: string; code?: "STALE_DRAFT" }> {
  const actor = await requireUser();
  try {
    const result = await confirmRoundTripMerge(actor, command);
    revalidatePath(`/projects/${command.projectId}/costflow`);
    return result;
  } catch (error) {
    if (error instanceof ExcelIntakeStaleDraftError) return { error: error.message, code: error.code };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { error: "Có thao tác đồng thời. Tải lại và xuất workbook mới trước khi thử lại." };
    return { error: publicPaymentErrorMessage(error) };
  }
}

export async function rebuildRoundTripPreviewAction(command: { projectId: string; draftId: string; previewSessionId: string }) {
  const actor = await requireUser();
  try { return await rebuildRoundTripExcelIntakePreview(actor, command); }
  catch (error) { return { error: publicPaymentErrorMessage(error) }; }
}
