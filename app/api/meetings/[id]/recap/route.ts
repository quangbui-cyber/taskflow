import { head } from "@vercel/blob";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MEETING_RECAPS_DISABLED_MESSAGE, meetingRecapsEnabled } from "@/lib/features";
import {
  RECAP_MAX_AUDIO_BYTES,
  canManageMeetingRecap,
  isRecapAudioPathname,
  recapStartBlockReason,
} from "@/lib/meetingRecap";
import { findRecapMeeting } from "@/lib/meetingRecapData";
import { deleteRecapAudio, runMeetingRecap } from "@/lib/meetingRecapJob";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
// Chép lời + viết biên bản chạy nền sau khi trả lời; Vercel cho tối đa 300 giây (gói Hobby).
export const maxDuration = 300;

/** Sau khi trình duyệt tải file ghi âm lên Blob: ghi nhận và bắt đầu xử lý nền. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!meetingRecapsEnabled()) {
    return Response.json({ error: MEETING_RECAPS_DISABLED_MESSAGE }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Phiên đăng nhập đã hết hạn." }, { status: 401 });

  const { id: meetingId } = await params;
  let pathname = "";
  let fileName = "";
  try {
    const body = (await request.json()) as { pathname?: unknown; fileName?: unknown };
    pathname = typeof body.pathname === "string" ? body.pathname : "";
    fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 200) : "";
  } catch {
    return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  }
  if (!isRecapAudioPathname(meetingId, pathname)) {
    return Response.json({ error: "File ghi âm không hợp lệ." }, { status: 400 });
  }

  const meeting = await findRecapMeeting(meetingId);
  const blocked = recapStartBlockReason(meeting, user);
  if (blocked || !meeting) {
    // Chỉ người có quyền mới được dọn file trong thư mục của cuộc họp.
    if (meeting && canManageMeetingRecap(meeting, user)) await deleteRecapAudio(pathname);
    return Response.json({ error: blocked ?? "Không tìm thấy cuộc họp." }, { status: 409 });
  }

  try {
    const blob = await head(pathname);
    if (blob.size > RECAP_MAX_AUDIO_BYTES) {
      await deleteRecapAudio(pathname);
      return Response.json({ error: "File ghi âm vượt quá 100 MB." }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Không tìm thấy file vừa tải lên. Thử tải lại." }, { status: 400 });
  }

  // File cũ còn sót (lần trước lỗi xoá) thì dọn luôn.
  const previousAudio = meeting.recap?.audioPathname;
  if (previousAudio && previousAudio !== pathname) await deleteRecapAudio(previousAudio);

  const startedAt = new Date();
  const fresh = {
    status: "PROCESSING",
    stage: "TRANSCRIBING",
    error: null,
    audioName: fileName || null,
    audioPathname: pathname,
    audioSeconds: null,
    transcript: null,
    content: null,
    sentAt: null,
    createdById: user.id,
    processingStartedAt: startedAt,
  };
  const recap = await prisma.meetingRecap.upsert({
    where: { meetingId },
    create: { meetingId, ...fresh },
    update: fresh,
    select: { id: true },
  });

  after(() => runMeetingRecap(recap.id, startedAt));
  return Response.json({ ok: true });
}
