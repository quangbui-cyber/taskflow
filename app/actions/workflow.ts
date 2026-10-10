"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { readProjectUpload } from "@/lib/projectFiles";
import { executeWorkflow } from "@/lib/workflow/service";
import { executeFinance } from "@/lib/costflow/service";
import { dispatchWorkflowNotifications } from "@/lib/workflow/notifications";

export type WorkflowActionState = { error?: string; success?: string; requestId?: string; templateId?: string };
export async function workflowAction(_previous: WorkflowActionState, form: FormData): Promise<WorkflowActionState> {
  const user = await requireUser();
  try {
    const physicalValues = form.getAll("signedDocuments");
    if (physicalValues.length > 10) throw new Error("Mỗi batch tối đa 10 file scan.");
    const physicalBytes = physicalValues.reduce((sum, value) => sum + (value instanceof File ? value.size : 0), 0);
    if (physicalBytes > 20 * 1024 * 1024) throw new Error("Tổng dung lượng batch scan không được vượt 20 MiB.");
    const physicalUploads = (await Promise.all(physicalValues.map(value => readProjectUpload(value)))).filter((value): value is NonNullable<typeof value> => value !== null);
    const result = await executeWorkflow(user, form, await readProjectUpload(form.get("document")), physicalUploads);
    await dispatchWorkflowNotifications(result.requestId).catch(() => undefined);
    revalidatePath("/workflow");
    if (result.requestId) revalidatePath(`/workflow/${result.requestId}`);
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (["P2002", "P2034"].includes(error.code)) return { error: "Có thao tác đồng thời hoặc phiên bản đã lưu. Tải lại trang rồi thử lại." };
      return { error: "Chưa lưu được hồ sơ. Kiểm tra kết nối dữ liệu." };
    }
    return { error: error instanceof Error ? error.message : "Không thể lưu hồ sơ." };
  }
}
export async function workflowQueueAction(_previous: WorkflowActionState, form: FormData): Promise<WorkflowActionState> {
  const user = await requireUser();
  try {
    const requestModule = String(form.get("module") ?? "");
    let result: WorkflowActionState;
    if (requestModule === "WORKFLOW") {
      form.set("command", "DECIDE_DOCUMENT");
      result = await executeWorkflow(user, form, null);
    } else if (requestModule === "COSTFLOW") {
      form.set("command", "DECIDE");
      const projectId = String(form.get("projectId") ?? "");
      const expectedVersion = Number(form.get("version"));
      if (!projectId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("Hồ sơ tài chính không còn đúng phiên bản. Tải lại trang.");
      result = await executeFinance(projectId, expectedVersion, user, form, null);
    } else throw new Error("Module hồ sơ không hợp lệ.");
    await dispatchWorkflowNotifications(result.requestId).catch(() => undefined);
    revalidatePath("/workflow");
    if (requestModule === "WORKFLOW" && result.requestId) revalidatePath(`/workflow/${result.requestId}`);
    if (requestModule === "COSTFLOW") revalidatePath(`/projects/${String(form.get("projectId"))}/costflow`);
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (["P2002", "P2034"].includes(error.code)) return { error: "Có thao tác đồng thời hoặc phiên bản đã lưu. Tải lại trang rồi thử lại." };
      return { error: "Chưa lưu được quyết định. Kiểm tra kết nối dữ liệu." };
    }
    return { error: error instanceof Error ? error.message : "Không thể lưu quyết định." };
  }
}
