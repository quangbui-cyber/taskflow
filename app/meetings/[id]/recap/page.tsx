import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, DoorOpen, FileText, FolderKanban, Users } from "lucide-react";
import MeetingRecapPanel from "@/components/MeetingRecapPanel";
import MeetingProjectLink from "@/components/MeetingProjectLink";
import RecapActionItems, { type RecapActionItemView } from "@/components/RecapActionItems";
import Sidebar from "@/components/Sidebar";
import MeetingDraftTouchpoint from "@/components/crm/MeetingDraftTouchpoint";
import { requireUser } from "@/lib/auth";
import { meetingRecapsEnabled, meetingsEnabled } from "@/lib/features";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmOwnerTargets } from "@/lib/crm/ownerTargets";
import { loadClientResource, loadCrmActor } from "@/lib/crm/actor";
import { loadTouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import { loadMeetingDraftForViewer } from "@/lib/crm/meetingDrafts";
import { crmCan } from "@/lib/crm/policy";
import { ownerOrNull, ownerHref } from "@/lib/workOwner";
import {
  canManageMeetingRecap,
  meetingRecorderId,
  canOpenMeetingRecap,
  canReadMeetingRecap,
  isRecapStale,
  recapExportContent,
  recapStartBlockReason,
} from "@/lib/meetingRecap";
import { recapActionOrder, toRecapActionExport } from "@/lib/meetingRecapData";
import { publishedActionProgress, publishedRecapExport, readPublishedRecap, readRecapSuggestions, toRecapActionView } from "@/lib/recapPublication";
import { readGlossarySuggestions } from "@/lib/recapGlossary";
import { recapLimits } from "@/lib/meetingRecapLimits";
import { formatHour } from "@/lib/dates";
import { formatMeetingWhen } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";

// Các thao tác "Viết lại" chạy nền sau khi trả lời; cho phép tới 300 giây.
export const maxDuration = 300;

export default async function MeetingRecapPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ record?: string }>;
}) {
  const user = await requireUser();
  if (!meetingsEnabled()) redirect("/");
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      room: { select: { name: true } },
      project: { select: { id: true, name: true } },
      opportunity: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      organizer: { select: { id: true, name: true, avatarUrl: true } },
      attendees: {
        select: { userId: true, user: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: "asc" },
      },
      recapRecipients: { select: { userId: true } },
      recap: {
        include: {
          actionItems: {
            orderBy: recapActionOrder,
            include: {
              owner: { select: { id: true, name: true, avatarUrl: true } },
              task: { select: { id: true, status: true, projectId: true, opportunityId: true, clientId: true, project: { select: { name: true } }, opportunity: { select: { name: true } }, client: { select: { name: true } } } },
            },
          },
        },
      },
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
  const owner = ownerOrNull(meeting);
  const ownerName = meeting.project?.name ?? meeting.opportunity?.name ?? meeting.client?.name;
  const ownerLabel = owner?.kind === "CLIENT" ? "Khách hàng" : owner?.kind === "OPPORTUNITY" ? "Cơ hội" : "Dự án";
  const crmOn = await crmAllowed(user);
  const recap = meeting.recap;
  const readable = canReadMeetingRecap(meeting, recap, user);
  const canSeeDraft = Boolean(recap?.sentAt) && (canManage || readable) && (owner?.kind === "CLIENT" || owner?.kind === "OPPORTUNITY");
  const crmActor = crmOn && (canManage || canSeeDraft) ? await loadCrmActor(user) : null;
  const crmTargets = canManage && crmActor ? await loadCrmOwnerTargets(prisma, crmActor) : { opportunities: [], clients: [] };
  const canCreateOwnerTask = !owner || (owner.kind === "PROJECT" ? user.role === "ADMIN" || sidebarProjects.some((project) => project.id === owner.id) : owner.kind === "CLIENT" ? crmTargets.clients.some((client) => client.id === owner.id) : crmTargets.opportunities.some((opportunity) => opportunity.id === owner.id));
  const draft = canSeeDraft && crmActor ? await loadMeetingDraftForViewer(prisma, {
    meetingId: meeting.id, meetingTitle: meeting.title, canSee: canSeeDraft, actor: crmActor,
  }) : null;
  const draftOptions = draft?.canConfirm && crmActor
    ? await loadTouchpointDialogOptions(prisma, crmActor, { clientId: draft.clientId })
    : null;
  // The existing dismiss action always checks Client rights, independent of Opportunity assignment.
  const draftClient = draft?.opportunityId ? await loadClientResource(prisma, draft.clientId) : null;
  const canDismissDraft = draft?.opportunityId
    ? Boolean(crmActor && draftClient && crmCan(crmActor, "LOG_TOUCHPOINT", draftClient))
    : draft?.canConfirm ?? false;
  const startBlock = recapStartBlockReason(meeting, user, now);

  const recorderId = meetingRecorderId(meeting);
  const recorderName =
    recorderId === meeting.organizerId
      ? meeting.organizer.name
      : meeting.attendees.find((attendee) => attendee.userId === recorderId)?.user.name;

  const people = [meeting.organizer, ...meeting.attendees.map((attendee) => attendee.user)].filter(
    (person, index, all) => all.findIndex((other) => other.id === person.id) === index
  );
  const sendDirectory = canManage
    ? await prisma.user.findMany({
        where: { isActive: true, id: { notIn: people.map((person) => person.id) } },
        select: { id: true, name: true, email: true, avatarUrl: true },
        orderBy: { name: "asc" },
      })
    : [];
  const publication = readPublishedRecap(recap?.publishedSnapshot);
  const liveItems = (recap?.actionItems ?? []).map(toRecapActionView);
  const actionItems: RecapActionItemView[] = canManage ? liveItems
    : publication && readable ? publishedActionProgress(publication, liveItems) : [];
  const visibleContent = canManage ? recap?.content : readable ? publication?.content : null;
  // Dự án để tạo task: dự án của cuộc họp (nếu có) đứng đầu, rồi các dự án mình là thành viên.
  const taskProjects = canManage
    ? [
        ...(meeting.project ? [meeting.project] : []),
        ...sidebarProjects
          .filter((project) => project.id !== meeting.project?.id && !["DONE", "CANCEL", "FAIL"].includes(project.status))
          .map((project) => ({ id: project.id, name: project.name })),
      ]
    : [];
  const showContent = Boolean(readable && visibleContent?.trim());
  const linkableProjects = canManage && !owner
    ? user.role === "ADMIN"
      ? await prisma.project.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: "asc" } })
      : sidebarProjects.map(({ id, name, status }) => ({ id, name, status }))
    : [];

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
                <dd>{meeting.room?.name ?? "Không dùng phòng"} · {meeting.organizer.name} tổ chức
                  {recorderName ? ` · ${recorderName} ghi biên bản` : ""}
                </dd>
              </div>
              {owner && ownerName && (
                <div className="flex items-center gap-2">
                  <FolderKanban size={15} className="shrink-0 text-zinc-400" aria-hidden="true" />
                  <dt className="sr-only">{ownerLabel}</dt>
                  <dd>
                    {ownerLabel}{" "}
                    <Link href={ownerHref(owner)} className="font-semibold text-brand-700 hover:underline">
                      {ownerName}
                    </Link>{" "}
                  </dd>
                </div>
              )}
              <div className="flex items-start gap-2">
                <Users size={15} className="mt-0.5 shrink-0 text-zinc-400" aria-hidden="true" />
                <dt className="sr-only">Người tham dự</dt>
                <dd>{meeting.attendees.map((attendee) => attendee.user.name).join(", ") || "Chưa mời ai"}</dd>
              </div>
            </dl>
          </header>

          {draft && <MeetingDraftTouchpoint key={draft.draftId} view={draft} options={draftOptions} canDismiss={canDismissDraft} />}

          {canManage && !owner && (
            <MeetingProjectLink meetingId={meeting.id} projects={linkableProjects} crmTargets={crmTargets} crmOn={crmOn} />
          )}

          <MeetingRecapPanel
            meetingId={meeting.id}
            meetingTitle={meeting.title}
            meetingWhen={formatMeetingWhen(meeting.startAt, meeting.endAt)}
            sendPeople={people}
            sendDirectory={sendDirectory}
            glossarySuggestions={canManage ? readGlossarySuggestions(recap?.glossarySuggestions) : []}
            sendExtraIds={meeting.recapRecipients.map((row) => row.userId)}
            canManage={canManage}
            enabled={meetingRecapsEnabled()}
            startBlock={startBlock}
            earlyNote={
              meeting.startAt.getTime() > now.getTime()
                ? `Chưa đến giờ họp (${formatHour(meeting.startAt)}). Bạn vẫn có thể bắt đầu ghi ngay khi cuộc họp bắt đầu.`
                : null
            }
            cancelled={meeting.status === "CANCELLED"}
            maxAudioMinutes={recapLimits().maxAudioMinutes}
            meetingUrl={canManage ? meeting.meetingUrl : null}
            meetingEndsAt={meeting.endAt.toISOString()}
            // Mở từ thông báo "cuộc họp đã bắt đầu": ghi âm ngay.
            autoStart={query.record === "1" && canManage && !recap}
            actionItems={
              showContent ? (
                <RecapActionItems
                  meetingId={meeting.id}
                  items={actionItems}
                  people={people}
                  projects={taskProjects}
                  defaultProjectId={meeting.project?.id ?? null}
                  defaultOwner={owner ?? undefined}
                  canCreateTasks={canCreateOwnerTask}
                  viewerId={user.id}
                  canManage={canManage}
                  editable={canManage && recap?.status === "READY"}
                  suggestions={canManage ? readRecapSuggestions(recap?.actionSuggestions) : []}
                />
              ) : null
            }
            copyText={
              showContent && visibleContent && recap
                ? canManage ? recapExportContent(visibleContent, recap.actionItems.map(toRecapActionExport))
                  : publication ? publishedRecapExport(publication) : null
                : null
            }
            recap={
              recap
                ? {
                    status: canManage ? recap.status : publication ? "READY" : "DRAFT",
                    stage: canManage ? recap.stage : null,
                    error: canManage ? recap.error : null,
                    content: visibleContent ?? null,
                    transcript: canManage ? recap.transcript : null,
                    audioName: canManage ? recap.audioName : null,
                    audioSeconds: canManage ? recap.audioSeconds : null,
                    sentAt: recap.sentAt?.toISOString() ?? null,
                    savedToProject: Boolean(meeting.projectId && recap.projectFileId),
                    updatedAt: (canManage ? recap.updatedAt : recap.sentAt ?? meeting.createdAt).toISOString(),
                    stale: canManage && isRecapStale(recap, now),
                  }
                : null
            }
          />
        </div>
      </main>
    </div>
  );
}
