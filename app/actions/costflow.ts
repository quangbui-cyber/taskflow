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

export type CostFlowActionState = { error?: string; success?: string; requestId?: string; revisionId?: string; quotationId?: string; draftId?: string; beneficiaryId?: string; cashId?: string; idempotent?: boolean; savedScopes?: string[]; version?: number; lineErrors?: { lineId: string; message: string }[] };
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
