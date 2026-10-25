import { getCurrentUser } from "@/lib/auth";
import { parseUploadRequest, signUploadTicket, uploadAccess } from "@/lib/driveUpload";
import { projectDocsFolder, taskFolder } from "@/lib/driveStorage";
import { DriveNotConnectedError, createResumableUpload, driveConnected } from "@/lib/googleDrive";

export const runtime = "nodejs";

/**
 * Mở phiên tải lên Google Drive cho một file của dự án hoặc task.
 * 409 `{ legacy: true }` = Drive chưa kết nối, trình duyệt gửi file qua app như cũ (tối đa 4 MB).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });

  let parsed: ReturnType<typeof parseUploadRequest>;
  try {
    parsed = parseUploadRequest(await request.json().catch(() => null));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Tệp không hợp lệ." }, { status: 400 });
  }

  const access = await uploadAccess(parsed.target, user);
  if (!access) return Response.json({ error: "Bạn không có quyền tải tệp lên đây." }, { status: 403 });
  if (!(await driveConnected())) return Response.json({ legacy: true }, { status: 409 });

  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  try {
    const folderId =
      parsed.target.type === "project" ? await projectDocsFolder(access.projectId) : await taskFolder(parsed.target.taskId);
    const uploadUrl = await createResumableUpload({
      ...parsed.meta,
      parentId: folderId,
      origin,
      appProperties: { app: "mycreative", projectId: access.projectId },
    });
    const ticket = await signUploadTicket({
      ...parsed.meta,
      target: parsed.target,
      projectId: access.projectId,
      folderId,
      userId: user.id,
    });
    return Response.json({ uploadUrl, ticket, mimeType: parsed.meta.mimeType });
  } catch (error) {
    if (error instanceof DriveNotConnectedError) return Response.json({ legacy: true }, { status: 409 });
    console.error("Drive upload session failed", error);
    return Response.json({ legacy: true, error: "Google Drive đang lỗi." }, { status: 409 });
  }
}
