import { verifyExtensionToken } from "@/lib/extensionAuth";
import { handleCorsPreflight, jsonWithCors } from "@/lib/extensionCors";
import { startMeetingRecapWorkflow } from "@/lib/meetingRecapWorkflow";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/** Sau khi extension tải file ghi âm lên Blob xong: kích hoạt xử lý chép lời & tóm tắt */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyExtensionToken(request.headers.get("authorization"));
  if (!user) {
    return jsonWithCors({ error: "Token không hợp lệ hoặc đã bị thu hồi." }, { status: 401 }, request);
  }

  const { id: meetingId } = await params;
  let pathname = "";
  let fileName = "";
  let durationSeconds: unknown = null;
  try {
    const body = (await request.json()) as { pathname?: unknown; fileName?: unknown; durationSeconds?: unknown };
    pathname = typeof body.pathname === "string" ? body.pathname : "";
    fileName = typeof body.fileName === "string" ? body.fileName : "";
    durationSeconds = body.durationSeconds;
  } catch {
    return jsonWithCors({ error: "Yêu cầu không hợp lệ." }, { status: 400 }, request);
  }

  const result = await startMeetingRecapWorkflow({
    meetingId,
    user,
    pathname,
    fileName,
    durationSeconds,
  });

  if (!result.success) {
    return jsonWithCors({ error: result.error }, { status: result.status }, request);
  }

  return jsonWithCors({ recap: { id: result.recapId } }, { status: 200 }, request);
}
