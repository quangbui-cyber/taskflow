import type { Prisma, PrismaClient } from "@prisma/client";
import { canManageMeetingRecap } from "./meetingRecap";
import { formatMeetingWhen } from "./meetings";
import { DOCX_MIME_TYPE, buildRecapDocx, recapDocxFileName } from "./recapDocx";
import { publishedRecapExport, readPublishedRecap, type PublishedRecap } from "./recapPublication";
import { lockRecap } from "./recapWorkflow";

type Viewer = { id: string; role: string };

async function lockMeeting(tx: Prisma.TransactionClient, meetingId: string) {
  await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${meetingId} FOR UPDATE`;
}

/** Caller holds the meeting lock. Store only a published version, even while AI is rewriting. */
async function archiveRecap(tx: Prisma.TransactionClient, meetingId: string, uploader: Viewer,
  publication?: PublishedRecap, expectedSentAt?: Date): Promise<boolean> {
  const recapRef = await tx.meetingRecap.findUnique({ where: { meetingId }, select: { id: true } });
  if (!recapRef) return false;
  await lockRecap(tx, recapRef.id);
  const meeting = await tx.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: {
      room: { select: { name: true } }, organizer: { select: { name: true } },
      attendees: { select: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      recap: { select: { id: true, sentAt: true, publishedSnapshot: true, projectFileId: true } },
    },
  });
  const recap = meeting.recap;
  if (!meeting.projectId || !recap?.sentAt) return false;
  // A delayed older send must not overwrite the latest published project file.
  if (expectedSentAt && expectedSentAt.getTime() !== recap.sentAt.getTime()) return false;
  const snapshot = publication ?? readPublishedRecap(recap.publishedSnapshot);
  if (!snapshot?.content.trim()) return false;
  const data = buildRecapDocx({
    title: meeting.title, when: formatMeetingWhen(meeting.startAt, meeting.endAt),
    room: meeting.room?.name ?? null, organizer: meeting.organizer.name,
    attendees: meeting.attendees.map((row) => row.user.name),
    content: publishedRecapExport(snapshot), sentAt: recap.sentAt,
  });
  const file = { name: recapDocxFileName(meeting.title, meeting.startAt), mimeType: DOCX_MIME_TYPE, size: data.length, data };
  const existing = recap.projectFileId ? await tx.projectFile.findFirst({
    where: { id: recap.projectFileId, projectId: meeting.projectId }, select: { id: true },
  }) : null;
  const saved = existing
    ? await tx.projectFile.update({ where: { id: existing.id }, data: file, select: { id: true } })
    : await tx.projectFile.create({ data: { ...file, projectId: meeting.projectId, uploaderId: uploader.id }, select: { id: true } });
  await tx.meetingRecap.update({ where: { id: recap.id }, data: { projectFileId: saved.id } });
  return true;
}

export async function archivePublishedRecap(db: PrismaClient, meetingId: string, uploader: Viewer,
  publication?: PublishedRecap, expectedSentAt?: Date): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await lockMeeting(tx, meetingId);
    const meeting = await tx.meeting.findUnique({ where: { id: meetingId }, select: { projectId: true } });
    if (!meeting?.projectId) return false;
    if (uploader.role !== "ADMIN" && !await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: meeting.projectId, userId: uploader.id } }, select: { id: true },
    })) return false;
    return archiveRecap(tx, meetingId, uploader, publication, expectedSentAt);
  });
}

/** Linking and exporting are atomic. Task rows are never moved or changed here. */
export async function attachMeetingProject(db: PrismaClient, meetingId: string, projectId: string, viewer: Viewer) {
  return db.$transaction(async (tx) => {
    await lockMeeting(tx, meetingId);
    const meeting = await tx.meeting.findUnique({
      where: { id: meetingId }, select: { organizerId: true, recorderId: true, projectId: true },
    });
    if (!meeting || !canManageMeetingRecap(meeting, viewer)) {
      return { error: "Chỉ người tổ chức, người ghi biên bản hoặc Admin được gắn dự án." };
    }
    if (meeting.projectId && meeting.projectId !== projectId) {
      return { error: "Cuộc họp đã được gắn vào dự án khác. Hãy tải lại trang." };
    }
    const project = await tx.project.findFirst({
      where: { id: projectId, ...(viewer.role === "ADMIN" ? {} : { members: { some: { userId: viewer.id } } }) },
      select: { id: true, name: true },
    });
    if (!project) return { error: "Dự án không tồn tại hoặc bạn không có quyền truy cập." };
    await tx.meeting.update({ where: { id: meetingId }, data: { projectId: project.id } });
    const archived = await archiveRecap(tx, meetingId, viewer);
    return { projectId: project.id, projectName: project.name, archived };
  });
}
