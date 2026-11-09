import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled } from "@/lib/features";
import { loadCrmActor, loadOpportunityResource } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { lockOpportunity } from "@/lib/crm/opportunityWorkflow";
import { trashDriveFileSafe } from "@/lib/driveStorage";
import { openStoredFileResponse, storedFileResponse } from "@/lib/storedFileResponse";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; fileId: string }> };
const missing = () => Response.json({ error: "Không tìm thấy tài liệu hoặc bạn không có quyền xem." }, { status: 404 });
const expired = () => Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });

export async function GET(request: Request, { params }: Context) {
  if (!crmEnabled()) return missing();
  const user = await getCurrentUser(); if (!user) return expired();
  const { id, fileId } = await params;
  const [file, resource, actor] = await Promise.all([
    prisma.projectFile.findFirst({ where: { id: fileId, opportunityId: id } }),
    loadOpportunityResource(prisma, id), loadCrmActor(user),
  ]);
  if (!file || !resource || !crmCan(actor, "VIEW", resource)) return missing();
  return new URL(request.url).searchParams.get("open") === "1" ? openStoredFileResponse(file, user.email) : storedFileResponse(file);
}

export async function DELETE(_request: Request, { params }: Context) {
  if (!crmEnabled()) return missing();
  const user = await getCurrentUser(); if (!user) return expired();
  const { id, fileId } = await params;
  const actor = await loadCrmActor(user);
  // Serialize with win/close/assignment so stale Opportunity URLs cannot delete Project files.
  const result = await prisma.$transaction(async tx => {
    await lockOpportunity(tx, id);
    const file = await tx.projectFile.findFirst({ where: { id: fileId, opportunityId: id } });
    const resource = await loadOpportunityResource(tx, id);
    if (!file || !resource || !crmCan(actor, "VIEW", resource)) return { missing: true } as const;
    if (file.uploaderId !== user.id && !crmCan(actor, "EDIT", resource)) return { denied: true } as const;
    await tx.projectFile.delete({ where: { id: fileId } });
    return { driveFileId: file.driveFileId };
  });
  if ("missing" in result) return missing();
  if ("denied" in result) return Response.json({ error: "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team." }, { status: 403 });
  after(() => trashDriveFileSafe(result.driveFileId));
  revalidatePath(`/crm/opportunities/${id}`);
  return Response.json({ success: true });
}
