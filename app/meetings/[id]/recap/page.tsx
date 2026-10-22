import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, DoorOpen, FileText, Users } from "lucide-react";
import MeetingRecapPanel from "@/components/MeetingRecapPanel";
import Sidebar from "@/components/Sidebar";
import { requireUser } from "@/lib/auth";
import { meetingRecapsEnabled, meetingsEnabled } from "@/lib/features";
import {
  canManageMeetingRecap,
  canOpenMeetingRecap,
  canReadMeetingRecap,
  isRecapStale,
  recapStartBlockReason,
} from "@/lib/meetingRecap";
import { recapLimits } from "@/lib/meetingRecapLimits";
import { formatMeetingWhen } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";

// Các thao tác "Viết lại" chạy nền sau khi trả lời; cho phép tới 300 giây.
export const maxDuration = 300;

export default async function MeetingRecapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!meetingsEnabled()) redirect("/");
  const { id } = await params;

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      room: { select: { name: true } },
      organizer: { select: { id: true, name: true } },
      attendees: {
        select: { userId: true, user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      },
      recap: true,
    },
  });
  if (!meeting || !canOpenMeetingRecap(meeting, user)) redirect("/meetings");

  const sidebarProjects = await prisma.project.findMany({
    where: { members: { some: { userId: user.id } } },
    select: {
      id: true,
      name: true,
      color: true,
      status: true,
      category: true,
      responsibleTeam: { select: { id: true, name: true } },
      responsibleGroup: { select: { id: true, name: true } },
      account: { select: { team: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();
  const canManage = canManageMeetingRecap(meeting, user);
  const recap = meeting.recap;
  const readable = canReadMeetingRecap(meeting, recap, user);
  const startBlock = recapStartBlockReason(meeting, user, now);

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="meetings" />
      <main className="tf-main">
        <div className="tf-page-narrow space-y-5">
          <Link
            href={`/meetings?focus=${meeting.id}#meeting-${meeting.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Lịch họp
          </Link>

          <header>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
                <FileText size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Biên bản họp</p>
                <h1 className="tf-page-title !mt-0 break-words">{meeting.title}</h1>
              </div>
            </div>
            <dl className="mt-3 grid gap-1.5 text-sm text-zinc-600">
              <div className="flex gap-2">
                <dt className="sr-only">Thời gian</dt>
                <dd>{formatMeetingWhen(meeting.startAt, meeting.endAt)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <DoorOpen size={15} className="shrink-0 text-zinc-400" aria-hidden="true" />
                <dt className="sr-only">Phòng họp</dt>
                <dd>{meeting.room?.name ?? "Không dùng phòng"} · {meeting.organizer.name} tổ chức</dd>
              </div>
              <div className="flex items-start gap-2">
                <Users size={15} className="mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" />
                <dt className="sr-only">Người tham dự</dt>
                <dd>{meeting.attendees.map((attendee) => attendee.user.name).join(", ") || "Chưa mời ai"}</dd>
              </div>
            </dl>
          </header>

          <MeetingRecapPanel
            meetingId={meeting.id}
            canManage={canManage}
            enabled={meetingRecapsEnabled()}
            startBlock={startBlock}
            cancelled={meeting.status === "CANCELLED"}
            maxAudioMinutes={recapLimits().maxAudioMinutes}
            recap={
              recap
                ? {
                    status: recap.status,
                    stage: recap.stage,
                    error: recap.error,
                    content: readable ? recap.content : null,
                    transcript: canManage ? recap.transcript : null,
                    audioName: canManage ? recap.audioName : null,
                    audioSeconds: recap.audioSeconds,
                    sentAt: recap.sentAt?.toISOString() ?? null,
                    updatedAt: recap.updatedAt.toISOString(),
                    stale: isRecapStale(recap, now),
                  }
                : null
            }
          />
        </div>
      </main>
    </div>
  );
}
