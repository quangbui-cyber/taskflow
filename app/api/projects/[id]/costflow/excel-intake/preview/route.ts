import { getCurrentUser } from "@/lib/auth";
import { previewPastedIntake, previewWorkbookIntake } from "@/lib/costflow/excelIntakeParser";
import { createNewDraftExcelIntakePreview, reserveExcelIntakePreviewGeneration } from "@/lib/costflow/excelIntakeService";
import { inventoryExcelWorkbook } from "@/lib/ai/excel/workbookInventory";
import { buildMaskedStructurePayload } from "@/lib/ai/excel/masking";
import { previewReviewedExcelMapping } from "@/lib/ai/excel/rebuildExcelIntakeInput";
import type { ReviewedExcelMapping } from "@/lib/ai/excel/mapping";

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
    const generation = await reserveExcelIntakePreviewGeneration(actor, id, "NEW_DRAFT");
    const aiMappingIntent = form.get("aiMappingIntent") === "true";
    const mappingJson = form.get("reviewedMapping");
    const workbookUpload = { filename: upload instanceof File ? upload.name : "", mimeType: upload instanceof File ? upload.type : "" };
    let preview;
    if (sourceBytes && aiMappingIntent) {
      // Keep the known deterministic adapter first; AI-assisted mapping is only for unrecognized workbooks.
      try { preview = await previewWorkbookIntake(sourceBytes, { sheet, range }, workbookUpload); }
      catch (knownError) {
        const inventory = await inventoryExcelWorkbook(sourceBytes, workbookUpload);
        if (typeof mappingJson !== "string" || mappingJson.length === 0) {
          return Response.json({ state: "MANUAL_MAPPING", knownError: knownError instanceof Error ? knownError.message.slice(0, 160) : "Không nhận diện được bảng chuẩn.",
            inventory: buildMaskedStructurePayload(inventory), fingerprint: inventory.fingerprint },
          { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
        }
        if (mappingJson.length > 40_000) throw new Error("Mapping vượt giới hạn.");
        const mapping = JSON.parse(mappingJson) as ReviewedExcelMapping;
        preview = previewReviewedExcelMapping(inventory, mapping);
      }
    } else preview = sourceBytes
      ? await previewWorkbookIntake(sourceBytes, { sheet, range }, workbookUpload)
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
    }, generation);
    return Response.json({ previewSessionId: session.previewSessionId, expiresAt: session.expiresAt, state: session.state, operationKind: session.operationKind, display: session.display }, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "Không đọc được dữ liệu Excel.";
    const status = /không tìm thấy|không có quyền/i.test(message) ? 404 : 422;
    return Response.json({ error: status === 404 ? "Not found" : message }, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
