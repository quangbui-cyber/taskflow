"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { roundVnd } from "@/lib/financeCalc";
import { newFinanceMessageId, queueFinanceApprovalEmail } from "@/lib/financeApprovalMail";
import {
  canDecideFinanceSheet,
  canEditFinanceSheet,
  canSubmitIcStatus,
  canWithdrawFinanceSheet,
  readApprovalNote,
  readCcUserIds,
} from "@/lib/financePolicy";
import { findFinanceProject } from "@/lib/financeSheet";
import { notify } from "@/lib/notify";

export type FinanceApprovalState = { error?: string; success?: string };

type Viewer = { id: string; name: string; role: string };

const STALE = "IC vừa được người khác cập nhật. Hãy tải lại trang.";

/** Dự án + IC đang dùng, kèm những gì luồng duyệt cần. */
async function loadApprovalContext(projectId: string, sheetId: string, viewer: Viewer) {
  const project = await findFinanceProject(String(projectId), viewer);
  if (!project) return null;
  const [details, sheet] = await Promise.all([
    prisma.project.findUnique({
      where: { id: project.id },
      select: {
        icApproverId: true,
        icApprover: { select: { id: true, name: true, isActive: true, deletedAt: true } },
      },
    }),
    prisma.financeSheet.findFirst({
      where: { id: String(sheetId), projectId: project.id, superseded: false },
      select: {
        id: true,
        version: true,
        icStatus: true,
        sellVatRate: true,
        sellSubtotal: true,
        icCostSubtotal: true,
        icSubmittedById: true,
        icSubmittedBy: { select: { name: true } },
        icCcUserIds: true,
        icEmailMessageId: true,
        clientName: true,
      },
    }),
  ]);
  if (!details || !sheet) return null;
  return { project, approver: details.icApprover, icApproverId: details.icApproverId, sheet };
}

type Context = NonNullable<Awaited<ReturnType<typeof loadApprovalContext>>>;

function sellNumbers(sheet: Context["sheet"]) {
  const subtotal = Number(sheet.sellSubtotal.toString());
  const cost = Number(sheet.icCostSubtotal.toString());
  const gross = subtotal + roundVnd(subtotal * Number(sheet.sellVatRate.toString()));
  const profit = subtotal - cost;
  return { cost, gross, profit, margin: subtotal > 0 ? profit / subtotal : null };
}

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/revenue");
}

