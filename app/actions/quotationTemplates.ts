"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { proposeQuotationTemplate, reviewQuotationTemplateProposal, setQuotationTemplateArchived } from "@/lib/costflow/quotationReuse";

export type QuotationTemplateActionState = { error?: string; success?: string };

export async function proposeQuotationTemplateAction(_previous: QuotationTemplateActionState, form: FormData): Promise<QuotationTemplateActionState> {
  const actor = await requireUser();
  try {
    await proposeQuotationTemplate(actor, String(form.get("projectId") ?? ""), String(form.get("quotationId") ?? ""), String(form.get("proposedName") ?? ""), String(form.get("note") ?? ""));
    revalidatePath(`/projects/${String(form.get("projectId"))}/costflow`);
    revalidatePath("/admin");
    return { success: "Đã gửi đề xuất template cho Admin." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Không gửi được đề xuất template." };
  }
}

export async function quotationTemplateAdminAction(_previous: QuotationTemplateActionState, form: FormData): Promise<QuotationTemplateActionState> {
  const actor = await requireUser();
  try {
    const command = String(form.get("command") ?? "");
    if (command === "APPROVE" || command === "REJECT") {
      await reviewQuotationTemplateProposal(actor, String(form.get("proposalId") ?? ""), command, String(form.get("reason") ?? ""));
    } else if (command === "ARCHIVE" || command === "RESTORE") {
      await setQuotationTemplateArchived(actor, String(form.get("templateId") ?? ""), command === "ARCHIVE");
    } else throw new Error("Thao tác template không hợp lệ.");
    revalidatePath("/admin");
    return { success: command === "APPROVE" ? "Đã công bố template." : command === "REJECT" ? "Đã từ chối đề xuất." : command === "ARCHIVE" ? "Đã lưu trữ template." : "Đã khôi phục template." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Không cập nhật được template." };
  }
}
