import { getCurrentUser } from "@/lib/auth";
import { recapUploadBlockReason } from "@/lib/meetingRecapGuard";

export const runtime = "nodejs";

/** Trình duyệt hỏi trước khi tải file: còn được phép và còn hạn mức không. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  let audio: { durationSeconds?: unknown; size?: unknown } = {};
  try {
    audio = ((await request.json()) as typeof audio) ?? {};
  } catch {
    audio = {};
  }
  const blocked = await recapUploadBlockReason(meetingId, await getCurrentUser(), audio);
  return blocked ? Response.json({ error: blocked }, { status: 409 }) : Response.json({ ok: true });
}
