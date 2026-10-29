import { getCurrentUser } from "@/lib/auth";
import { startMeetingRecapWorkflow } from "@/lib/meetingRecapWorkflow";

export const runtime = "nodejs";
// Chép lời + viết biên bản chạy nền sau khi trả lời; Vercel cho tối đa 300 giây (gói Hobby).
export const maxDuration = 300;

/** Sau khi trình duyệt tải file ghi âm lên Blob: ghi nhận và bắt đầu xử lý nền. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });

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
    return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  }

  const result = await startMeetingRecapWorkflow({
    meetingId,
    user,
    pathname,
    fileName,
    durationSeconds,
  });

  if (!result.success) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json({ recap: { id: result.recapId } });
}
