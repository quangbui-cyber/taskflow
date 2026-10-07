import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readProjectUpload } from "@/lib/projectFiles";
import type { FinanceData } from "@/lib/costflow/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Cần đăng nhập." }, { status: 401 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const { id } = await params;
  try {
    const project = await prisma.project.findFirst({ where: { id, ...(actor.role === "ADMIN" ? {} : { members: { some: { userId: actor.id } } }) }, select: { id: true } });
    if (!project || !["ACCOUNT", "ADMIN"].includes(actor.role)) return Response.json({ error: "Không có quyền tải minh chứng IC." }, { status: 403 });
    const workspace = await prisma.costFlowWorkspace.findUnique({ where: { projectId: id } });
    if ((workspace?.data as unknown as FinanceData)?.closed) return Response.json({ error: "Tài chính đã đóng." }, { status: 409 });
    if (Number(request.headers.get("content-length")) > 4.2 * 1024 * 1024) return Response.json({ error: "Mỗi file tối đa 4 MiB." }, { status: 413 });
    const form = await request.formData();
    const sourceId = String(form.get("sourceFileId") ?? "");
    const source = sourceId ? await prisma.projectFile.findFirst({ where: { id: sourceId, projectId: id } }) : null;
    if (sourceId && !source) return Response.json({ error: "File phải thuộc project." }, { status: 404 });
    const upload = source ? { name: source.name, mimeType: source.mimeType, data: source.data, size: source.size } : await readProjectUpload(form.get("proof"));
    if (!upload || upload.size > 4 * 1024 * 1024) throw new Error("Chọn một file tối đa 4 MiB.");
    const evidence = await prisma.costFlowEvidence.create({ data: { projectId: id, sourceFileId: source?.id ?? "", kind: "IC_ESTIMATE", name: upload.name, mimeType: upload.mimeType, data: upload.data, sha256: createHash("sha256").update(upload.data).digest("hex"), createdBy: actor.id }, select: { id: true, name: true, mimeType: true, sha256: true, kind: true, requestId: true } });
    return Response.json({ evidence }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Chưa tải được file." }, { status: 422 }); }
}
