import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled } from "@/lib/features";
import { crmEnabledForUser } from "@/lib/crm/access";
import { assertOwnerAccess } from "@/lib/taskAccess";
import { lockOpportunity } from "@/lib/crm/opportunityWorkflow";
import { pushPendingFiles } from "@/lib/driveStorage";
import { readProjectUpload } from "@/lib/projectFiles";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!crmEnabled()) return Response.json({ error: "Không tìm thấy tài liệu hoặc bạn không có quyền xem." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
  if (!(await crmEnabledForUser(prisma, user))) return Response.json({ error: "Không tìm thấy tài liệu hoặc bạn không có quyền xem." }, { status: 404 });
  const { id } = await params;
  const owner = { kind: "OPPORTUNITY" as const, id };
  if (!("ok" in await assertOwnerAccess(prisma, user, owner, "CREATE_TASK"))) return Response.json({ error: "Bạn không có quyền tải tệp lên đây." }, { status: 403 });
  try {
    const upload = await readProjectUpload((await request.formData()).get("file"));
    if (!upload) return Response.json({ error: "Vui lòng chọn một tài liệu." }, { status: 400 });
    const file = await prisma.$transaction(async tx => {
      await lockOpportunity(tx, id);
      if (!("ok" in await assertOwnerAccess(tx, user, owner, "CREATE_TASK"))) return null;
      return tx.projectFile.create({ data: { opportunityId: id, uploaderId: user.id, name: upload.name, mimeType: upload.mimeType, size: upload.size, data: upload.data }, select: {
        id: true, name: true, mimeType: true, size: true, createdAt: true, uploader: { select: { id: true, name: true, avatarUrl: true } },
      } });
    });
    if (!file) return Response.json({ error: "Bạn không có quyền tải tệp lên đây." }, { status: 403 });
    after(() => pushPendingFiles({ owner }));
    revalidatePath(`/crm/opportunities/${id}`);
    return Response.json({ file: { ...file, createdAt: file.createdAt.toISOString(), driveUrl: null } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không thể tải tài liệu lên." }, { status: 400 });
  }
}
