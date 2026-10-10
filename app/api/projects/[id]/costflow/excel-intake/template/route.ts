import { getCurrentUser } from "@/lib/auth";
import { attachmentDisposition } from "@/lib/contentDisposition";
import { createExcelIntakeTemplate } from "@/lib/costflow/quotationExcel";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const roleAllowed = actor.role === "ADMIN" || actor.role === "ACCOUNT";
  const [project, membership] = await Promise.all([
    prisma.project.findUnique({ where: { id }, select: { name: true, client: { select: { name: true } } } }),
    actor.role === "ADMIN"
      ? Promise.resolve({ userId: actor.id })
      : prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: id, userId: actor.id } }, select: { userId: true } }),
  ]);
  if (!roleAllowed || !project || !membership) return new Response("Not found", { status: 404 });
  const bytes = await createExcelIntakeTemplate({ projectName: project.name, customer: project.client?.name ?? "" });
  const fileName = `Bao-gia-va-IC-${project.name}-v4.xlsx`;
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": attachmentDisposition(fileName),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