/** Gửi IC cho người duyệt; email tới người duyệt, CC người liên quan. */
export async function submitFinanceSheet(
  projectId: string,
  sheetId: string,
  input: { ccUserIds: unknown; message: unknown },
): Promise<FinanceApprovalState> {
  const user = await requireUser();
  if (!canEditFinanceSheet(user.role)) return { error: "Chỉ Admin hoặc Account được gửi duyệt IC." };
  const context = await loadApprovalContext(projectId, sheetId, user);
  if (!context) return { error: "Không tìm thấy IC của dự án này." };
  const { project, approver, sheet } = context;
  if (!approver || !approver.isActive || approver.deletedAt) {
    return { error: "Dự án chưa có người duyệt IC đang hoạt động. Vào \"Sửa\" dự án để chọn người duyệt." };
  }
  if (!canSubmitIcStatus(sheet.icStatus)) return { error: "IC đang chờ duyệt hoặc đã duyệt." };
  const lineCount = await prisma.sellLine.count({ where: { section: { sheetId: sheet.id } } });
  if (lineCount === 0) return { error: "IC chưa có hạng mục nào." };

  const message = readApprovalNote(input.message);
  if (message && typeof message === "object") return message;
  const ccIds = readCcUserIds(input.ccUserIds, approver.id);
  if (!Array.isArray(ccIds)) return ccIds;
  if (ccIds.length) {
    const found = await prisma.user.count({
      where: { id: { in: ccIds }, isActive: true, deletedAt: null },
    });
    if (found !== ccIds.length) return { error: "Có người trong danh sách CC không còn hoạt động." };
  }

  const messageId = newFinanceMessageId(sheet.id);
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.financeSheet.updateMany({
      where: { id: sheet.id, icStatus: { in: ["DRAFT", "REJECTED"] } },
      data: {
        icStatus: "SUBMITTED",
        icSubmittedAt: new Date(),
        icSubmittedById: user.id,
        icApprovedAt: null,
        icApprovedById: null,
        icRejectReason: null,
        icCcUserIds: ccIds,
        icEmailMessageId: messageId,
      },
    });
    if (updated.count === 0) return false;
    await tx.financeApprovalEvent.create({
      data: { sheetId: sheet.id, action: "SUBMIT", actorId: user.id, note: message },
    });
    return true;
  });
  if (!saved) return { error: STALE };

  // Tự gửi cho chính mình duyệt thì không cần báo trong app.
  if (approver.id !== user.id) {
    await notify([approver.id], {
      type: "FINANCE_APPROVAL_REQUEST",
      message: `${user.name} gửi IC v${sheet.version} của dự án "${project.name}" cần bạn duyệt.`,
      projectId: project.id,
    });
  }
  const numbers = sellNumbers(sheet);
  queueFinanceApprovalEmail({
    projectId: project.id,
    toIds: [approver.id],
    // Người gửi cũng nằm trong CC để theo dõi cùng luồng thư.
    ccIds: [...ccIds, user.id],
    replyToId: user.id,
    messageId,
    event: {
      kind: "SUBMITTED",
      projectName: project.name,
      clientName: sheet.clientName,
      version: sheet.version,
      submitterName: user.name,
      actorName: user.name,
      message,
      reason: null,
      selfApproval: false,
      costSubtotal: numbers.cost,
      sell: { gross: numbers.gross, profit: numbers.profit, margin: numbers.margin },
    },
  });
  refresh(project.id);
  return { success: `Đã gửi IC cho ${approver.name} duyệt.` };
}

/** Duyệt IC: khoá IC và cập nhật doanh thu dự án bằng tổng báo giá gồm VAT. */
export async function approveFinanceSheet(
  projectId: string,
  sheetId: string,
): Promise<FinanceApprovalState> {
  const user = await requireUser();
  const context = await loadApprovalContext(projectId, sheetId, user);
  if (!context) return { error: "Không tìm thấy IC của dự án này." };
  const { project, sheet, icApproverId } = context;
  if (!canDecideFinanceSheet(user, icApproverId)) {
    return { error: "Chỉ người duyệt IC của dự án hoặc Admin được duyệt." };
  }
  if (sheet.icStatus !== "SUBMITTED") return { error: "IC không ở trạng thái chờ duyệt." };

  const numbers = sellNumbers(sheet);
  const selfApproval = sheet.icSubmittedById === user.id;
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.financeSheet.updateMany({
      where: { id: sheet.id, icStatus: "SUBMITTED" },
      data: { icStatus: "APPROVED", icApprovedAt: new Date(), icApprovedById: user.id },
    });
    if (updated.count === 0) return false;
    await tx.project.update({ where: { id: project.id }, data: { revenue: numbers.gross } });
    await tx.financeApprovalEvent.create({
      data: { sheetId: sheet.id, action: "APPROVE", actorId: user.id, selfApproval },
    });
    return true;
  });
  if (!saved) return { error: STALE };

  await notifyDecision(context, user, "APPROVED", null, selfApproval);
  refresh(project.id);
  return {
    success: selfApproval
      ? "Đã duyệt IC. Lưu ý: bạn vừa duyệt IC do chính bạn gửi — đã ghi vào lịch sử."
      : "Đã duyệt IC. Doanh thu dự án đã được cập nhật.",
  };
}

