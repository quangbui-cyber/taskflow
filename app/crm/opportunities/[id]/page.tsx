import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import TaskListItem from "@/components/TaskListItem";
import NewTaskInline from "@/components/NewTaskInline";
import CrmTaskDialog from "@/components/crm/CrmTaskDialog";
import TouchpointDialog from "@/components/crm/TouchpointDialog";
import OutcomeDots from "@/components/crm/OutcomeDots";
import OpportunityFilesPanel from "@/components/crm/OpportunityFilesPanel";
import OpportunityStepper from "@/components/crm/OpportunityStepper";
import OpportunityNextStep from "@/components/crm/OpportunityNextStep";
import OpportunityHeaderActions from "@/components/crm/OpportunityHeaderActions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled, meetingsEnabled } from "@/lib/features";
import { loadCrmActor, loadOpportunityResource } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { loadOpportunityDetail } from "@/lib/crm/opportunityDetail";
import { loadTouchpointDialogOptions, loadOpportunityEditDialogOptions } from "@/lib/crm/dialogOptions";
import { listReasons } from "@/lib/crm/settings";
import { winPreview } from "@/lib/crm/opportunityWin";
import { describeStageEvent } from "@/lib/crm/opportunityStepper";
import { OPPORTUNITY_STAGES, OPPORTUNITY_OUTCOMES, OPPORTUNITY_SOURCES, EVENT_SOURCES, TOUCHPOINT_KINDS } from "@/lib/crm/labels";
import { formatCrmDate, vnDateKey } from "@/lib/crm/dates";
import { formatBudgetRange, formatCompactVnd } from "@/lib/crm/opportunityFormat";
import { assertTaskAccess } from "@/lib/taskAccess";
import { toTaskOwnerDisplay } from "@/lib/taskQueries";
import { storedFileDriveUrl } from "@/lib/storedFileResponse";
import { parseCommentMentions } from "@/lib/commentMentions";
import type { TaskDTO } from "@/lib/types";

