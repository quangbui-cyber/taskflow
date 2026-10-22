import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/lib/auth";
import { MEETING_RECAPS_DISABLED_MESSAGE, meetingRecapsEnabled } from "@/lib/features";
import {
  RECAP_AUDIO_CONTENT_TYPES,
  RECAP_MAX_AUDIO_BYTES,
  isRecapAudioPathname,
  recapStartBlockReason,
} from "@/lib/meetingRecap";
import { findRecapMeeting } from "@/lib/meetingRecapData";

export const runtime = "nodejs";

/**
 * Cấp token để trình duyệt tải file ghi âm thẳng lên kho Vercel Blob riêng tư
 * (vượt giới hạn 4,5 MB của request lên Vercel). File chỉ được ghi vào
 * thư mục của đúng cuộc họp này.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!meetingRecapsEnabled()) throw new Error(MEETING_RECAPS_DISABLED_MESSAGE);
        const user = await getCurrentUser();
        if (!user) throw new Error("Phiên đăng nhập đã hết hạn.");
        const meeting = await findRecapMeeting(meetingId);
        const blocked = recapStartBlockReason(meeting, user);
        if (blocked) throw new Error(blocked);
        if (!isRecapAudioPathname(meetingId, pathname)) {
          throw new Error("Định dạng file chưa hỗ trợ. Dùng mp3, m4a, wav, webm, ogg, flac hoặc mp4.");
        }
        return {
          allowedContentTypes: RECAP_AUDIO_CONTENT_TYPES,
          maximumSizeInBytes: RECAP_MAX_AUDIO_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
          validUntil: Date.now() + 60 * 60 * 1000,
          tokenPayload: JSON.stringify({ meetingId, userId: user.id }),
        };
      },
      // Bắt đầu xử lý do trình duyệt gọi /api/meetings/[id]/recap sau khi tải xong
      // (callback của Blob không gọi được về máy dev), nên ở đây không cần làm gì.
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tải được file lên.";
    return Response.json({ error: message }, { status: 400 });
  }
}
