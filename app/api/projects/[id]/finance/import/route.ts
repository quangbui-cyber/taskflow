import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FinanceImportError } from "@/lib/financeImport";
import {
  importToSheetInput,
  parseFinanceUpload,
  readXlsxUpload,
  saveImportedSheet,
} from "@/lib/financeImportSave";
import { canEditFinanceSheet, canViewFinanceSell, isFinanceSheetLocked } from "@/lib/financePolicy";
import { findFinanceProject } from "@/lib/financeSheet";

export const runtime = "nodejs";

/**
 * Nhập IC từ file Excel.
 * - Không có `confirm`: chỉ đọc file và trả về bản xem trước + danh sách lỗi (không ghi gì).
 * - `confirm=1`: đọc lại chính file đó và lưu vào IC của dự án, lưu file gốc vào Tài liệu.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
  }
  if (!canEditFinanceSheet(user.role)) {
    return Response.json({ error: "Chỉ Admin hoặc Account được nhập IC." }, { status: 403 });
  }
  const { id } = await params;
  const project = await findFinanceProject(id, user);
  if (!project) {
    return Response.json(
      { error: "Không tìm thấy dự án Khách hàng này hoặc bạn không thuộc dự án." },
      { status: 404 },
    );
  }

  try {
    const formData = await request.formData();
    const upload = await readXlsxUpload(formData.get("file"));
    const result = await parseFinanceUpload(upload.data, project);
    const current = await prisma.financeSheet.findFirst({
      where: { projectId: project.id, superseded: false },
      orderBy: { version: "desc" },
      select: { icStatus: true, _count: { select: { sections: true } } },
    });

    if (formData.get("confirm") !== "1") {
      return Response.json({
        fileName: upload.name,
        result,
        canSeeSell: canViewFinanceSell(user.role),
        existing: current
          ? { locked: isFinanceSheetLocked(current.icStatus), sections: current._count.sections }
          : null,
      });
    }

    await saveImportedSheet({
      projectId: project.id,
      userId: user.id,
      input: importToSheetInput(result),
      file: upload,
    });
    revalidatePath(`/projects/${project.id}`);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof FinanceImportError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
