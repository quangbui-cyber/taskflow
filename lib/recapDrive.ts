import { DOCX_MIME, DriveNotConnectedError, GOOGLE_DOC_MIME_TYPE, driveConnected, uploadDriveFile } from "@/lib/googleDrive";
import { googleDocName, meetingRecapsFolder, projectYear, trashDriveFileSafe, ownerDocsFolder } from "@/lib/driveStorage";
import { ownerOrNull } from "./workOwner";
import { prisma } from "@/lib/prisma";
import { recapDocxFileName } from "@/lib/recapDocx";
import { publishedRecapDocx } from "@/lib/recapProject";
import { readPublishedRecap } from "@/lib/recapPublication";

/**
 * Biên bản của cuộc họp không gắn dự án lên Shared Drive thành Google Doc trong "Biên bản họp/<năm>".
 * File Word được dựng từ bản đã gửi ngay lúc đẩy lên, nên database không giữ file nào.
 * Gửi lại thì thay nội dung Doc cũ (giữ link). Cuộc họp được gắn dự án sau đó thì Doc này bị bỏ
 * vào thùng rác vì biên bản đã nằm trong tài liệu dự án.
 */
export async function pushMeetingRecapToDrive(meetingId: string): Promise<boolean> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      room: { select: { name: true } },
      organizer: { select: { name: true } },
      attendees: { select: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      recap: { select: { id: true, sentAt: true, publishedSnapshot: true, driveFileId: true, driveSyncedSentAt: true } },
    },
  });
  const recap = meeting?.recap;
  if (!meeting || !recap) return false;

  const owner = ownerOrNull(meeting);
  if (owner && owner.kind !== "CLIENT") {
    if (!recap.driveFileId) return false;
    await trashDriveFileSafe(recap.driveFileId);
    await prisma.meetingRecap.updateMany({
      where: { id: recap.id, driveFileId: recap.driveFileId },
      data: { driveFileId: null, driveSyncedSentAt: null },
    });
    return false;
  }

  const snapshot = readPublishedRecap(recap.publishedSnapshot);
  if (!recap.sentAt || !snapshot?.content.trim()) return false;
  if (recap.driveSyncedSentAt?.getTime() === recap.sentAt.getTime()) return false;

  const data = publishedRecapDocx(meeting, snapshot, recap.sentAt);
  const driveFileId = await uploadDriveFile({
    name: googleDocName(recapDocxFileName(meeting.title, meeting.startAt)),
    mimeType: DOCX_MIME,
    data,
    fileId: recap.driveFileId ?? undefined,
    parentId: recap.driveFileId ? undefined : owner && owner.kind !== "CLIENT" ? await ownerDocsFolder(owner) : await meetingRecapsFolder(projectYear(meeting.startAt)),
    convertTo: GOOGLE_DOC_MIME_TYPE,
  });
  // Chỉ đánh dấu đúng lần gửi đã đẩy; nếu vừa có lần gửi mới thì lượt sau đẩy tiếp.
  const saved = await prisma.meetingRecap.updateMany({
    where: { id: recap.id, sentAt: recap.sentAt },
    data: { driveFileId, driveSyncedSentAt: recap.sentAt },
  });
  if (saved.count === 0) await prisma.meetingRecap.updateMany({ where: { id: recap.id }, data: { driveFileId } });
  return saved.count > 0;
}

/** Không làm hỏng thao tác gửi khi Drive chưa kết nối hoặc Google lỗi; cron đêm sẽ đẩy lại. */
export async function pushMeetingRecapToDriveSafe(meetingId: string): Promise<void> {
  try {
    if (!(await driveConnected())) return;
    await pushMeetingRecapToDrive(meetingId);
  } catch (error) {
    if (!(error instanceof DriveNotConnectedError)) console.error("Could not save the meeting recap to Drive", error);
  }
}

/** Cron đêm: biên bản đã gửi mà Drive chưa có bản mới nhất, hoặc Doc cũ của họp vừa gắn dự án. */
export async function pushPendingMeetingRecaps(deadline: number): Promise<{ pushed: number; failed: number }> {
  const candidates = await prisma.meetingRecap.findMany({
    where: {
      sentAt: { not: null },
      OR: [{ meeting: { projectId: null } }, { driveFileId: { not: null } }],
    },
    select: { meetingId: true, sentAt: true, driveSyncedSentAt: true, driveFileId: true, meeting: { select: { projectId: true, opportunityId: true } } },
    orderBy: { sentAt: "desc" },
    take: 500,
  });
  const pending = candidates.filter((row) =>
    row.meeting.projectId || row.meeting.opportunityId ? Boolean(row.driveFileId) : row.driveSyncedSentAt?.getTime() !== row.sentAt?.getTime()
  );
  let pushed = 0;
  let failed = 0;
  for (const row of pending.slice(0, 50)) {
    if (Date.now() > deadline) break;
    try {
      if (await pushMeetingRecapToDrive(row.meetingId)) pushed += 1;
    } catch (error) {
      if (error instanceof DriveNotConnectedError) break;
      failed += 1;
      console.error("Drive nightly recap push failed", row.meetingId, error);
    }
  }
  return { pushed, failed };
}
