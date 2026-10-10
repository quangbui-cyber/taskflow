import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadDocument } from "@/lib/workflow/service";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await requireUser();
  const { fileId } = await params;
  const file = await prisma.workflowPhysicalScanFile.findUnique({ where: { id: fileId }, include: { batch: { select: { requestId: true } } } });
  if (!file || !await loadDocument(file.batch.requestId, user)) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
