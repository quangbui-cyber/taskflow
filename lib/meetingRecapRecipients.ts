import { prisma } from "@/lib/prisma";

export type RecapRecipient = { id: string; name: string; email: string };

export const RECAP_EXTRA_RECIPIENTS_MAX = 50;

/**
 * Người sẽ nhận biên bản: người tổ chức và người được mời (trừ người đã từ chối hoặc bị bỏ chọn)
 * cộng những người nhận thêm. Chỉ lấy tài khoản còn hoạt động.
 */
export async function resolveRecapRecipients(
  meetingId: string,
  options: { skipUserIds?: string[]; extraUserIds?: string[] } = {}
): Promise<RecapRecipient[]> {
  const skip = new Set(options.skipUserIds ?? []);
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      organizer: { select: { id: true, name: true, email: true, isActive: true } },
      attendees: {
        where: { user: { isActive: true }, response: { not: "DECLINED" } },
        select: { user: { select: { id: true, name: true, email: true } } },
      },
      recapRecipients: {
        where: { user: { isActive: true } },
        select: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!meeting) return [];

  const people = new Map<string, RecapRecipient>();
  const add = (user: RecapRecipient) => {
    if (!skip.has(user.id)) people.set(user.id, user);
  };
  if (meeting.organizer.isActive) add(meeting.organizer);
  for (const row of meeting.attendees) add(row.user);
  const extraIds = options.extraUserIds ? new Set(options.extraUserIds) : null;
  for (const row of meeting.recapRecipients) {
    if (!extraIds || extraIds.has(row.user.id)) add(row.user);
  }
  return [...people.values()];
}

/** Đồng bộ danh sách người nhận thêm với lựa chọn trong hộp thoại gửi. Trả về số người sau khi lưu. */
export async function syncRecapRecipients(
  meetingId: string,
  extraUserIds: string[],
  addedById: string
): Promise<{ ok: true; userIds: string[] } | { ok: false; error: string }> {
  const wanted = [...new Set(extraUserIds)];
  if (wanted.length > RECAP_EXTRA_RECIPIENTS_MAX) {
    return { ok: false, error: `Chỉ thêm tối đa ${RECAP_EXTRA_RECIPIENTS_MAX} người nhận.` };
  }
  const [meeting, users] = await Promise.all([
    prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { organizerId: true, attendees: { select: { userId: true } } },
    }),
    prisma.user.findMany({ where: { id: { in: wanted }, isActive: true }, select: { id: true } }),
  ]);
  if (!meeting) return { ok: false, error: "Cuộc họp không tồn tại." };
  if (users.length !== wanted.length) return { ok: false, error: "Có người nhận không còn hoạt động. Hãy chọn lại." };

  const alreadyIn = new Set([meeting.organizerId, ...meeting.attendees.map((row) => row.userId)]);
  const userIds = wanted.filter((id) => !alreadyIn.has(id));
  await prisma.$transaction([
    prisma.meetingRecapRecipient.deleteMany({ where: { meetingId, userId: { notIn: userIds } } }),
    ...(userIds.length
      ? [
          prisma.meetingRecapRecipient.createMany({
            data: userIds.map((userId) => ({ meetingId, userId, addedById })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
  return { ok: true, userIds };
}
