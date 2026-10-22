import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/lib/auth";
import {
  RECAP_AUDIO_CONTENT_TYPES,
  RECAP_MAX_AUDIO_BYTES,
  isRecapAudioPathname,
} from "@/lib/meetingRecap";
import { recapUploadBlockReason } from "@/lib/meetingRecapGuard";

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
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!isRecapAudioPathname(meetingId, pathname)) {
          throw new Error("Định dạng file chưa hỗ trợ. Dùng mp3, m4a, wav, webm, ogg, flac hoặc mp4.");
        }
        // Kiểm tra lại quyền và hạn mức ngay trước khi cấp token (trình duyệt đã hỏi /check trước đó).
        let payload: { durationSeconds?: unknown; size?: unknown } = {};
        try {
          payload = JSON.parse(clientPayload ?? "{}") ?? {};
        } catch {
          payload = {};
        }
        const user = await getCurrentUser();
        const blocked = await recapUploadBlockReason(meetingId, user, payload);
        if (blocked || !user) throw new Error(blocked ?? "Phiên đăng nhập đã hết hạn.");
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