/** Từ chối IC: bắt buộc ghi lý do, IC về lại bản nháp để sửa. */
export async function rejectFinanceSheet(
  projectId: string,
  sheetId: string,
  reasonInput: unknown,
): Promise<FinanceApprovalState> {
  const user = await requireUser();
  const reason = readApprovalNote(reasonInput);
  if (!reason) return { error: "Hãy ghi lý do từ chối." };
  if (typeof reason === "object") return reason;
  const context = await loadApprovalContext(projectId, sheetId, user);
  if (!context) return { error: "Không tìm thấy IC của dự án này." };
  const { project, sheet, icApproverId } = context;
  if (!canDecideFinanceSheet(user, icApproverId)) {
    return { error: "Chỉ người duyệt IC của dự án hoặc Admin được từ chối." };
  }
  if (sheet.icStatus !== "SUBMITTED") return { error: "IC không ở trạng thái chờ duyệt." };

  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.financeSheet.updateMany({
      where: { id: sheet.id, icStatus: "SUBMITTED" },
      data: { icStatus: "REJECTED", icRejectReason: reason },
    });
    if (updated.count === 0) return false;
    await tx.financeApprovalEvent.create({
      data: { sheetId: sheet.id, action: "REJECT", actorId: user.id, note: reason },
    });
    return true;
  });
  if (!saved) return { error: STALE };

  await notifyDecision(context, user, "REJECTED", reason, false);
  refresh(project.id);
  return { success: "Đã từ chối IC và báo cho người gửi." };
}

/** Người gửi rút lại IC đang chờ duyệt (vd muốn sửa thêm). */
export async function withdrawFinanceSheet(
  projectId: string,
  sheetId: string,
): Promise<FinanceApprovalState> {
  const user = await requireUser();
  const context = await loadApprovalContext(projectId, sheetId, user);
  if (!context) return { error: "Không tìm thấy IC của dự án này." };
  const { project, sheet, approver } = context;
  if (!canWithdrawFinanceSheet(user, sheet.icSubmittedById)) {
    return { error: "Chỉ người gửi hoặc Admin được rút lại IC." };
  }
  if (sheet.icStatus !== "SUBMITTED") return { error: "IC không ở trạng thái chờ duyệt." };

  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.financeSheet.updateMany({
      where: { id: sheet.id, icStatus: "SUBMITTED" },
      data: { icStatus: "DRAFT" },
    });
    if (updated.count === 0) return false;
    await tx.financeApprovalEvent.create({
      data: { sheetId: sheet.id, action: "WITHDRAW", actorId: user.id },
    });
    return true;
  });
  if (!saved) return { error: STALE };

  if (approver) {
    if (approver.id !== user.id) {
      await notify([approver.id], {
        type: "FINANCE_APPROVAL_DECISION",
        message: `${user.name} đã rút lại IC v${sheet.version} của dự án "${project.name}".`,
        projectId: project.id,
      });
    }
    const numbers = sellNumbers(sheet);
    queueFinanceApprovalEmail({
      projectId: project.id,
      toIds: [approver.id],
      ccIds: [...sheet.icCcUserIds, user.id],
      replyToId: user.id,
      inReplyTo: sheet.icEmailMessageId,
      event: {
        kind: "WITHDRAWN",
        projectName: project.name,
        clientName: sheet.clientName,
        version: sheet.version,
        submitterName: sheet.icSubmittedBy?.name ?? user.name,
        actorName: user.name,
        message: null,
        reason: null,
        selfApproval: false,
        costSubtotal: numbers.cost,
        sell: { gross: numbers.gross, profit: numbers.profit, margin: numbers.margin },
      },
    });
  }
  refresh(project.id);
  return { success: "Đã rút lại IC về bản nháp." };
}

