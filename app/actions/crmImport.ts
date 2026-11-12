"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CRM_DISABLED_MESSAGE } from "@/lib/features";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { resolveImportRow, applyImportRun, type ResolveImportInput } from "@/lib/crm/trackerApply";

export async function resolveImportRowAction(raw: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  const actor = { ...await loadCrmActor(user), name: user.name };
  if (!crmCan(actor, "REVIEW_IMPORT")) return { error: "Bạn không có quyền rà dữ liệu nhập." };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Dữ liệu ánh xạ không hợp lệ." };
  try {
    const result = await resolveImportRow(prisma, actor, raw as ResolveImportInput);
    if (!("ok" in result)) return { error: result.error };
    revalidatePath("/admin/crm-data");
    return { success: "Đã cập nhật dòng nhập." };
  } catch { return { error: "Không lưu được dòng nhập. Vui lòng thử lại." }; }
}

export async function applyImportRunAction(runId: unknown) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) return { error: CRM_DISABLED_MESSAGE };
  const actor = { ...await loadCrmActor(user), name: user.name };
  if (!crmCan(actor, "REVIEW_IMPORT")) return { error: "Bạn không có quyền rà dữ liệu nhập." };
  if (typeof runId !== "string") return { error: "Lượt nhập không hợp lệ." };
  try {
    const result = await applyImportRun(prisma, actor, runId);
    if (!("ok" in result)) return { error: result.error };
    const failed = result.errors.length ? await prisma.trackerImportRow.findMany({ where: { runId, id: { in: result.errors.map((e) => e.rowId) } }, select: { id: true, sheet: true, rowNumber: true } }) : [];
    revalidatePath("/admin/crm-data"); revalidatePath("/crm/clients"); revalidatePath("/crm/clients/[id]", "page"); revalidatePath("/crm/opportunities"); revalidatePath("/crm");
    return { success: `Đã nhập ${result.applied} dòng.`, errors: result.errors.map((e) => { const row = failed.find((r) => r.id === e.rowId); return { ...e, label: row ? `${row.sheet} · dòng ${row.rowNumber}` : "Dòng nhập" }; }) };
  } catch { return { error: "Không hoàn tất lượt nhập. Các dòng đã nhập được giữ lại; hãy thử lại." }; }
}
