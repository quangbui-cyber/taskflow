import { getCurrentUser } from "@/lib/auth";
import { previewPastedIntake, previewWorkbookIntake } from "@/lib/costflow/excelIntakeParser";
import { createNewDraftExcelIntakePreview } from "@/lib/costflow/excelIntakeService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const form = await request.formData();
    const paste = String(form.get("paste") ?? "");
    const sheet = String(form.get("sheet") ?? "").trim() || undefined;
    const range = String(form.get("range") ?? "").trim() || undefined;
    const upload = form.get("file");
    const sourceRevision = Number(form.get("sourceRevision") ?? "1");
    const sourceBytes = upload instanceof File && upload.size > 0 ? Buffer.from(await upload.arrayBuffer()) : null;
    const preview = sourceBytes
      ? await previewWorkbookIntake(sourceBytes, { sheet, range }, upload instanceof File ? upload.type : undefined)
      : previewPastedIntake({ text: paste, sheet });
    const session = await createNewDraftExcelIntakePreview(actor, {
      projectId: id,
      preview,
      sourceKind: sourceBytes ? "XLSX" : "PASTE",
      sourceRevision,
      sourceFilename: upload instanceof File ? upload.name : null,
      sourceMimeType: upload instanceof File ? upload.type : null,
      sourceBytes,
      sourceText: paste,
    });
    return Response.json({ previewSessionId: session.previewSessionId, expiresAt: session.expiresAt, state: session.state, operationKind: session.operationKind, display: session.display }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "Không đọc được dữ liệu Excel.";
    const status = /không tìm thấy|không có quyền/i.test(message) ? 404 : 422;
    return Response.json({ error: status === 404 ? "Not found" : message }, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
