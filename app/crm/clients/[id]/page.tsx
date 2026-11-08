import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import TaskListItem from "@/components/TaskListItem";
import NewTaskInline from "@/components/NewTaskInline";
import TierBadge from "@/components/crm/TierBadge";
import OutcomeDots from "@/components/crm/OutcomeDots";
import ChangePicDialog from "@/components/crm/ChangePicDialog";
import ClientProfileEditors from "@/components/crm/ClientProfileEditors";
import CrmTaskDialog from "@/components/crm/CrmTaskDialog";
import ClientEditSession from "@/components/crm/ClientEditSession";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled } from "@/lib/features";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan, type CrmOwnerResource } from "@/lib/crm/policy";
import { loadClientProfile } from "@/lib/crm/clientData";
import { getCrmSettings, listProgramTypesForAdmin } from "@/lib/crm/settings";
import { OPPORTUNITY_STAGES, OPPORTUNITY_OUTCOMES, TOUCHPOINT_KINDS } from "@/lib/crm/labels";
import { formatCrmDate } from "@/lib/crm/dates";
import { parseCommentMentions } from "@/lib/commentMentions";
import { storedFileDriveUrl } from "@/lib/storedFileResponse";
import { formatVND, type TaskDTO } from "@/lib/types";

export default async function ClientProfilePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!crmEnabled()) notFound();
  const [{ id }, rawQuery] = await Promise.all([params, searchParams]);
  const query = { task: typeof rawQuery.task === "string" ? rawQuery.task : undefined, touchpoints: typeof rawQuery.touchpoints === "string" ? rawQuery.touchpoints : undefined };
  const now = new Date();
  const settings = await getCrmSettings(prisma);
  const client = await loadClientProfile(prisma, id, settings, now);
  if (!client) notFound();
  const actor = await loadCrmActor(user);
  const resource: CrmOwnerResource = { kind: "CLIENT", picUserId: client.picAccount?.userId ?? null, teamId: client.responsibleTeamId ?? client.picAccount?.teamId ?? null };
  const canEdit = crmCan(actor, "EDIT", resource);
  const canManage = crmCan(actor, "CHANGE_PIC_OR_TEAM", resource);
  const canScore = crmCan(actor, "SCORE_POTENTIAL", resource);
  const canAssign = crmCan(actor, "ASSIGN", resource);
  const canConfirm = client.importStatus === "PENDING_PIC_CONFIRM" && crmCan(actor, "CONFIRM_IMPORTED_CLIENT", resource);
  const [projects, accounts, teams, users, programs, selectedTask] = await Promise.all([
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
    canManage ? prisma.account.findMany({ where: { OR: [{ userId: null }, { user: { isActive: true, deletedAt: null } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    canManage ? prisma.salesTeam.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    prisma.user.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true, email: true, avatarUrl: true }, orderBy: { name: "asc" } }),
    listProgramTypesForAdmin(prisma),
    query.task && query.task.length <= 64 ? prisma.task.findFirst({ where: { id: query.task, clientId: client.id }, include: {
      creator: { select: { id: true, name: true, avatarUrl: true } },
      comments: { include: { author: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { createdAt: "asc" } },
      followers: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      files: { select: { id: true, kind: true, name: true, mimeType: true, size: true, createdAt: true, driveFileId: true, uploader: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    } }) : null,
  ]);
  const clientFields = { id: client.id, version: client.version, industry: client.industry, budgetSeason: client.budgetSeason, budgetSeasonMonth: client.budgetSeasonMonth, vendorSelection: client.vendorSelection, valuedMost: client.valuedMost, potentialLevel: client.potentialLevel };
  const members = users.map((person) => ({ userId: person.id, role: "MEMBER", user: person }));
  const base = `/crm/clients/${client.id}`;
  const touchpoints = query.touchpoints === "draft" ? client.touchpoints.filter((touchpoint) => touchpoint.draft) : client.touchpoints;
  const since = new Intl.DateTimeFormat("vi-VN", { year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(client.createdAt);
  const metadata = [client.industry, `Khách từ ${since}`, `PIC: ${client.picAccount?.name ?? "Chưa giao"}`, `Team: ${client.team?.name ?? "Chưa phân team"}`].filter(Boolean).join(" · ");
  const opportunityRow = (opportunity: typeof client.opportunities[number]) => {
    const state = opportunity.outcome ? OPPORTUNITY_OUTCOMES.find((item) => item.key === opportunity.outcome) : OPPORTUNITY_STAGES.find((item) => item.key === opportunity.stage);
    const timing = opportunity.expectedMonth ? `Tháng ${opportunity.expectedMonth}/${opportunity.expectedYear}` : opportunity.expectedQuarter ? `Quý ${opportunity.expectedQuarter}/${opportunity.expectedYear}` : "Chưa có thời gian dự kiến";
    return <li key={opportunity.id} className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/crm/opportunities/${opportunity.id}`} className="text-sm font-semibold hover:underline">{opportunity.name}</Link><span className={`tf-badge font-normal ${state?.className ?? "bg-zinc-100 text-zinc-500"}`}>{state?.label ?? opportunity.stage}</span></div>
      <p className="text-xs text-zinc-500">{[opportunity.buyingUnit?.name, timing, opportunity.budgetMin !== null || opportunity.budgetMax !== null ? `${opportunity.budgetMin !== null ? formatVND(opportunity.budgetMin) : "—"} - ${opportunity.budgetMax !== null ? formatVND(opportunity.budgetMax) : "—"}` : null, opportunity.nextStep?.title].filter(Boolean).join(" · ")}</p>
      {opportunity.outcome === "WON" && opportunity.project && <Link href={`/projects/${opportunity.project.id}`} className="text-xs text-brand-700 hover:underline">Project: {opportunity.project.name}</Link>}
    </li>;
  };
  const task: TaskDTO | null = selectedTask ? {
    id: selectedTask.id, title: selectedTask.title, description: selectedTask.description, result: selectedTask.result, status: selectedTask.status, priority: selectedTask.priority,
    startDate: selectedTask.startDate?.toISOString() ?? null, dueDate: selectedTask.dueDate?.toISOString() ?? null, order: selectedTask.order, assigneeId: selectedTask.assigneeId, creator: selectedTask.creator,
    completedAt: selectedTask.completedAt?.toISOString() ?? null, createdAt: selectedTask.createdAt.toISOString(), updatedAt: selectedTask.updatedAt.toISOString(),
    comments: selectedTask.comments.map((comment) => ({ id: comment.id, body: comment.body, mentions: parseCommentMentions(comment.mentions, comment.body), createdAt: comment.createdAt.toISOString(), author: comment.author })),
    followers: selectedTask.followers.map((follower) => follower.user),
    files: selectedTask.files.map((file) => ({ id: file.id, kind: file.kind === "RESULT" ? "RESULT" : "BRIEF", name: file.name, mimeType: file.mimeType, size: file.size, createdAt: file.createdAt.toISOString(), driveUrl: storedFileDriveUrl(file), uploader: file.uploader })),
  } : null;

  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmClients" />
    <main className="tf-main"><HubTabs section="crmClients" role={user.role} />
      <ClientEditSession key={client.id} version={client.version}><div className="tf-page space-y-6">
        <Link href="/crm/clients" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900"><ArrowLeft size={16} aria-hidden="true" />Khách hàng</Link>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-3"><h1 className="tf-page-title break-words">{client.name}</h1><p className="text-xs text-zinc-500">{metadata}</p><div className="flex flex-wrap items-center gap-2"><TierBadge tier={client.tier} />{!canEdit && <span className="tf-badge bg-zinc-100 text-zinc-500">Chỉ xem</span>}{client.importStatus === "PENDING_PIC_CONFIRM" && <span className="tf-badge border border-dashed border-zinc-300 text-zinc-500">Chờ PIC xác nhận</span>}</div></div>
          <div className="flex flex-wrap gap-2"><ClientProfileEditors key={`header-${client.id}`} client={clientFields} variant="header" canEdit={canEdit} canConfirm={canConfirm} />{canManage && <ChangePicDialog key={client.id} clientId={client.id} version={client.version} picAccountId={client.picAccountId} teamId={client.responsibleTeamId} accounts={accounts} teams={teams} />}</div>
        </header>
        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <div className="min-w-0 space-y-6">
            <section className="tf-panel p-5"><h2 className="mb-4 text-base font-semibold">Cơ hội</h2>
              {client.opportunities.length ? <><ul className="divide-y divide-zinc-100">{client.opportunities.slice(0, 3).map(opportunityRow)}</ul>{client.opportunities.length > 3 && <details className="mt-3"><summary className="cursor-pointer text-sm text-zinc-500">Xem tất cả ({client.opportunities.length})</summary><ul className="divide-y divide-zinc-100">{client.opportunities.slice(3).map(opportunityRow)}</ul></details>}</> : <p className="text-sm text-zinc-500">Chưa có Cơ hội.</p>}
            </section>
            <section className="tf-panel p-5"><h2 className="mb-4 text-base font-semibold">Việc chăm sóc</h2>
              {client.tasks.length ? <div>{client.tasks.map((item) => <TaskListItem key={item.id} task={{ id: item.id, title: item.title, status: item.status, priority: item.priority, dueDate: item.dueDate, owner: { kind: "CLIENT", id: client.id, name: client.name, color: null }, personLabel: item.assignee?.name }} />)}</div> : <p className="mb-3 text-sm text-zinc-500">Chưa có việc.</p>}
              {canAssign && <NewTaskInline owner={{ kind: "CLIENT", id: client.id }} status="TODO" members={members} triggerLabel="Thêm việc" />}
            </section>
            <section className="tf-panel p-5"><h2 className="mb-4 text-base font-semibold">Điểm chạm</h2>
              <nav className="mb-4 flex gap-2" aria-label="Lọc điểm chạm">{[{ key: "all", label: "Tất cả" }, { key: "draft", label: "Nháp" }].map((option) => { const active = (query.touchpoints === "draft" ? "draft" : "all") === option.key; return <Link key={option.key} href={option.key === "all" ? base : `${base}?touchpoints=draft`} aria-current={active ? "page" : undefined} className={`rounded-full border px-3 py-1.5 text-sm ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}>{option.label}</Link>; })}</nav>
              {touchpoints.length ? <ul className="space-y-5">{touchpoints.map((touchpoint) => <li key={touchpoint.id} className="space-y-2 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-zinc-500">{formatCrmDate(touchpoint.occurredAt, now)} · {TOUCHPOINT_KINDS.find((kind) => kind.key === touchpoint.kind)?.label ?? touchpoint.kind} · {touchpoint.author?.name ?? "Chưa rõ người ghi"}</span>{touchpoint.draft && <span className="tf-badge border border-dashed border-zinc-300 text-zinc-500">Chờ xác nhận</span>}</div><OutcomeDots level={touchpoint.outcomeLevel} />{touchpoint.notes && <p className="whitespace-pre-wrap break-words">{touchpoint.notes}</p>}{touchpoint.opportunity && <Link href={`/crm/opportunities/${touchpoint.opportunity.id}`} className="block text-xs text-brand-700 hover:underline">{touchpoint.opportunity.name}</Link>}</li>)}</ul> : <p className="text-sm text-zinc-500">Chưa có điểm chạm.</p>}
            </section>
          </div>
          <aside className="min-w-0 space-y-6">
            <section className="tf-panel p-5"><h2 className="mb-4 text-base font-semibold">Hạng khách</h2><TierBadge tier={client.tier} />
              <dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-zinc-500">Doanh thu 24 tháng</dt><dd className="mt-1 tabular-nums">{formatVND(client.revenue24m)}</dd></div><div><dt className="text-xs text-zinc-500">Tiềm năng</dt><dd className="mt-1">{settings.potentialScale.find((level) => level.key === client.potentialLevel)?.label ?? client.potentialLevel ?? "Chưa chấm"}{client.potentialScoredBy && <p className="mt-1 text-xs text-zinc-500">{client.potentialScoredBy.name}{client.potentialScoredAt ? ` · ${formatCrmDate(client.potentialScoredAt, now)}` : ""}</p>}</dd></div><div><dt className="text-xs text-zinc-500">Chu kỳ chăm sóc</dt><dd className="mt-1">{client.cadenceWeeks} tuần</dd></div></dl>
              <ClientProfileEditors key={`tier-${client.id}`} client={clientFields} variant="tier" canScore={canScore} potentialScale={settings.potentialScale} />
              {client.potentialScores.length > 0 && <details className="mt-4 text-xs text-zinc-500"><summary className="cursor-pointer">Lịch sử chấm tiềm năng</summary><ul className="mt-3 space-y-3">{client.potentialScores.map((score) => <li key={score.id}>{formatCrmDate(score.createdAt, now)} · {score.scoredByName} · {settings.potentialScale.find((level) => level.key === score.level)?.label ?? score.level}{score.note ? ` · ${score.note}` : ""}</li>)}</ul></details>}
            </section>
            <section className="tf-panel p-5"><h2 className="mb-4 text-base font-semibold">Đơn vị mua</h2>
              <ClientProfileEditors key={`units-${client.id}`} client={clientFields} variant="buyingUnits" canEdit={canEdit} buyingUnits={client.buyingUnits.map((unit) => ({ id: unit.id, name: unit.name, active: unit.active, programs: [...new Set(unit.opportunityBuyingUnit.map((opportunity) => opportunity.programType.label))] }))} />
            </section>
            <section className="tf-panel space-y-5 p-5"><h2 className="text-base font-semibold">Cách khách mua</h2>
              {client.persona.enoughData ? <dl className="space-y-4 text-sm"><div><dt className="text-xs text-zinc-500">Lịch sử chương trình</dt><dd className="mt-1">{client.persona.programHistory.map((item) => `${programs.find((program) => program.code === item.code)?.label ?? item.code} (${item.count})`).join(", ") || "Chưa ghi"}</dd></div><div><dt className="text-xs text-zinc-500">Tháng tổ chức thường gặp</dt><dd className="mt-1">{client.persona.typicalMonths.map((month) => `Tháng ${month}`).join(", ") || "Chưa ghi"}</dd></div><div><dt className="text-xs text-zinc-500">Dải ngân sách</dt><dd className="mt-1 tabular-nums">{client.persona.budgetRange ? `${formatVND(client.persona.budgetRange.min)} - ${formatVND(client.persona.budgetRange.max)}` : "Chưa ghi"}</dd></div><div><dt className="text-xs text-zinc-500">Thắng/thua và lý do</dt><dd className="mt-1 space-y-2"><p>Thắng {client.persona.outcomes.won} · Thua cạnh tranh {client.persona.outcomes.lostCompetitive} · Khách hủy {client.persona.outcomes.cancelled} · CS không tham gia {client.persona.outcomes.declined}</p>{client.persona.outcomes.reasons.map((reason) => <p key={reason.label}>{reason.label} ({reason.count})</p>)}</dd></div></dl> : <p className="text-sm text-zinc-500">Chưa đủ dữ liệu</p>}
              <ClientProfileEditors key={`persona-${client.id}`} client={clientFields} variant="persona" canEdit={canEdit} />
            </section>
          </aside>
        </div>
      </div></ClientEditSession>
    </main>
    {task && selectedTask && <CrmTaskDialog key={task.id} task={task} members={members} currentUserId={user.id} closeHref={base} canEdit={crmCan(actor, "EDIT_TASK", { kind: "TASK", owner: resource, assigneeId: selectedTask.assigneeId, creatorId: selectedTask.creatorId })} canDelete={canAssign} canAssign={canAssign} />}
  </div>;
}
