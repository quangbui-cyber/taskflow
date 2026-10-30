import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { verifyExtensionToken } from "@/lib/extensionAuth";
import { extensionCorsHeaders, handleCorsPreflight } from "@/lib/extensionCors";
import {
  RECAP_AUDIO_CONTENT_TYPES,
  RECAP_MAX_AUDIO_BYTES,
  isRecapAudioPathname,
} from "@/lib/meetingRecap";
import { recapUploadBlockReason } from "@/lib/meetingRecapGuard";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/** Cấp token Vercel Blob cho Chrome Extension để tải file trực tiếp lên Blob */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return new Response(JSON.stringify({ error: "Yêu cầu không hợp lệ." }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...extensionCorsHeaders(request) },
    });
  }

  const corsHeaders = extensionCorsHeaders(request);

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!isRecapAudioPathname(meetingId, pathname)) {
          throw new Error("Định dạng file chưa hỗ trợ. Dùng mp3, m4a, wav, webm, ogg, flac hoặc mp4.");
        }

        let payload: { token?: unknown; durationSeconds?: unknown; size?: unknown } = {};
        try {
          payload = JSON.parse(clientPayload ?? "{}") ?? {};
        } catch {
          payload = {};
        }

        // Ưu tiên Authorization header; nếu không có thì đọc từ clientPayload
        const rawAuth =
          request.headers.get("authorization") ||
          (typeof payload.token === "string" ? payload.token : null);

        const user = await verifyExtensionToken(rawAuth);
        if (!user) {
          throw new Error("Token không hợp lệ hoặc đã hết hạn.");
        }

        const blocked = await recapUploadBlockReason(meetingId, user, payload);
        if (blocked) {
          throw new Error(blocked);
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
      onUploadCompleted: async () => {},
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tải được file lên.";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
}
