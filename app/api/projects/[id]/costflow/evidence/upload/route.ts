import { createHash, randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readProjectUpload } from "@/lib/projectFiles";
import type { FinanceData } from "@/lib/costflow/types";
import { attachActualCostEvidence } from "@/lib/costflow/actualCostService";
import { normalizeActualCostEvidenceKind } from "@/lib/costflow/actualCost";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Cần đăng nhập." }, { status: 401 });
  // Mutation route requires same-origin browser requests in addition to session auth.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  const { id } = await params;
  try {
    const [project, ddGrant] = await Promise.all([
      prisma.project.findUnique({ where: { id }, select: { id: true, members: { where: { userId: actor.id }, select: { userId: true } } } }),
      prisma.workflowRoleGrant.findFirst({ where: { userId: actor.id, role: "AC_DD", revokedAt: null }, select: { id: true } }),
    ]);
    if (!project) return Response.json({ error: "Không có quyền tải minh chứng." }, { status: 403 });
    const workspace = await prisma.costFlowWorkspace.findUnique({ where: { projectId: id } });
    if ((workspace?.data as unknown as FinanceData)?.closed) return Response.json({ error: "Tài chính đã đóng." }, { status: 409 });
    if (Number(request.headers.get("content-length")) > 42 * 1024 * 1024) return Response.json({ error: "Tối đa 10 file, mỗi file 4 MiB." }, { status: 413 });
    const form = await request.formData();
    const lineId = String(form.get("lineId") ?? "").trim();
    if (form.get("vault") === "true") {
      if (!project.members.length && actor.role !== "ADMIN") return Response.json({ error: "Chỉ thành viên Project được tải chứng từ AC." }, { status: 403 });
      const kind = normalizeActualCostEvidenceKind(String(form.get("kind") ?? ""));
      const entries = form.getAll("proof");
      if (!entries.length || entries.length > 10) throw new Error("Chọn từ 1 đến 10 file chứng từ.");
      const uploads = await Promise.all(entries.map(entry => readProjectUpload(entry)));
      if (uploads.some(upload => !upload)) throw new Error("Chọn file chứng từ hợp lệ, tối đa 4 MiB mỗi file.");
      const evidence = [];
      for (const upload of uploads) {
        if (!upload) continue;
        const sha256 = createHash("sha256").update(upload.data).digest("hex");
        const existing = await prisma.costFlowEvidence.findFirst({ where: { projectId: id, kind, sha256 }, select: { id: true, name: true, kind: true, sha256: true } });
        if (existing) {
          evidence.push({ ...existing, reused: true });
          continue;
        }
        const created = await prisma.costFlowEvidence.create({
          data: { projectId: id, sourceFileId: `actual-cost-vault:${randomUUID()}`, kind, name: upload.name, mimeType: upload.mimeType, data: upload.data, sha256, createdBy: actor.id },
          select: { id: true, name: true, kind: true, sha256: true },
        });
        evidence.push({ ...created, reused: false });
      }
      return Response.json({ evidence }, { status: 201 });
    }
    if (lineId) {
      if (await prisma.actualCostSheet.findUnique({ where: { projectId: id }, select: { id: true } })) {
        return Response.json({ error: "Hãy tải chứng từ vào Kho và liên kết khi lưu bản nháp Bảng AC." }, { status: 409 });
      }
      if (!project.members.length && actor.role !== "ADMIN" && !ddGrant) return Response.json({ error: "Không có quyền tải chứng từ AC." }, { status: 403 });
      const kind = normalizeActualCostEvidenceKind(String(form.get("kind") ?? ""));
      const entries = form.getAll("proof");
      const uploads = (await Promise.all(entries.map(entry => readProjectUpload(entry)))).filter((item): item is NonNullable<typeof item> => !!item);
      const result = await attachActualCostEvidence(actor, { projectId: id, lineId, expectedVersion: Number(form.get("version")), kind }, uploads);
      return Response.json({
        lineId: result.lineId,
        version: result.version,
        evidence: result.evidence.map(item => ({ ...item, createdAt: item.createdAt.toISOString() })),
      }, { status: 201 });
    }
    if ((!project.members.length && actor.role !== "ADMIN") || !["ACCOUNT", "ADMIN"].includes(actor.role)) return Response.json({ error: "Không có quyền tải minh chứng IC." }, { status: 403 });
    const sourceId = String(form.get("sourceFileId") ?? "");
    const source = sourceId ? await prisma.projectFile.findFirst({ where: { id: sourceId, projectId: id } }) : null;
    if (sourceId && !source) return Response.json({ error: "File phải thuộc project." }, { status: 404 });
    let upload = await readProjectUpload(form.get("proof"));
    if (source) {
      const sourceData = source.data;
      if (!sourceData) {
        return Response.json({ error: "File trên Google Drive chưa có bản sao nội dung. Hãy tải file xuống rồi tải trực tiếp làm minh chứng." }, { status: 422 });
      }
      upload = { name: source.name, mimeType: source.mimeType, data: sourceData, size: source.size };
    }
    if (!upload || upload.size > 4 * 1024 * 1024) throw new Error("Chọn một file tối đa 4 MiB.");
    const evidence = await prisma.costFlowEvidence.create({ data: { projectId: id, sourceFileId: source?.id ?? "", kind: "IC_ESTIMATE", name: upload.name, mimeType: upload.mimeType, data: upload.data, sha256: createHash("sha256").update(upload.data).digest("hex"), createdBy: actor.id }, select: { id: true, name: true, mimeType: true, sha256: true, kind: true, requestId: true } });
    return Response.json({ evidence }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Chưa tải được file." }, { status: 422 }); }
}
