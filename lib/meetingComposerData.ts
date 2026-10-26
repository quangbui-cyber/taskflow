import type {
  MeetingGroupOption,
  MeetingPerson,
  MeetingRoomOption,
  PersonSchedule,
  RoomBooking,
} from "@/components/MeetingComposer";
import { isEmailConfigured } from "@/lib/email";
import { prisma } from "@/lib/prisma";

export type MeetingComposerData = {
  people: MeetingPerson[];
  rooms: MeetingRoomOption[];
  groups: MeetingGroupOption[];
  bookings: RoomBooking[];
  schedules: PersonSchedule[];
  emailEnabled: boolean;
};

/**
 * Dữ liệu cho form đặt lịch họp: người mời được, phòng, nhóm, phòng đã bị giữ
 * và lịch bận của từng người. Dùng chung cho trang Lịch họp và trang dự án.
 */
export async function loadMeetingComposerData(now = new Date()) {
  const [people, rooms, groups, upcomingMeetings] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, avatarUrl: true },
      orderBy: { name: "asc" },
    }),
    prisma.meetingRoom.findMany({
      where: { isActive: true },
      select: { id: true, name: true, capacity: true },
      orderBy: { name: "asc" },
    }),
    prisma.memberGroup.findMany({
      select: { id: true, name: true, members: { select: { userId: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.meeting.findMany({
      where: { status: "SCHEDULED", endAt: { gte: now } },
      select: {
        id: true,
        roomId: true,
        startAt: true,
        endAt: true,
        title: true,
        organizer: { select: { id: true, name: true } },
        attendees: {
          where: { response: { not: "DECLINED" } },
          select: { userId: true },
        },
      },
      orderBy: { startAt: "asc" },
      take: 500,
    }),
  ]);

  const roomBookings = upcomingMeetings.filter((meeting) => meeting.roomId !== null);
  const composerProps: MeetingComposerData = {
    people,
    rooms,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      memberIds: group.members.map((member) => member.userId),
    })),
    bookings: roomBookings.map((booking) => ({
      meetingId: booking.id,
      roomId: booking.roomId!,
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      title: booking.title,
      organizerName: booking.organizer.name,
    })),
    // Ai đang bận lúc nào — chỉ gửi khung giờ, không gửi tiêu đề cuộc họp của người khác.
    schedules: upcomingMeetings.map((meeting) => ({
      meetingId: meeting.id,
      startAt: meeting.startAt.toISOString(),
      endAt: meeting.endAt.toISOString(),
      userIds: [meeting.organizer.id, ...meeting.attendees.map((attendee) => attendee.userId)],
    })),
    emailEnabled: isEmailConfigured(),
  };

  return { composerProps, rooms, roomBookings };
}
