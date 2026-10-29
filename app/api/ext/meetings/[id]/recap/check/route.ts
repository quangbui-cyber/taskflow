import { verifyExtensionToken } from "@/lib/extensionAuth";
import { handleCorsPreflight, jsonWithCors } from "@/lib/extensionCors";
import { recapUploadBlockReason } from "@/lib/meetingRecapGuard";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/** Extension hỏi trước khi tải file: còn được phép và còn hạn mức không */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyExtensionToken(request.headers.get("authorization"));
  if (!user) {
    return jsonWithCors({ error: "Token không hợp lệ hoặc đã bị thu hồi." }, { status: 401 }, request);
  }

  const { id: meetingId } = await params;
  let audio: { durationSeconds?: unknown; size?: unknown } = {};
  try {
    audio = ((await request.json()) as typeof audio) ?? {};
  } catch {
    audio = {};
  }

  const blocked = await recapUploadBlockReason(meetingId, user, audio);
  return blocked
    ? jsonWithCors({ error: blocked }, { status: 409 }, request)
    : jsonWithCors({ ok: true }, { status: 200 }, request);
}
