"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { sheetTotals } from "@/lib/financeCalc";
import { defaultFinanceHeader } from "@/lib/financeHeader";
import { canEditFinanceSheet, isFinanceSheetLocked } from "@/lib/financePolicy";
import { findFinanceProject } from "@/lib/financeSheet";
import {
  collectInputIds,
  collectSupplierIds,
  readFinanceSheetInput,
} from "@/lib/financeSheetInput";

export type FinanceActionState = { error?: string; success?: string; updatedAt?: string };

const LOCKED_ERROR = "IC đang chờ duyệt hoặc đã duyệt nên không sửa được.";

/** Tạo bảng tài chính đầu tiên cho dự án, điền sẵn thông tin chung từ dự án. */
export async function createFinanceSheet(projectId: string): Promise<FinanceActionState> {
  const user = await requireUser();
  if (!canEditFinanceSheet(user.role)) {
    return { error: "Chỉ Admin hoặc Account được lập IC." };
  }
  const project = await findFinanceProject(String(projectId), user);
  if (!project) return { error: "Không tìm thấy dự án hoặc bạn không thuộc dự án này." };

  const header = defaultFinanceHeader({
    name: project.name,
    clientName: project.client?.name ?? null,
    executionStartAt: project.executionStartAt,
    executionEndAt: project.executionEndAt,
  });
  try {
    await prisma.financeSheet.create({
      data: {
        projectId: project.id,
        version: 1,
        ...header,
        createdById: user.id,
        updatedById: user.id,
        sections: { create: [{ order: 0, name: "I. HẠNG MỤC" }] },
      },
    });
  } catch (error) {
    // Hai người bấm "Tạo IC" cùng lúc: bảng đã có, chỉ cần tải lại.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      revalidatePath(`/projects/${project.id}`);
      return { success: "IC đã được tạo." };
    }
    throw error;
  }
  revalidatePath(`/projects/${project.id}`);
  return { success: "Đã tạo IC." };
}

/**
 * Lưu toàn bộ bảng (thông tin chung, nhóm, hạng mục, dòng chi phí).
 * Dòng đã có thì cập nhật theo id, dòng mới thì tạo, dòng bị bỏ thì xoá —
 * để id của dòng chi phí giữ nguyên cho phiếu tạm ứng sau này.
 * `expectedUpdatedAt` chặn ghi đè khi người khác vừa lưu.
 */
