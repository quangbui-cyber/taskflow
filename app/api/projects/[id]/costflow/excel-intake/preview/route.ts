import { getCurrentUser } from "@/lib/auth";
import { previewPastedIntake, previewWorkbookIntake } from "@/lib/costflow/excelIntakeParser";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [project, membership] = await Promise.all([
    prisma.project.findUnique({ where: { id }, select: { id: true } }),
    actor.role === "ADMIN" ? Promise.resolve({ userId: actor.id }) : prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId: actor.id } }, select: { userId: true } }),
  ]);
  const allowed = (actor.role === "ADMIN" || actor.role === "ACCOUNT") && !!project && !!membership;
  if (!allowed) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const form = await request.formData();
    const paste = String(form.get("paste") ?? "");
    const sheet = String(form.get("sheet") ?? "").trim() || undefined;
    const range = String(form.get("range") ?? "").trim() || undefined;
    const upload = form.get("file");
    const preview = upload instanceof File && upload.size > 0
      ? await previewWorkbookIntake(Buffer.from(await upload.arrayBuffer()), { sheet, range }, upload.type)
      : previewPastedIntake({ text: paste, sheet });
    return Response.json(preview, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "Không đọc được dữ liệu Excel.";
    return Response.json({ error: message }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  }
}
