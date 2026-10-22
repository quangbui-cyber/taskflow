"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { MEETING_RECAPS_DISABLED_MESSAGE, meetingRecapsEnabled } from "@/lib/features";
import { canManageMeetingRecap, isRecapStale, normalizeRecapContent } from "@/lib/meetingRecap";
import { findRecapMeeting } from "@/lib/meetingRecapData";
import { deleteRecapAudio, runMeetingRecap } from "@/lib/meetingRecapJob";
import { sendMeetingRecapEmail } from "@/lib/meetingRecapMail";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";

export type MeetingRecapActionState = { error?: string; success?: string };

async function loadManaged(meetingId: string) {
  const user = await requireUser();
  const meeting = await findRecapMeeting(meetingId);
  if (!meeting || !canManageMeetingRecap(meeting, user)) {
    return { error: "Chỉ người tổ chức hoặc quản trị viên mới làm được việc này." } as const;
  }
  return { user, meeting } as const;
}

function refresh(meetingId: string) {
  revalidatePath(`/meetings/${meetingId}/recap`);
  revalidatePath("/meetings");
}

/** Viết lại biên bản từ bản chép lời đã có (không chép lời lại). */
export async function regenerateMeetingRecap(meetingId: string): Promise<MeetingRecapActionState> {
  if (!meetingRecapsEnabled()) return { error: MEETING_RECAPS_DISABLED_MESSAGE };
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const recap = loaded.meeting.recap;
  if (!recap?.transcript) return { error: "Chưa có bản chép lời. Hãy tải file ghi âm lên." };
  if (recap.status === "PROCESSING" && !isRecapStale(recap)) {
    return { error: "Biên bản đang được xử lý. Đợi xong rồi thử lại." };
  }

  const startedAt = new Date();
  await prisma.meetingRecap.update({
    where: { id: recap.id },
    data: {
      status: "PROCESSING",
      stage: "SUMMARIZING",
      error: null,
      processingStartedAt: startedAt,
      createdById: loaded.user.id,
    },
  });
  after(() => runMeetingRecap(recap.id, startedAt));
  refresh(meetingId);
  return { success: "Đang viết lại biên bản…" };
}

export async function saveMeetingRecapContent(
  meetingId: string,
  content: string
): Promise<MeetingRecapActionState> {
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const recap = loaded.meeting.recap;
  if (!recap || recap.status !== "READY") return { error: "Biên bản chưa sẵn sàng để sửa." };
  const value = normalizeRecapContent(content);
  if (!value) return { error: "Biên bản không được để trống." };

  await prisma.meetingRecap.update({ where: { id: recap.id }, data: { content: value } });
  refresh(meetingId);
  return { success: "Đã lưu biên bản." };
}

/** Gửi biên bản: người tham dự xem được trong app, nhận thông báo và email. */
export async function sendMeetingRecap(meetingId: string): Promise<MeetingRecapActionState> {
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const { meeting, user } = loaded;
  const recap = meeting.recap;
  if (!recap || recap.status !== "READY" || !recap.content?.trim()) {
    return { error: "Biên bản chưa sẵn sàng để gửi." };
  }

  await prisma.meetingRecap.update({ where: { id: recap.id }, data: { sentAt: new Date() } });
  const recipients = await prisma.meetingAttendee.findMany({
    where: { meetingId, response: { not: "DECLINED" }, user: { isActive: true } },
    select: { userId: true },
  });
  const recipientIds = [meeting.organizerId, ...recipients.map((row) => row.userId)].filter(
    (id) => id !== user.id
  );
  await notify(recipientIds, {
    type: "MEETING_RECAP_SHARED",
    message: `Đã có biên bản họp “${meeting.title}”.`,
    meetingId,
  });
  after(async () => {
    const result = await sendMeetingRecapEmail(meetingId);
    if (!result.ok && result.error !== "Chưa cấu hình email.") {
      console.warn("Meeting recap email could not be sent.");
    }
  });
  refresh(meetingId);
  return {
    success: recipientIds.length
      ? `Đã gửi biên bản cho ${recipientIds.length} người.`
      : "Đã lưu biên bản. Cuộc họp không có người tham dự nào khác.",
  };
}

export async function deleteMeetingRecap(meetingId: string): Promise<MeetingRecapActionState> {
  const loaded = await loadManaged(meetingId);
  if ("error" in loaded) return { error: loaded.error };
  const recap = loaded.meeting.recap;
  if (!recap) return { success: "Đã xoá biên bản." };

  await deleteRecapAudio(recap.audioPathname);
  await prisma.meetingRecap.delete({ where: { id: recap.id } });
  refresh(meetingId);
  return { success: "Đã xoá biên bản." };
}
