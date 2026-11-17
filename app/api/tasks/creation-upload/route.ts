import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser, getMembership } from "@/lib/auth";
import { isTaskCreationUploadPath, validateTaskCreationFile } from "@/lib/taskCreationFiles";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const user = await getCurrentUser();
        if (!user) throw new Error("Phiên đăng nhập đã hết hạn.");

        const input = JSON.parse(clientPayload ?? "null");
        if (
          typeof input?.projectId !== "string" ||
          typeof input.name !== "string" ||
          typeof input.type !== "string" ||
          !Number.isSafeInteger(input.size) ||
          !isTaskCreationUploadPath(pathname, input.projectId, user.id)
        ) throw new Error("Tệp đính kèm không hợp lệ.");

        if (user.role !== "ADMIN" && !(await getMembership(input.projectId, user.id))) {
          throw new Error("Bạn không thuộc project này.");
        }

        const meta = validateTaskCreationFile(input);
        return {
          allowedContentTypes: [meta.mimeType],
          maximumSizeInBytes: meta.size,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 60 * 60 * 1000,
        };
      },
      // The creation action saves the task and its attachments together.
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Không thể tải tệp lên." },
      { status: 400 }
    );
  }
}
