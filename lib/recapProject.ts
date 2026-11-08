import type { Prisma, PrismaClient } from "@prisma/client";
import { canManageMeetingRecap } from "./meetingRecap";
import { formatMeetingWhen } from "./meetings";
import { DOCX_MIME_TYPE, buildRecapDocx, recapDocxFileName } from "./recapDocx";
import { publishedRecapExport, readPublishedRecap, type PublishedRecap } from "./recapPublication";
import { lockRecap } from "./recapWorkflow";
import { ownerOrNull, ownerData, ownerWhere, type WorkOwner } from "./workOwner";
import { assertOwnerAccess } from "./taskAccess";

type Viewer = { id: string; role: string };

async function lockMeeting(tx: Prisma.TransactionClient, meetingId: string) {
  await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${meetingId} FOR UPDATE`;
}

type DocxMeeting = {
  title: string; startAt: Date; endAt: Date; room: { name: string } | null;
  organizer: { name: string }; attendees: { user: { name: string } }[];
};

/** File Word của bản biên bản đã gửi (dùng cho tài liệu dự án và thư mục Biên bản họp trên Drive). */
export function publishedRecapDocx(meeting: DocxMeeting, snapshot: PublishedRecap, sentAt: Date): Uint8Array<ArrayBuffer> {
  return buildRecapDocx({
    title: meeting.title, when: formatMeetingWhen(meeting.startAt, meeting.endAt),
    room: meeting.room?.name ?? null, organizer: meeting.organizer.name,
    attendees: meeting.attendees.map((row) => row.user.name),
    content: publishedRecapExport(snapshot), sentAt,
  });
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
  const owner = ownerOrNull(meeting);
  if (!owner || owner.kind === "CLIENT" || !recap?.sentAt) return false;
  // A delayed older send must not overwrite the latest published project file.
  if (expectedSentAt && expectedSentAt.getTime() !== recap.sentAt.getTime()) return false;
  const snapshot = publication ?? readPublishedRecap(recap.publishedSnapshot);
  if (!snapshot?.content.trim()) return false;
  const data = publishedRecapDocx(meeting, snapshot, recap.sentAt);
  const file = { name: recapDocxFileName(meeting.title, meeting.startAt), mimeType: DOCX_MIME_TYPE, size: data.length, data };
  const existing = recap.projectFileId ? await tx.projectFile.findFirst({
    where: { id: recap.projectFileId, ...ownerWhere(owner) }, select: { id: true },
  }) : null;
  const saved = existing
    // Bản mới ghi vào database; nếu đang đẩy bản cũ lên Drive thì lượt đó không được xoá bản mới.
    // Lần đẩy sau sẽ thay nội dung Google Doc cũ (giữ nguyên link).
    ? await tx.projectFile.update({ where: { id: existing.id }, data: { ...file, driveSyncStartedAt: null }, select: { id: true } })
    : await tx.projectFile.create({ data: { ...file, ...ownerData(owner), uploaderId: uploader.id }, select: { id: true } });
  await tx.meetingRecap.update({ where: { id: recap.id }, data: { projectFileId: saved.id } });
  return true;
}

export async function archivePublishedRecap(db: PrismaClient, meetingId: string, uploader: Viewer,
  publication?: PublishedRecap, expectedSentAt?: Date): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await lockMeeting(tx, meetingId);
    const meeting = await tx.meeting.findUnique({ where: { id: meetingId }, select: { projectId: true, opportunityId: true, clientId: true } });
    const owner = meeting ? ownerOrNull(meeting) : null;
    if (!owner || owner.kind === "CLIENT" || "error" in await assertOwnerAccess(tx, uploader, owner, "CREATE_TASK")) return false;
    return archiveRecap(tx, meetingId, uploader, publication, expectedSentAt);
  });
}

/** Linking and exporting are atomic. Task rows are never moved or changed here. */
export async function attachMeetingOwner(db: PrismaClient, meetingId: string, owner: WorkOwner, viewer: Viewer) {
  return db.$transaction(async (tx) => {
    await lockMeeting(tx, meetingId);
    const meeting = await tx.meeting.findUnique({
      where: { id: meetingId }, select: { organizerId: true, recorderId: true, projectId: true, opportunityId: true, clientId: true },
    });
    if (!meeting || !canManageMeetingRecap(meeting, viewer)) {
      return { error: "Chỉ người tổ chức, người ghi biên bản hoặc Admin được gắn dự án." };
    }
    const existing = ownerOrNull(meeting);
    if (existing && (existing.kind !== owner.kind || existing.id !== owner.id)) {
      return { error: "Cuộc họp đã được gắn vào nơi khác. Hãy tải lại trang." };
    }
    const access = await assertOwnerAccess(tx, viewer, owner, "CREATE_TASK");
    if ("error" in access) return access;
    const record = owner.kind === "PROJECT" ? await tx.project.findUniqueOrThrow({ where: { id: owner.id }, select: { name: true } }) : owner.kind === "OPPORTUNITY" ? await tx.opportunity.findUniqueOrThrow({ where: { id: owner.id }, select: { name: true } }) : await tx.client.findUniqueOrThrow({ where: { id: owner.id }, select: { name: true } });
    await tx.meeting.update({ where: { id: meetingId }, data: ownerData(owner) });
    const archived = owner.kind !== "CLIENT" && await archiveRecap(tx, meetingId, viewer);
    return { owner, ownerName: record.name, projectId: owner.kind === "PROJECT" ? owner.id : null, projectName: record.name, archived };
  });
}
export async function attachMeetingProject(db: PrismaClient, meetingId: string, projectId: string, viewer: Viewer) {
  const result = await attachMeetingOwner(db, meetingId, { kind: "PROJECT", id: projectId }, viewer);
  return "error" in result ? result : { ...result, projectId };
}