/** Báo kết quả duyệt/từ chối cho người gửi + CC, trả lời trong cùng luồng email. */
async function notifyDecision(
  context: Context,
  user: Viewer,
  kind: "APPROVED" | "REJECTED",
  reason: string | null,
  selfApproval: boolean,
) {
  const { project, sheet } = context;
  const submitterId = sheet.icSubmittedById;
  if (submitterId && submitterId !== user.id) {
    await notify([submitterId], {
      type: "FINANCE_APPROVAL_DECISION",
      message:
        kind === "APPROVED"
          ? `${user.name} đã duyệt IC v${sheet.version} của dự án "${project.name}".`
          : `${user.name} đã từ chối IC v${sheet.version} của dự án "${project.name}": ${reason}`,
      projectId: project.id,
    });
  }
  const numbers = sellNumbers(sheet);
  queueFinanceApprovalEmail({
    projectId: project.id,
    toIds: submitterId ? [submitterId] : [user.id],
    ccIds: [...sheet.icCcUserIds, user.id],
    replyToId: user.id,
    inReplyTo: sheet.icEmailMessageId,
    event: {
      kind,
      projectName: project.name,
      clientName: sheet.clientName,
      version: sheet.version,
      submitterName: sheet.icSubmittedBy?.name ?? "",
      actorName: user.name,
      message: null,
      reason,
      selfApproval,
      costSubtotal: numbers.cost,
      sell: { gross: numbers.gross, profit: numbers.profit, margin: numbers.margin },
    },
  });
}

/**
 * Sửa IC đã duyệt: tạo phiên bản mới (bản nháp) chép từ bản đã duyệt.
 * Bản cũ giữ nguyên để xem lại; doanh thu chỉ đổi khi bản mới được duyệt.
 */
export async function createNextFinanceVersion(
  projectId: string,
  sheetId: string,
): Promise<FinanceApprovalState> {
  const user = await requireUser();
  if (!canEditFinanceSheet(user.role)) return { error: "Chỉ Admin hoặc Account được tạo phiên bản mới." };
  const project = await findFinanceProject(String(projectId), user);
  if (!project) return { error: "Không tìm thấy dự án này." };
  const source = await prisma.financeSheet.findFirst({
    where: { id: String(sheetId), projectId: project.id, superseded: false },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: { sellLines: { orderBy: { order: "asc" }, include: { costs: { orderBy: { order: "asc" } } } } },
      },
    },
  });
  if (!source) return { error: STALE };
  if (source.icStatus !== "APPROVED") return { error: "Chỉ tạo phiên bản mới từ IC đã duyệt." };

  const created = await prisma.$transaction(async (tx) => {
    const retired = await tx.financeSheet.updateMany({
      where: { id: source.id, superseded: false, icStatus: "APPROVED" },
      data: { superseded: true },
    });
    if (retired.count === 0) return null;
    const next = await tx.financeSheet.create({
      data: {
        projectId: project.id,
        version: source.version + 1,
        clientName: source.clientName,
        programName: source.programName,
        headcount: source.headcount,
        location: source.location,
        eventStart: source.eventStart,
        eventEnd: source.eventEnd,
        sellVatRate: source.sellVatRate,
        sellSubtotal: source.sellSubtotal,
        icCostSubtotal: source.icCostSubtotal,
        icCcUserIds: source.icCcUserIds,
        createdById: user.id,
        updatedById: user.id,
        sections: {
          create: source.sections.map((section) => ({
            order: section.order,
            name: section.name,
            sellLines: {
              create: section.sellLines.map((line) => ({
                order: line.order,
                stt: line.stt,
                name: line.name,
                description: line.description,
                unit: line.unit,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                note: line.note,
                costs: {
                  create: line.costs.map((cost) => ({
                    order: cost.order,
                    description: cost.description,
                    unit: cost.unit,
                    icQuantity: cost.icQuantity,
                    icUnitPrice: cost.icUnitPrice,
                    icVatRate: cost.icVatRate,
                    icSupplierId: cost.icSupplierId,
                    icNote: cost.icNote,
                  })),
                },
              })),
            },
          })),
        },
      },
      select: { id: true, version: true },
    });
    await tx.financeApprovalEvent.create({
      data: {
        sheetId: next.id,
        action: "NEW_VERSION",
        actorId: user.id,
        note: `Tạo từ IC v${source.version} đã duyệt`,
      },
    });
    return next;
  });
  if (!created) return { error: STALE };
  refresh(project.id);
  return { success: `Đã tạo IC v${created.version} (bản nháp) từ bản đã duyệt.` };
}
