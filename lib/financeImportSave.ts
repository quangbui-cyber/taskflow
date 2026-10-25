import ExcelJS from "exceljs";
import { prisma } from "./prisma";
import { toDateInputVN } from "./dates";
import { sheetTotals } from "./financeCalc";
import { defaultFinanceHeader } from "./financeHeader";
import {
  FinanceImportError,
  parseFinanceWorkbook,
  type FinanceImportResult,
} from "./financeImport";
import { isFinanceSheetLocked } from "./financePolicy";
import { readFinanceSheetInput, type FinanceSheetInput } from "./financeSheetInput";
import { MAX_PROJECT_FILE_SIZE } from "./projectFiles";

// Nhập IC từ file Excel: đọc file (xem trước) và lưu vào bảng tài chính của dự án.

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ProjectForImport = {
  id: string;
  name: string;
  executionStartAt: Date | null;
  executionEndAt: Date | null;
  client: { name: string } | null;
};

/** Kiểm tra file tải lên là .xlsx hợp lệ (đúng đuôi, đúng dung lượng, là file zip). */
export async function readXlsxUpload(file: unknown) {
  if (!(file instanceof File)) throw new FinanceImportError("Vui lòng chọn file Excel (.xlsx).");
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new FinanceImportError(
      "Chỉ nhận file .xlsx. File .xls đời cũ hãy mở bằng Excel và lưu lại thành .xlsx.",
    );
  }
  if (file.size === 0 || file.size > MAX_PROJECT_FILE_SIZE) {
    throw new FinanceImportError("File phải nhỏ hơn 4 MB.");
  }
  const data = new Uint8Array(await file.arrayBuffer());
  // File .xlsx là file zip, bắt đầu bằng "PK".
  if (data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new FinanceImportError("File không phải Excel .xlsx hợp lệ (có thể bị đặt mật khẩu).");
  }
  return { name: file.name.normalize("NFC"), size: file.size, data };
}

export async function parseFinanceUpload(
  data: Uint8Array,
  project: ProjectForImport,
): Promise<FinanceImportResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  } catch {
    throw new FinanceImportError("Không mở được file. File có thể bị hỏng hoặc đặt mật khẩu.");
  }
  const [suppliers, clients] = await Promise.all([
    prisma.supplier.findMany({ select: { id: true, name: true, shortName: true } }),
    prisma.client.findMany({ select: { name: true } }),
  ]);
  const result = parseFinanceWorkbook(workbook, {
    suppliers,
    clientNames: clients.map((client) => client.name),
  });
  // Mục thông tin chung file để trống thì lấy từ dự án.
  const fallback = defaultFinanceHeader({
    name: project.name,
    clientName: project.client?.name ?? null,
    executionStartAt: project.executionStartAt,
    executionEndAt: project.executionEndAt,
  });
  result.header = {
    ...result.header,
    clientName: result.header.clientName || (fallback.clientName ?? ""),
    programName: result.header.programName || (fallback.programName ?? ""),
    eventStart:
      result.header.eventStart || (fallback.eventStart ? toDateInputVN(fallback.eventStart) : ""),
    eventEnd:
      result.header.eventStart || !fallback.eventEnd ? result.header.eventEnd : toDateInputVN(fallback.eventEnd),
  };
  return result;
}

/** Đổi kết quả đọc file thành dữ liệu bảng, qua cùng bước kiểm tra như khi lưu tay. */
export function importToSheetInput(result: FinanceImportResult): FinanceSheetInput {
  const input = readFinanceSheetInput({
    header: result.header,
    sellVatRate: result.sellVatRate,
    sections: result.sections.map((section) => ({
      name: section.name,
      lines: section.lines.map((line) => ({
        stt: line.stt,
        name: line.name,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        note: line.note,
        costs: line.costs.map((cost) => ({
          description: cost.description,
          unit: cost.unit,
          icQuantity: cost.icQuantity,
          icUnitPrice: cost.icUnitPrice,
          icVatRate: cost.icVatRate,
          icSupplierId: cost.icSupplierId,
          // Giữ lại tên NCC trong file khi chưa có trong danh bạ, để chọn sau.
          icNote:
            cost.supplierName && !cost.icSupplierId
              ? [cost.icNote, `NCC trong file: ${cost.supplierName}`].filter(Boolean).join(" · ")
              : cost.icNote,
        })),
      })),
    })),
  });
  if ("error" in input) throw new FinanceImportError(input.error);
  return input;
}

/**
 * Lưu IC từ file: dự án chưa có IC thì tạo mới; IC đang là bản nháp (hoặc bị từ chối)
 * thì thay toàn bộ nội dung. IC đang chờ duyệt hoặc đã duyệt thì không được ghi đè.
 * File gốc được lưu vào tab Tài liệu của dự án.
 */
export async function saveImportedSheet(options: {
  projectId: string;
  userId: string;
  input: FinanceSheetInput;
  file: { name: string; size: number; data: Uint8Array };
}) {
  const { projectId, userId, input, file } = options;
  const totals = sheetTotals(input.sections.map((section) => ({ lines: section.lines })), input.sellVatRate);
  const sections = input.sections.map((section, sectionOrder) => ({
    order: sectionOrder,
    name: section.name,
    sellLines: {
      create: section.lines.map((line, lineOrder) => ({
        order: lineOrder,
        stt: line.stt,
        name: line.name,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        note: line.note,
        costs: {
          create: line.costs.map((cost, costOrder) => ({
            order: costOrder,
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
  }));
  const sheetData = {
    ...input.header,
    sellVatRate: input.sellVatRate,
    sellSubtotal: totals.sellSubtotal,
    icCostSubtotal: totals.costSubtotal,
    updatedById: userId,
  };

  await prisma.$transaction(
    async (tx) => {
      const current = await tx.financeSheet.findFirst({
        where: { projectId, superseded: false },
        orderBy: { version: "desc" },
        select: { id: true, icStatus: true },
      });
      if (current && isFinanceSheetLocked(current.icStatus)) {
        throw new FinanceImportError("IC đang chờ duyệt hoặc đã duyệt nên không nhập đè được.");
      }
      if (current) {
        await tx.financeSection.deleteMany({ where: { sheetId: current.id } });
        await tx.financeSheet.update({
          where: { id: current.id },
          data: { ...sheetData, sections: { create: sections } },
        });
      } else {
        await tx.financeSheet.create({
          data: {
            projectId,
            version: 1,
            createdById: userId,
            ...sheetData,
            sections: { create: sections },
          },
        });
      }
      await tx.projectFile.create({
        data: {
          projectId,
          uploaderId: userId,
          name: file.name,
          mimeType: XLSX_MIME,
          size: file.size,
          data: Uint8Array.from(file.data),
        },
      });
    },
    { timeout: 30_000 },
  );
}