export async function saveFinanceSheet(
  projectId: string,
  sheetId: string,
  expectedUpdatedAt: string,
  payload: unknown,
): Promise<FinanceActionState> {
  const user = await requireUser();
  if (!canEditFinanceSheet(user.role)) {
    return { error: "Chỉ Admin hoặc Account được sửa IC." };
  }
  const project = await findFinanceProject(String(projectId), user);
  if (!project) return { error: "Không tìm thấy dự án hoặc bạn không thuộc dự án này." };

  const input = readFinanceSheetInput(payload);
  if ("error" in input) return input;

  const sheet = await prisma.financeSheet.findFirst({
    where: { id: String(sheetId), projectId: project.id, superseded: false },
    select: {
      id: true,
      icStatus: true,
      sections: {
        select: {
          id: true,
          sellLines: { select: { id: true, costs: { select: { id: true } } } },
        },
      },
    },
  });
  if (!sheet) return { error: "IC không còn tồn tại. Hãy tải lại trang." };
  if (isFinanceSheetLocked(sheet.icStatus)) return { error: LOCKED_ERROR };

  // Id gửi lên phải thuộc đúng bảng này.
  const existing = {
    sections: new Set(sheet.sections.map((section) => section.id)),
    lines: new Set(sheet.sections.flatMap((section) => section.sellLines.map((line) => line.id))),
    costs: new Set(
      sheet.sections.flatMap((section) =>
        section.sellLines.flatMap((line) => line.costs.map((cost) => cost.id)),
      ),
    ),
  };
  const sent = collectInputIds(input);
  const foreign =
    [...sent.sections].some((id) => !existing.sections.has(id)) ||
    [...sent.lines].some((id) => !existing.lines.has(id)) ||
    [...sent.costs].some((id) => !existing.costs.has(id));
  if (foreign) return { error: "Dữ liệu bảng không khớp. Hãy tải lại trang." };

  const supplierIds = collectSupplierIds(input);
  if (supplierIds.length) {
    const found = await prisma.financeSupplier.count({ where: { id: { in: supplierIds } } });
    if (found !== supplierIds.length) {
      return { error: "Có nhà cung cấp vừa bị xoá khỏi danh bạ. Hãy chọn lại." };
    }
  }

  const totals = sheetTotals(
    input.sections.map((section) => ({ lines: section.lines })),
    input.sellVatRate,
  );

  const savedAt = await prisma.$transaction(
    async (tx) => {
      // Ghi vào dòng bảng trước để khoá hàng: hai người lưu cùng lúc thì người sau bị từ chối.
      const claimed = await tx.financeSheet.updateMany({
        where: {
          id: sheet.id,
          updatedAt: new Date(expectedUpdatedAt),
          icStatus: { notIn: ["SUBMITTED", "APPROVED"] },
        },
        data: {
          ...input.header,
          sellVatRate: input.sellVatRate,
          sellSubtotal: totals.sellSubtotal,
          icCostSubtotal: totals.costSubtotal,
          updatedById: user.id,
        },
      });
      if (claimed.count === 0) return null;

      await tx.costLine.deleteMany({
        where: {
          sellLine: { section: { sheetId: sheet.id } },
          id: { notIn: [...sent.costs] },
        },
      });

      const keptSections: string[] = [];
      const keptLines: string[] = [];
      for (const [sectionOrder, section] of input.sections.entries()) {
        const savedSection = section.id
          ? await tx.financeSection.update({
              where: { id: section.id },
              data: { order: sectionOrder, name: section.name },
              select: { id: true },
            })
          : await tx.financeSection.create({
              data: { sheetId: sheet.id, order: sectionOrder, name: section.name },
              select: { id: true },
            });
        keptSections.push(savedSection.id);

        for (const [lineOrder, line] of section.lines.entries()) {
          const lineData = {
            sectionId: savedSection.id,
            order: lineOrder,
            stt: line.stt,
            name: line.name,
            description: line.description,
            unit: line.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            note: line.note,
          };
          const savedLine = line.id
            ? await tx.sellLine.update({ where: { id: line.id }, data: lineData, select: { id: true } })
            : await tx.sellLine.create({ data: lineData, select: { id: true } });
          keptLines.push(savedLine.id);

          for (const [costOrder, cost] of line.costs.entries()) {
            const costData = {
              sellLineId: savedLine.id,
              order: costOrder,
              description: cost.description,
              unit: cost.unit,
              icQuantity: cost.icQuantity,
              icUnitPrice: cost.icUnitPrice,
              icVatRate: cost.icVatRate,
              icSupplierId: cost.icSupplierId,
              icNote: cost.icNote,
            };
            if (cost.id) {
              await tx.costLine.update({ where: { id: cost.id }, data: costData });
            } else {
              await tx.costLine.create({ data: costData });
            }
          }
        }
      }

      // Xoá hạng mục và nhóm bị bỏ sau cùng: dòng được chuyển sang nhóm/hạng mục khác
      // đã nằm ở chỗ mới, nên không bị xoá theo.
      await tx.sellLine.deleteMany({
        where: { section: { sheetId: sheet.id }, id: { notIn: keptLines } },
      });
      await tx.financeSection.deleteMany({
        where: { sheetId: sheet.id, id: { notIn: keptSections } },
      });

      const fresh = await tx.financeSheet.findUniqueOrThrow({
        where: { id: sheet.id },
        select: { updatedAt: true },
      });
      return fresh.updatedAt;
    },
    { timeout: 20_000 },
  );

  if (!savedAt) {
    return {
      error: "IC vừa được người khác lưu hoặc gửi duyệt. Hãy tải lại trang để xem bản mới nhất.",
    };
  }
  revalidatePath(`/projects/${project.id}`);
  return { success: "Đã lưu IC.", updatedAt: savedAt.toISOString() };
}
