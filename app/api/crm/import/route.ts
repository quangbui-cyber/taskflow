import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CRM_DISABLED_MESSAGE } from "@/lib/features";
import { crmEnabledForUser } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { readXlsxUpload } from "@/lib/financeImportSave";
import { FinanceImportError } from "@/lib/financeImport";
import { parseTrackerWorkbook, TrackerImportError } from "@/lib/crm/trackerImport";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
    if (!(await crmEnabledForUser(prisma, user))) return Response.json({ error: CRM_DISABLED_MESSAGE }, { status: 403 });
    const actor = await loadCrmActor(user);
    if (!crmCan(actor, "REVIEW_IMPORT")) return Response.json({ error: "Bạn không có quyền nhập tracker." }, { status: 403 });
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > 5 * 1024 * 1024 + 65536) return Response.json({ error: "File tracker phải nhỏ hơn 5 MB." }, { status: 400 });
    let formData: FormData;
    try { formData = await request.formData(); }
    catch { throw new TrackerImportError("Dữ liệu tải lên không hợp lệ."); }
    const upload = await readXlsxUpload(formData.get("file"));
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(upload.data.buffer.slice(upload.data.byteOffset, upload.data.byteOffset + upload.data.byteLength) as ArrayBuffer);
    } catch { throw new TrackerImportError("Không mở được file Excel. File có thể bị hỏng hoặc đặt mật khẩu."); }
    const [clients, accounts, aliases, reasons] = await Promise.all([
      prisma.client.findMany({ select: { id: true, name: true } }),
      prisma.account.findMany({ select: { id: true, name: true } }),
      prisma.programTypeAlias.findMany(),
      prisma.crmReason.findMany({ select: { id: true, group: true, label: true } }),
    ]);
    const rows = parseTrackerWorkbook(workbook, { clients, accounts, programAliases: new Map(aliases.map((a) => [a.alias, a.code])), reasons });
    if (!rows.length) throw new TrackerImportError("Không có dòng dữ liệu để nhập thử.");
    const summary = { OK: 0, DUPLICATE: 0, UNCLEAR: 0, TEXT_DATE: 0, MISSING_PIC: 0 };
    for (const row of rows) summary[row.status]++;
    const runId = await prisma.$transaction(async (tx) => {
      const run = await tx.trackerImportRun.create({ data: { mode: "DRY_RUN", fileName: upload.name, actorId: user.id, actorName: user.name, summary } });
      for (let start = 0; start < rows.length; start += 500) {
        await tx.trackerImportRow.createMany({ data: rows.slice(start, start + 500).map((row) => ({
          runId: run.id, sheet: row.sheet, rowNumber: row.rowNumber, raw: row.raw,
          proposed: JSON.parse(JSON.stringify(row.proposed)) as Prisma.InputJsonValue,
          status: row.status, matchedClientId: row.proposed.matchedClientId,
        })) });
      }
      return run.id;
    }, { timeout: 30000 });
    return Response.json({ runId, summary });
  } catch (error) {
    if (error instanceof TrackerImportError || error instanceof FinanceImportError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "Không nhập thử được tracker. Vui lòng thử lại." }, { status: 500 });
  }
}