export default async function OpportunityPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!crmEnabled()) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const now = new Date();
  const detail = await loadOpportunityDetail(prisma, id, now);
  if (!detail) notFound();
  const [actor, resource] = await Promise.all([loadCrmActor(user), loadOpportunityResource(prisma, id)]);
  if (!resource || !crmCan(actor, "VIEW", resource)) notFound();
  const canEdit = crmCan(actor, "EDIT", resource);
  const canAssign = crmCan(actor, "ASSIGN", resource);
  const canLog = crmCan(actor, "LOG_TOUCHPOINT", resource);
  const closed = detail.outcome !== null;
  const [options, projects, users, reasons, preview, editOptions, teams] = await Promise.all([
    loadTouchpointDialogOptions(prisma, actor, { clientId: detail.client.id }),
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
    prisma.user.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true, email: true, avatarUrl: true }, orderBy: { name: "asc" } }),
    !closed ? listReasons(prisma) : [],
    !closed && detail.stage === "BIDDING" ? winPreview(prisma, id) : null,
    !closed && canEdit ? loadOpportunityEditDialogOptions(prisma, actor, id) : null,
    !closed ? prisma.salesTeam.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const base = `/crm/opportunities/${id}`;
  const members = users.map(person => ({ userId: person.id, role: "MEMBER", user: person }));
  const nextTask = detail.tasks.find(task => task.id === detail.nextStep?.taskId);
  const canComplete = !closed && !!nextTask && crmCan(actor, "LOG_TOUCHPOINT", { kind: "TASK", owner: resource, assigneeId: nextTask.assigneeId, creatorId: nextTask.creatorId });
  const canHeaderLog = closed ? options.clients.some(c => c.canLogClient) : canLog || options.clients.some(c => c.assignedTasks.some(task => task.opportunityId === id));
  // A task query must belong to this exact work projection and pass its current owner's access check.
  const requested = typeof sp.task === "string" && sp.task.length <= 64 ? detail.tasks.find(task => task.id === sp.task) : null;
  const access = requested ? await assertTaskAccess(prisma, user, requested.id, "VIEW") : null;
  const selectedTask = requested && access && "task" in access ? await prisma.task.findFirst({
    where: { id: requested.id, ...(detail.outcome === "WON" ? { sourceOpportunityId: id, projectId: detail.project?.id ?? "__none__" } : { opportunityId: id }) },
    include: {
      creator: { select: { id: true, name: true, avatarUrl: true } },
      comments: { include: { author: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { createdAt: "asc" } },
      followers: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      files: { select: { id: true, kind: true, name: true, mimeType: true, size: true, createdAt: true, driveFileId: true, uploader: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
  }) : null;
  const task: TaskDTO | null = selectedTask ? {
    id: selectedTask.id,
    title: selectedTask.title,
    description: selectedTask.description,
    result: selectedTask.result,
    status: selectedTask.status,
    priority: selectedTask.priority,
    startDate: selectedTask.startDate?.toISOString() ?? null, dueDate: selectedTask.dueDate?.toISOString() ?? null, order: selectedTask.order, assigneeId: selectedTask.assigneeId, creator: selectedTask.creator,
    completedAt: selectedTask.completedAt?.toISOString() ?? null, createdAt: selectedTask.createdAt.toISOString(), updatedAt: selectedTask.updatedAt.toISOString(),
    comments: selectedTask.comments.map(comment => ({ id: comment.id, body: comment.body, mentions: parseCommentMentions(comment.mentions, comment.body), createdAt: comment.createdAt.toISOString(), author: comment.author })),
    followers: selectedTask.followers.map(follower => follower.user),
    files: selectedTask.files.map(file => ({ id: file.id, kind: file.kind === "RESULT" ? "RESULT" : "BRIEF", name: file.name, mimeType: file.mimeType, size: file.size, createdAt: file.createdAt.toISOString(), driveUrl: storedFileDriveUrl(file), uploader: file.uploader })),
  } : null;
  const badge = detail.outcome ? OPPORTUNITY_OUTCOMES.find(row => row.key === detail.outcome) : OPPORTUNITY_STAGES.find(row => row.key === detail.stage);
  const actionOpportunity = {
    id, name: detail.name, version: detail.version, stage: detail.stage, outcome: detail.outcome, clientId: detail.client.id,
    budgetMin: detail.budgetMin, budgetMax: detail.budgetMax, picUserId: detail.pic?.userId ?? null,
    picAccountId: detail.picAccountId, responsibleTeamId: detail.responsibleTeamId, buyingUnitId: detail.buyingUnitId,
    programTypeCode: detail.programTypeCode, expectedYear: detail.expectedYear, expectedMonth: detail.expectedMonth, expectedQuarter: detail.expectedQuarter,
    source: detail.source, demandSignal: detail.demandSignal, briefSummary: detail.briefSummary, winStrategy: detail.winStrategy,
    proposalDueAt: detail.proposalDueAt ? vnDateKey(detail.proposalDueAt) : null, proposalPlannedAt: detail.proposalPlannedAt ? vnDateKey(detail.proposalPlannedAt) : null,
  };
  const eventSource = EVENT_SOURCES.find(row => row.key === detail.expectedEventSource);
  const date = (value: Date | null) => value ? formatCrmDate(value, now) : "-";
  const info: [string, string | null][] = [
    ["Loại chương trình", detail.programTypeLabel], ["Đơn vị mua", detail.buyingUnitName],
    ["Ngân sách dự kiến", formatBudgetRange(detail.budgetMin, detail.budgetMax)],
    ...(detail.outcome === "WON" ? [["Giá trị hợp đồng", detail.contractValue === null ? "-" : formatCompactVnd(detail.contractValue)] as [string, string]] : []),
    ["PIC", detail.pic?.name ?? null], ["Team", detail.team?.name ?? null],
    ["Nguồn", OPPORTUNITY_SOURCES.find(row => row.key === detail.source)?.label ?? detail.source], ["Tín hiệu nhu cầu", detail.demandSignal],
    ["Ngày nhận Brief", date(detail.briefReceivedAt)], ["Hạn nộp đề xuất", date(detail.proposalDueAt)], ["Đề bài tóm tắt", detail.briefSummary],
    ["Chiến lược thắng thầu", detail.winStrategy], ["Ngày gửi đề xuất dự kiến", date(detail.proposalPlannedAt)],
    ...(closed ? [["Kết quả", badge?.label ?? detail.outcome], ["Lý do", detail.outcomeReasonLabel], ["Ghi chú", detail.outcomeNote], ["Điều rút ra", detail.lessons]] as [string, string | null][] : []),
  ];
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmOpportunities" />
    <main className="tf-main"><HubTabs section="crmOpportunities" role={user.role} /><div className="tf-page space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-3">
          <Link href={`/crm/clients/${detail.client.id}`} className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900"><ArrowLeft size={16} aria-hidden="true" />{detail.client.name}</Link>
          <div className="flex flex-wrap items-center gap-2"><h1 className="tf-page-title break-words">{detail.name}</h1><span className={`tf-badge ${badge?.className ?? "bg-zinc-100 text-zinc-500"}`}>{badge?.label ?? detail.stage}</span>{!canEdit && !closed && <span className="tf-badge bg-zinc-100 text-zinc-500">Chỉ xem</span>}</div>
          <p className="text-xs text-zinc-500">{[detail.client.name, detail.buyingUnitName, detail.programTypeLabel].filter(Boolean).join(" · ")}</p>
          {detail.outcome === "WON" && detail.project && <Link href={`/projects/${detail.project.id}`} className="inline-flex text-sm text-zinc-700 underline underline-offset-4">Project: {detail.project.name}</Link>}
        </div>
        <div className="flex flex-wrap gap-2" data-slot="opportunity-actions">
          {canHeaderLog && options.clients.length > 0 && <TouchpointDialog options={options} lockClient triggerVariant="secondary" prefill={{ clientId: detail.client.id, opportunityId: closed ? null : id }} />}
          {!closed && <OpportunityHeaderActions key={`${id}-${detail.version}`} opportunity={actionOpportunity} rights={{ canAdvance: canEdit, canEdit, canClose: crmCan(actor, "CLOSE_OPPORTUNITY", resource), canChangePic: crmCan(actor, "CHANGE_PIC_OR_TEAM", resource) }} reasons={{ LOST: reasons.filter(r => r.group === "LOST").map(r => ({ id: r.id, label: r.label, requiresNote: r.requiresNote })), CANCELLED: reasons.filter(r => r.group === "CANCELLED").map(r => ({ id: r.id, label: r.label, requiresNote: r.requiresNote })), DECLINED: reasons.filter(r => r.group === "DECLINED").map(r => ({ id: r.id, label: r.label, requiresNote: r.requiresNote })) }} winPreview={preview ? { tasks: preview.tasks, files: preview.files, meetings: preview.meetings } : null} openBidPrepTaskCount={detail.openBidPrepTaskCount} users={options.users} picAccounts={editOptions?.picAccounts ?? []} teams={teams} programTypes={editOptions?.programTypes ?? []} buyingUnits={editOptions?.buyingUnits ?? []} todayKey={vnDateKey(now)} />}
        </div>
      </header>
      <OpportunityStepper stage={detail.stage} outcome={detail.outcome} events={detail.stageEvents} now={now} />
      <div className="grid min-w-0 gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="min-w-0 space-y-6">
          <OpportunityNextStep nextStep={detail.nextStep} clientId={detail.client.id} opportunityId={id} closed={closed} canSetNext={canLog} canComplete={canComplete} options={options} now={now} />
          <section className="tf-panel overflow-hidden" aria-labelledby="bid-tasks-title">
            <header className="border-b border-zinc-100 px-5 py-3"><h2 id="bid-tasks-title" className="text-base font-semibold">Việc chuẩn bị thầu</h2></header>
            <div className="px-5 py-4">{detail.tasks.length ? <div>{detail.tasks.map(row => <TaskListItem key={row.id} task={{ id: row.id, title: row.title, status: row.status, priority: row.priority, dueDate: row.dueDate, owner: toTaskOwnerDisplay(row), personLabel: row.assignee?.name }} />)}</div> : <p className="py-4 text-sm text-zinc-500">Chưa có việc.</p>}
              {!closed && canAssign && <NewTaskInline owner={{ kind: "OPPORTUNITY", id }} status="TODO" members={members} triggerLabel="Thêm việc" />}
            </div>
          </section>
          <OpportunityFilesPanel key={`${id}-${detail.outcome}-${detail.files.map(f => f.id).join(",")}`} opportunityId={id} currentUserId={user.id} canUpload={!closed && canAssign} canManageAll={!closed && canEdit} readOnlyProjectId={detail.outcome === "WON" ? detail.project?.id ?? null : null} initialFiles={detail.files} />
          {meetingsEnabled() && <section className="tf-panel overflow-hidden" aria-labelledby="opportunity-meetings-title">
            <header className="border-b border-zinc-100 px-5 py-3"><h2 id="opportunity-meetings-title" className="text-base font-semibold">Cuộc họp</h2></header>
            <div className="px-5 py-4">{detail.meetings.length ? <ul className="divide-y divide-zinc-100">{detail.meetings.map(meeting => <li key={meeting.id} className="space-y-2 py-3"><Link href={`/meetings/${meeting.id}`} className="break-words text-sm font-semibold hover:underline">{meeting.title}</Link><p className="text-xs text-zinc-500">{date(meeting.startsAt)}</p></li>)}</ul> : <p className="py-4 text-sm text-zinc-500">Chưa có cuộc họp.</p>}</div>
          </section>}
          <section className="tf-panel overflow-hidden" aria-labelledby="opportunity-touchpoints-title">
            <header className="border-b border-zinc-100 px-5 py-3"><h2 id="opportunity-touchpoints-title" className="text-base font-semibold">Điểm chạm</h2></header>
            <div className="px-5 py-4">{detail.touchpoints.length ? <ul className="divide-y divide-zinc-100">{detail.touchpoints.map(touchpoint => <li key={touchpoint.id} className="space-y-2 py-4">
              <p className="text-xs text-zinc-500">{date(touchpoint.occurredAt)} · {TOUCHPOINT_KINDS.find(row => row.key === touchpoint.kind)?.label ?? touchpoint.kind}{touchpoint.authorName ? ` · ${touchpoint.authorName}` : ""}</p>
              {touchpoint.status === "DRAFT" && <span className="tf-badge border border-dashed border-zinc-300 text-zinc-500">Chờ xác nhận</span>}<OutcomeDots level={touchpoint.outcomeLevel} />
              {touchpoint.notes && <p className="whitespace-pre-wrap break-words text-sm">{touchpoint.notes}</p>}
            </li>)}</ul> : <div className="space-y-4 py-4"><p className="text-sm text-zinc-500">Chưa có điểm chạm.</p>{!closed && canLog && options.clients.length > 0 && <TouchpointDialog options={options} lockClient triggerVariant="secondary" prefill={{ clientId: detail.client.id, opportunityId: id }} />}</div>}</div>
          </section>
        </div>
        <aside className="min-w-0 space-y-6">
          <section className="tf-panel p-5" aria-labelledby="opportunity-info-title">
            <h2 id="opportunity-info-title" className="mb-4 text-base font-semibold">Thông tin Cơ hội</h2>
            <dl className="space-y-4 text-sm"><div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2"><dt className="text-xs text-zinc-500">Thời gian dự kiến</dt><dd className="min-w-0 space-y-2"><p>{detail.timingLabel}</p>{eventSource && <span className={`tf-badge ${eventSource.key === "CLIENT_CONFIRMED" ? "bg-emerald-50 text-emerald-700" : "border border-dashed border-zinc-400 bg-white text-zinc-600"}`}>{eventSource.label}</span>}</dd></div>
              {info.map(([label, value]) => <div key={label} className="grid grid-cols-[140px_minmax(0,1fr)] gap-2"><dt className="text-xs text-zinc-500">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words tabular-nums">{value || "-"}</dd></div>)}
            </dl>
            {detail.outcome === "LEGACY_UNCLASSIFIED" && detail.legacyStatus && <p className="mt-4 text-xs text-zinc-500">Giá trị gốc: {detail.legacyStatus}</p>}
          </section>
          <section className="tf-panel p-5" aria-labelledby="stage-history-title">
            <h2 id="stage-history-title" className="mb-4 text-base font-semibold">Lịch sử stage</h2>
            <ol className="space-y-4">{detail.stageEvents.map(event => <li key={event.id} className="break-words text-xs text-zinc-500"><time dateTime={event.occurredAt.toISOString()}>{new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(event.occurredAt).replace(",", "")}</time> · <span className="text-zinc-700">{describeStageEvent(event)}</span> · {event.actorName}</li>)}</ol>
          </section>
        </aside>
      </div>
    </div></main>
    {task && selectedTask && <CrmTaskDialog key={task.id} task={task} members={members} currentUserId={user.id} closeHref={base} canEdit={!closed && crmCan(actor, "EDIT_TASK", { kind: "TASK", owner: resource, assigneeId: selectedTask.assigneeId, creatorId: selectedTask.creatorId })} canDelete={!closed && canAssign} canAssign={!closed && canAssign} />}
  </div>;
}
