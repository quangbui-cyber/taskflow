import { head } from "@vercel/blob";
import { after } from "next/server";
import type { User } from "@prisma/client";
import { MEETING_RECAPS_DISABLED_MESSAGE, meetingRecapsEnabled } from "@/lib/features";
import {
  RECAP_MAX_AUDIO_BYTES,
  canManageMeetingRecap,
  isRecapAudioPathname,
  recapStartBlockReason,
} from "@/lib/meetingRecap";
import { findRecapMeeting, loadRecapUsage } from "@/lib/meetingRecapData";
import { estimateAudioSeconds, recapLimits, transcriptionLimitReason } from "@/lib/meetingRecapLimits";
import { deleteRecapAudio, runMeetingRecap } from "@/lib/meetingRecapJob";
import { prisma } from "@/lib/prisma";

export type StartRecapResult =
  | { success: true; recapId: string }
  | { success: false; error: string; status: number };

/**
 * Khởi chạy tiến trình chép lời và tóm tắt biên bản cuộc họp.
 * Dùng chung cho API trên web và API gọi từ Chrome Extension.
 */
export async function startMeetingRecapWorkflow({
  meetingId,
  user,
  pathname,
  fileName,
  durationSeconds,
}: {
  meetingId: string;
  user: Pick<User, "id" | "role">;
  pathname: string;
  fileName?: string | null;
  durationSeconds?: unknown;
}): Promise<StartRecapResult> {
  if (!meetingRecapsEnabled()) {
    return { success: false, error: MEETING_RECAPS_DISABLED_MESSAGE, status: 503 };
  }

  const cleanPathname = (pathname ?? "").trim();
  const cleanFileName = (fileName ?? "").trim().slice(0, 200);

  if (!isRecapAudioPathname(meetingId, cleanPathname)) {
    return { success: false, error: "File ghi âm không hợp lệ.", status: 400 };
  }

  const meeting = await findRecapMeeting(meetingId);
  const blocked = recapStartBlockReason(meeting, user);
  if (blocked || !meeting) {
    if (meeting && canManageMeetingRecap(meeting, user)) {
      await deleteRecapAudio(cleanPathname);
    }
    return { success: false, error: blocked ?? "Không tìm thấy cuộc họp.", status: 409 };
  }

  let audioSeconds: number;
  try {
    const blob = await head(cleanPathname);
    if (blob.size > RECAP_MAX_AUDIO_BYTES) {
      await deleteRecapAudio(cleanPathname);
      return { success: false, error: "File ghi âm vượt quá 100 MB.", status: 400 };
    }
    audioSeconds = estimateAudioSeconds(blob.size, durationSeconds);
  } catch {
    return { success: false, error: "Không tìm thấy file vừa tải lên. Thử tải lại.", status: 400 };
  }

  const limited = transcriptionLimitReason(
    recapLimits(),
    await loadRecapUsage(meetingId),
    audioSeconds
  );
  if (limited) {
    await deleteRecapAudio(cleanPathname);
    return { success: false, error: limited, status: 429 };
  }

  // Dọn file cũ còn sót
  const previousAudio = meeting.recap?.audioPathname;
  if (previousAudio && previousAudio !== cleanPathname) {
    await deleteRecapAudio(previousAudio);
  }

  const startedAt = new Date();
  const fresh = {
    status: "PROCESSING",
    stage: "TRANSCRIBING",
    error: null,
    audioName: cleanFileName || null,
    audioPathname: cleanPathname,
    audioSeconds: null,
    transcript: null,
    content: null,
    createdById: user.id,
    processingStartedAt: startedAt,
  };

  const recap = await prisma.meetingRecap.upsert({
    where: { meetingId },
    create: { meetingId, ...fresh },
    update: fresh,
    select: { id: true },
  });

  await prisma.meetingRecapRun.create({
    data: { meetingId, userId: user.id, kind: "TRANSCRIBE", audioSeconds },
  });

  after(async () => {
    try {
      await runMeetingRecap(recap.id, startedAt);
    } catch (error) {
      console.error("Meeting recap background task failed", error);
    }
  });

  return { success: true, recapId: recap.id };
}
