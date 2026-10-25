import { prisma } from "./prisma";
import { toDateInputVN } from "./dates";
import { canEditFinanceSheet, canViewFinanceSell, isFinanceSheetLocked } from "./financePolicy";

// Đọc bảng tài chính để hiển thị. Giá bán bị bỏ hẳn khỏi dữ liệu gửi xuống
// trình duyệt với người không được xem (USER), không chỉ ẩn trên giao diện.

export type FinanceViewer = { id: string; role: string };

export type CostLineView = {
  id: string;
  description: string | null;
  unit: string | null;
  icQuantity: number | null;
  icUnitPrice: number | null;
  icVatRate: number | null;
  icSupplierId: string | null;
  icNote: string | null;
};

export type SellLineView = {
  id: string;
  stt: string | null;
  name: string;
  description: string | null;
  unit: string | null;
  quantity: number | null;
  /** Luôn null khi người xem không được thấy giá bán. */
  unitPrice: number | null;
  note: string | null;
  costs: CostLineView[];
};

export type SectionView = { id: string; name: string; lines: SellLineView[] };

export type FinanceSheetView = {
  id: string;
  version: number;
  icStatus: string;
  updatedAt: string;
  updatedByName: string | null;
  header: {
    clientName: string;
    programName: string;
    headcount: string;
    location: string;
    eventStart: string; // yyyy-MM-dd hoặc ""
    eventEnd: string;
  };
  sellVatRate: number;
  sections: SectionView[];
};

export type FinancePermissions = {
  canSeeSell: boolean;
  canEdit: boolean;
  locked: boolean;
};

const num = (value: { toString(): string } | null) =>
  value === null ? null : Number(value.toString());

/** Dự án mà người xem được mở phần Tài chính: dự án Khách hàng, là thành viên hoặc Admin. */
export async function findFinanceProject(projectId: string, viewer: FinanceViewer) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      category: true,
      executionStartAt: true,
      executionEndAt: true,
      client: { select: { name: true } },
      members: { where: { userId: viewer.id }, select: { id: true }, take: 1 },
    },
  });
  if (!project || project.category !== "CLIENT") return null;
  if (viewer.role !== "ADMIN" && project.members.length === 0) return null;
  return project;
}

/** Bảng đang dùng của dự án (bản mới nhất chưa bị thay thế). */
export async function loadFinanceSheet(
  projectId: string,
  viewer: FinanceViewer,
): Promise<{ sheet: FinanceSheetView | null; permissions: FinancePermissions }> {
  const canSeeSell = canViewFinanceSell(viewer.role);
  const sheet = await prisma.financeSheet.findFirst({
    where: { projectId, superseded: false },
    orderBy: { version: "desc" },
    include: {
      updatedBy: { select: { name: true } },
      sections: {
        orderBy: { order: "asc" },
        include: {
          sellLines: {
            orderBy: { order: "asc" },
            include: { costs: { orderBy: { order: "asc" } } },
          },
        },
      },
    },
  });
  const permissions: FinancePermissions = {
    canSeeSell,
    canEdit: canEditFinanceSheet(viewer.role),
    locked: sheet ? isFinanceSheetLocked(sheet.icStatus) : false,
  };
  if (!sheet) return { sheet: null, permissions };

  return {
    permissions,
    sheet: {
      id: sheet.id,
      version: sheet.version,
      icStatus: sheet.icStatus,
      updatedAt: sheet.updatedAt.toISOString(),
      updatedByName: sheet.updatedBy?.name ?? null,
      header: {
        clientName: sheet.clientName ?? "",
        programName: sheet.programName ?? "",
        headcount: sheet.headcount ?? "",
        location: sheet.location ?? "",
        eventStart: sheet.eventStart ? toDateInputVN(sheet.eventStart) : "",
        eventEnd: sheet.eventEnd ? toDateInputVN(sheet.eventEnd) : "",
      },
      sellVatRate: canSeeSell ? Number(sheet.sellVatRate.toString()) : 0,
      sections: sheet.sections.map((section) => ({
        id: section.id,
        name: section.name,
        lines: section.sellLines.map((line) => ({
          id: line.id,
          stt: line.stt,
          name: line.name,
          description: line.description,
          unit: line.unit,
          quantity: num(line.quantity),
          unitPrice: canSeeSell ? num(line.unitPrice) : null,
          note: canSeeSell ? line.note : null,
          costs: line.costs.map((cost) => ({
            id: cost.id,
            description: cost.description,
            unit: cost.unit,
            icQuantity: num(cost.icQuantity),
            icUnitPrice: num(cost.icUnitPrice),
            icVatRate: num(cost.icVatRate),
            icSupplierId: cost.icSupplierId,
            icNote: cost.icNote,
          })),
        })),
      })),
    },
  };
}
