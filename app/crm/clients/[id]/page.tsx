import Link from "next/link";
import type { ReactNode } from "react";
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
import TouchpointDialog from "@/components/crm/TouchpointDialog";
import OpenOpportunityDialog from "@/components/crm/OpenOpportunityDialog";
import DraftTouchpointActions from "@/components/crm/DraftTouchpointActions";
import PendingPicConfirmButton from "@/components/crm/PendingPicConfirmButton";
import SeasonGrid from "@/components/crm/SeasonGrid";
import ExpectedEventDialog from "@/components/crm/ExpectedEventDialog";
import ClientIdentityEditor, { ClientArchiveMenuItem, ClientNotesMenuItem, ClientRestoreButton, ClientTagsMenuItem } from "@/components/crm/ClientIdentityEditor";
import ClientCompetitors from "@/components/crm/ClientCompetitors";
import { ClientHubNav, ClientHubSummary, ClientHubTiles, type HubNavItem } from "@/components/crm/ClientHubHeader";
import ClientHistoryTimeline from "@/components/crm/ClientHistoryTimeline";
import ClientPlaybook, { type PlaybookSectionView } from "@/components/crm/ClientPlaybook";
import ClientBidLessons from "@/components/crm/ClientBidLessons";
import ClientDocuments from "@/components/crm/ClientDocuments";
import { loadClientHub } from "@/lib/crm/clientHubData";
import { describeHubFieldChange, expiryInfo, PLAYBOOK_SECTIONS, vendorStatusLabel, type PlaybookSection } from "@/lib/crm/clientHub";
import { canViewRevenue } from "@/lib/projectPolicy";
import { CLIENT_LIFECYCLE_LABELS } from "@/lib/crm/clientLifecycle";
import { listClientTags, listCompetitors } from "@/lib/crm/settings";
import { vnDateKey } from "@/lib/crm/dates";
import { loadSeasonGridInput } from "@/lib/crm/seasonData";
import { buildSeasonGrid } from "@/lib/crm/seasonGrid";
import { loadProgramTypes } from "@/lib/programTypes";
import { loadTouchpointDialogOptions, loadOpenOpportunityDialogOptions } from "@/lib/crm/dialogOptions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmAllowed, listCrmAllowedUserIds } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan, crmCanEditPlaybook, crmCanRateProject, type CrmOwnerResource } from "@/lib/crm/policy";
import { loadClientProfile } from "@/lib/crm/clientData";
import { getCrmSettings, listProgramTypesForAdmin } from "@/lib/crm/settings";
import { OPPORTUNITY_STAGES, OPPORTUNITY_OUTCOMES, TIER_LABELS } from "@/lib/crm/labels";
import { buildClientActivity, clientSummary, formatBudgetSpan } from "@/lib/crm/clientView";
import { crmTabHref, resolveCrmTab } from "@/lib/crm/tabs";
import { formatBudgetRange } from "@/lib/crm/opportunityFormat";
import { formatCrmDate } from "@/lib/crm/dates";
import { parseCommentMentions } from "@/lib/commentMentions";
import { storedFileDriveUrl } from "@/lib/storedFileResponse";
import { formatVND, type TaskDTO } from "@/lib/types";

// crm53: section navigation replaces the tab row; old ?tab= links land on the section that now holds them.
const CLIENT_SECTIONS = ["overview", "collab", "playbook", "bids", "documents", "units", "activity"] as const;
const LEGACY_TABS: Record<string, (typeof CLIENT_SECTIONS)[number]> = { opportunities: "overview", season: "overview", tasks: "overview", projects: "collab", files: "documents", meetings: "documents", history: "activity" };
const CONTACTS_LOCKED = "Khóa tới khi G-LEGAL duyệt dữ liệu người liên hệ";
const LIFECYCLE_TONE: Record<string, string> = { PROSPECT: "bg-zinc-100 text-zinc-600", ACTIVE: "bg-brand-50 text-brand-700", DORMANT: "bg-[#fff7e6] text-[#b86a08]", ARCHIVED: "border border-dashed border-zinc-300 text-zinc-500" };
const percent = (value: number | null) => value === null ? "Chưa có" : `${value}%`;
const tone = (value: "late" | "warn" | null) => value === "late" ? "font-semibold text-[#c2410c]" : value === "warn" ? "font-semibold text-[#b86a08]" : "";

export default async function ClientProfilePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) notFound();
  const [{ id }, rawQuery] = await Promise.all([params, searchParams]);
  const query = { task: typeof rawQuery.task === "string" ? rawQuery.task : undefined, touchpoints: typeof rawQuery.touchpoints === "string" ? rawQuery.touchpoints : undefined };
  const legacyTab = typeof rawQuery.tab === "string" ? rawQuery.tab : undefined;
  const tab = resolveCrmTab(legacyTab && Object.hasOwn(LEGACY_TABS, legacyTab) ? LEGACY_TABS[legacyTab] : legacyTab, CLIENT_SECTIONS, "overview");
  const activityView = legacyTab === "history" || query.touchpoints === "changes" ? "changes" : query.touchpoints === "draft" ? "draft" : "all";
  const now = new Date();
  const settings = await getCrmSettings(prisma);
  const client = await loadClientProfile(prisma, id, settings, now);
  if (!client) notFound();
  const actor = await loadCrmActor(user);
  const [touchpointOptions, opportunityOptions] = await Promise.all([
    loadTouchpointDialogOptions(prisma, actor, { clientId: id }),
    loadOpenOpportunityDialogOptions(prisma, actor, { clientId: id }),
  ]);
  const canLog = touchpointOptions.clients.length > 0;
  const resource: CrmOwnerResource = { kind: "CLIENT", picUserId: client.picAccount?.userId ?? null, teamId: client.responsibleTeamId ?? client.picAccount?.teamId ?? null };
  const canEdit = crmCan(actor, "EDIT", resource);
  const canManage = crmCan(actor, "CHANGE_PIC_OR_TEAM", resource);
  const canScore = crmCan(actor, "SCORE_POTENTIAL", resource);
  const canAssign = crmCan(actor, "ASSIGN", resource);
  const canConfirm = client.importStatus === "PENDING_PIC_CONFIRM" && crmCan(actor, "CONFIRM_IMPORTED_CLIENT", resource);
  const canArchive = crmCan(actor, "ARCHIVE_CLIENT", resource);
  const archived = client.archivedAt !== null;
  const [projects, accounts, teams, users, programs, selectedTask, seasonInput, activePrograms, tagCatalog, competitorCatalog, parentOptions] = await Promise.all([
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
    canManage ? prisma.account.findMany({ where: { OR: [{ userId: null }, { user: { isActive: true, deletedAt: null } }] }, select: { id: true, name: true, userId: true }, orderBy: { name: "asc" } }) : [],
    canManage ? prisma.salesTeam.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    prisma.user.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, name: true, email: true, avatarUrl: true }, orderBy: { name: "asc" } }),
    listProgramTypesForAdmin(prisma),
    query.task && query.task.length <= 64 ? prisma.task.findFirst({ where: { id: query.task, clientId: client.id }, include: {
      creator: { select: { id: true, name: true, avatarUrl: true } },
      comments: { include: { author: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { createdAt: "asc" } },
      followers: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      files: { select: { id: true, kind: true, name: true, mimeType: true, size: true, createdAt: true, driveFileId: true, uploader: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    } }) : null,
    loadSeasonGridInput(prisma, id, now),
    loadProgramTypes(prisma, { activeOnly: true }),
    canEdit ? listClientTags(prisma) : [],
    canEdit ? listCompetitors(prisma) : [],
    canEdit ? prisma.client.findMany({ where: { archivedAt: null, id: { not: client.id } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const months = buildSeasonGrid({ ...seasonInput, programTypes: programs, now });
  const programLabels = Object.fromEntries(programs.map((program) => [program.code, program.label]));
  const showRevenue = canViewRevenue(user.role);
  const hub = await loadClientHub(prisma, client, { id: user.id, role: actor.role }, programLabels, now, { showRevenue });
  const eventDialogOptions = { clientId: id, clientName: client.name, programTypes: activePrograms.map(p => ({ code: p.code, label: p.label })), buyingUnits: client.buyingUnits.filter(u => u.active).map(u => ({ id: u.id, name: u.name })), reminderOffsets: settings.reminderOffsets };
  const clientFields = { id: client.id, version: client.version, industry: client.industry, budgetSeason: client.budgetSeason, budgetSeasonMonth: client.budgetSeasonMonth, vendorSelection: client.vendorSelection, valuedMost: client.valuedMost, potentialLevel: client.potentialLevel };
  const members = users.map((person) => ({ userId: person.id, role: "MEMBER", user: person }));
  const base = `/crm/clients/${client.id}`;
  const summary = clientSummary(client, now);
  const activity = buildClientActivity(client, now).filter(item => activityView !== "draft" || item.draft);
  const sectionHref = (key: string) => crmTabHref(base, { ...rawQuery, task: undefined, touchpoints: key === "activity" ? rawQuery.touchpoints : undefined }, key, "overview");
  const closeHref = crmTabHref(base, { ...rawQuery, task: undefined }, tab, "overview");
  const next = summary.nextTask;
  const lockedLog = "Chỉ PIC, người được giao việc hoặc AD/AM của team ghi được điểm chạm.";
  const lockedEdit = archived ? "Khôi phục khách trước khi mở Cơ hội mới." : "Chỉ PIC hoặc AD/AM của team mở được Cơ hội.";
  const identity = { id: client.id, version: client.version, name: client.name, taxCode: client.taxCode, legalName: client.legalName, shortName: client.shortName, website: client.website, address: client.address, acquisitionSource: client.acquisitionSource, referredBy: client.referredBy, notes: client.notes, parent: client.parentClient ? { id: client.parentClient.id, name: client.parentClient.name } : null };
  const potentialLabels = Object.fromEntries(settings.potentialScale.map((level) => [level.key, level.label]));
  const metrics = client.metrics;
  const metricItems = [
    { label: "Doanh thu trọn đời", value: formatVND(metrics.lifetimeRevenue) },
    { label: "Tỷ lệ thắng", value: percent(metrics.winRate), detail: metrics.won + metrics.lost ? `${metrics.won}/${metrics.won + metrics.lost} cạnh tranh` : null },
    { label: "Giá trị TB hợp đồng thắng", value: metrics.averageWonValue === null ? "Chưa có" : formatVND(metrics.averageWonValue) },
    { label: "Chạm gần nhất", value: metrics.lastConfirmedTouchAt ? formatCrmDate(metrics.lastConfirmedTouchAt, now) : "Chưa có" },
  ];
  const headerFirstItems = canEdit ? <>
    <ExpectedEventDialog {...eventDialogOptions} mode={{ kind: "create" }} trigger="menuitem" />
    <ClientNotesMenuItem client={identity} />
    {(tagCatalog.length > 0 || client.tags.length > 0) && <ClientTagsMenuItem clientId={client.id} version={client.version} selected={client.tags} tags={tagCatalog.map((tag) => ({ id: tag.id, label: tag.label }))} />}
  </> : undefined;
  const crmAllowedIds = new Set(canManage ? await listCrmAllowedUserIds(prisma) : []);
  const changePicDialog = canManage ? <ChangePicDialog key={client.id} clientId={client.id} version={client.version} picAccountId={client.picAccountId} teamId={client.responsibleTeamId} accounts={accounts.map(({ id, name, userId }) => ({ id, name, crmAccess: !!userId && crmAllowedIds.has(userId) }))} teams={teams} trigger={canEdit ? "menuitem" : "button"} /> : undefined;
  const changePic = changePicDialog;
  const headerLastItems = canEdit ? <>{changePicDialog}{canArchive && !archived && <ClientArchiveMenuItem clientId={client.id} version={client.version} openOpportunityCount={summary.openOpportunityCount} />}</> : undefined;
  const opportunityRow = (opportunity: typeof client.opportunities[number]) => {
    const state = opportunity.outcome ? OPPORTUNITY_OUTCOMES.find((item) => item.key === opportunity.outcome) : OPPORTUNITY_STAGES.find((item) => item.key === opportunity.stage);
    const timing = opportunity.expectedMonth ? `Tháng ${opportunity.expectedMonth}/${opportunity.expectedYear}` : opportunity.expectedQuarter ? `Quý ${opportunity.expectedQuarter}/${opportunity.expectedYear}` : "Chưa có thời gian dự kiến";
    return <li key={opportunity.id} className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/crm/opportunities/${opportunity.id}`} className="text-sm font-semibold hover:underline">{opportunity.name}</Link><span className={`tf-badge font-normal ${state?.className ?? "bg-zinc-100 text-zinc-500"}`}>{state?.label ?? opportunity.stage}</span></div>
      <p className="text-xs text-zinc-500">{[opportunity.buyingUnit?.name, timing, formatBudgetRange(opportunity.budgetMin, opportunity.budgetMax), opportunity.outcome === null ? opportunity.nextStep?.title : null].filter(Boolean).join(" · ")}</p>
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

  // crm53 playbook cards: display rows and form values prepared on the server.
  const vendorExpiry = expiryInfo(client.vendorRegisteredUntil, now);
  const frameworkExpiry = expiryInfo(client.frameworkContractUntil, now);
  const expiryTag = (info: ReturnType<typeof expiryInfo>) => !info ? null : info.tone === "late" ? { text: "Đã hết hạn", tone: "late" as const } : info.tone === "warn" ? { text: `Còn ${info.daysLeft} ngày`, tone: "warn" as const } : null;
  const formValue = (value: unknown) => value === null || value === undefined ? "" : value instanceof Date ? vnDateKey(value) : String(value);
  const playbookSections: PlaybookSectionView[] = (Object.keys(PLAYBOOK_SECTIONS) as PlaybookSection[]).map((key) => {
    const update = hub.playbook.updates[key];
    return {
      key, empty: hub.playbook.empty[key],
      updatedLabel: update ? `${update.by ?? "Không rõ"} cập nhật ${formatCrmDate(update.at, now)}` : null,
      values: Object.fromEntries(PLAYBOOK_SECTIONS[key].fields.map((field) => [field, formValue(client[field])])),
      rows: key === "PROCUREMENT" ? [
        { field: "vendorStatus", value: vendorStatusLabel(client.vendorStatus) },
        { field: "vendorRegisteredUntil", value: vendorExpiry?.label ?? null, tag: expiryTag(vendorExpiry) },
        { field: "frameworkContractUntil", value: frameworkExpiry?.label ?? null, tag: expiryTag(frameworkExpiry) },
        { field: "quotesRequired", value: client.quotesRequired === null ? null : String(client.quotesRequired) },
        { field: "approvalFlow", value: client.approvalFlow },
      ] : key === "BRAND" ? [
        { field: "brandGuidelineUrl", value: client.brandGuidelineUrl, href: client.brandGuidelineUrl },
        { field: "brandDos", value: client.brandDos }, { field: "brandDonts", value: client.brandDonts },
      ] : PLAYBOOK_SECTIONS[key].fields.map((field) => ({ field, value: formValue(client[field]) || null })),
    };
  });
  const navItems: HubNavItem[] = [
    { key: "overview", label: "Tổng quan" }, { key: "collab", label: "Lịch sử hợp tác" }, { key: "playbook", label: "Sổ tay làm việc", badge: hub.playbook.emptyCount },
    { key: "bids", label: "Thầu và bài học" }, { key: "documents", label: "Tài liệu" }, { key: "units", label: "Đơn vị mua" }, { key: "activity", label: "Hoạt động" },
  ].map((item) => ({ ...item, href: sectionHref(item.key) }));
  navItems.push({ key: "contacts", label: "Người liên hệ", lockedReason: CONTACTS_LOCKED });
  const subline = [client.shortName ? client.name : null, client.legalName && client.legalName !== client.name ? client.legalName : null, client.taxCode ? `MST ${client.taxCode}` : null].filter(Boolean).join(" · ");
  const opportunityStages = new Map(client.clientOpportunities.map((o) => [o.id, o.stage]));
  const nextTile = next ? <div className="space-y-2">
    <p className="break-words text-[15px] font-semibold text-zinc-900">{next.title}</p>
    <p className="flex flex-wrap gap-x-1 text-xs text-zinc-500">{[next.dueLabel && <span key="d" className={tone(next.dueTone)}>{next.dueLabel}</span>, next.assigneeName && <span key="a">{next.assigneeName}</span>, next.opportunity && <Link key="o" href={`/crm/opportunities/${next.opportunity.id}`} className="hover:underline">Cơ hội: {next.opportunity.name}</Link>].filter(Boolean).flatMap((item, i) => i ? [<span key={`s${i}`} aria-hidden="true">·</span>, item] : [item])}</p>
    <div className="flex flex-wrap gap-2">
      {canLog ? <TouchpointDialog options={touchpointOptions} triggerVariant="primary" triggerLabel="Ghi kết quả" prefill={{ clientId: id, opportunityId: next.opportunity?.id ?? null, completeTaskId: next.id }} lockClient /> : <button type="button" className="tf-button-primary" disabled title={lockedLog}>Ghi kết quả</button>}
      <Link href={next.opportunity ? `/crm/opportunities/${next.opportunity.id}?task=${next.id}` : crmTabHref(base, { ...rawQuery, task: next.id }, tab, "overview")} scroll={false} className="tf-button-secondary">Đổi việc</Link>
    </div>
  </div> : <div className="space-y-2">
    <p className="text-[15px] font-semibold text-zinc-500">Chưa có việc tiếp theo</p>
    {canLog ? <TouchpointDialog options={touchpointOptions} triggerVariant="primary" triggerLabel="Đặt việc tiếp theo" prefill={{ clientId: id }} lockClient /> : <button type="button" className="tf-button-primary" disabled title={lockedLog}>Đặt việc tiếp theo</button>}
  </div>;
  const upcoming = hub.upcoming;
  const upcomingTile = !upcoming ? <p className="text-zinc-500">Chưa có</p> : upcoming.kind === "OPPORTUNITY"
    ? <p className="break-words"><Link href={`/crm/opportunities/${upcoming.id}`} className="font-semibold text-zinc-900 hover:underline">{upcoming.name}</Link><span className="text-zinc-500"> · Tháng {upcoming.month}/{upcoming.year} · {OPPORTUNITY_STAGES.find((stage) => stage.key === upcoming.stage)?.label ?? upcoming.stage}</span></p>
    : <p className="break-words"><b className="font-semibold text-zinc-900">{upcoming.name}</b><span className="text-zinc-500"> · {upcoming.precision === "DAY" ? formatCrmDate(upcoming.date, now) : `Tháng ${vnDateKey(upcoming.date).slice(5, 7)}/${vnDateKey(upcoming.date).slice(0, 4)}`} · Dự kiến</span></p>;
  const panel = (titleId: string, title: string, children: ReactNode, aside?: ReactNode) => <section className="tf-panel min-w-0 space-y-3 px-5 py-4" aria-labelledby={titleId}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id={titleId} className="text-[15px] font-semibold">{title}</h2>{aside}</div>
    {children}
  </section>;

  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmClients" />
    <main className="tf-main"><HubTabs section="crmClients" role={user.role} />
      <ClientEditSession key={client.id} version={client.version}><div className="tf-page space-y-4">
        <Link href="/crm/clients" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900"><ArrowLeft size={16} aria-hidden="true" />Khách hàng</Link>
        {archived && <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3.5" aria-label="Khách đang lưu trữ">
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-zinc-900">Khách đang lưu trữ từ {formatCrmDate(client.archivedAt!, now)}{client.archivedBy ? ` · ${client.archivedBy.name}` : ""}</p>
            <p className="break-words text-[13px] text-zinc-500">{[client.archivedReason, summary.openOpportunityCount ? `Còn ${summary.openOpportunityCount} Cơ hội đang mở` : null].filter(Boolean).join(" · ") || "Chưa ghi lý do"}</p>
          </div>
          {canArchive && <ClientRestoreButton clientId={client.id} version={client.version} />}
        </section>}
        <section className="tf-panel space-y-4 p-5 sm:p-6" aria-label="Tóm tắt khách">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <TierBadge tier={client.tier} variant="dot" />
                <h1 className="tf-page-title break-words">{client.shortName ?? client.name}</h1>
                <span className={`tf-badge font-normal ${LIFECYCLE_TONE[client.lifecycle]}`}>{CLIENT_LIFECYCLE_LABELS[client.lifecycle]}</span>
                {client.industry && <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">{client.industry}</span>}
                {client.tags.map((tag) => <span key={tag.id} className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">{tag.label}</span>)}
                {!canEdit && <span className="tf-badge bg-zinc-100 font-normal text-zinc-500">Chỉ xem</span>}
                {client.importStatus === "PENDING_PIC_CONFIRM" && <span className="tf-badge border border-dashed border-zinc-300 font-normal text-zinc-500">Chờ PIC xác nhận</span>}
              </div>
              {(subline || client.parentClient) && <p className="break-words text-[13px] text-zinc-500">{subline}{client.parentClient && <>{subline ? " · " : ""}Thuộc <Link href={`/crm/clients/${client.parentClient.id}`} className="font-semibold text-zinc-900 hover:underline">{client.parentClient.name}</Link></>}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canConfirm && <PendingPicConfirmButton clientId={id} />}
              {canEdit && !archived ? <OpenOpportunityDialog options={opportunityOptions} triggerVariant="secondary" prefill={{ clientId: id }} lockClient /> : <button type="button" className="tf-button-secondary" disabled title={lockedEdit}>Mở Cơ hội</button>}
              <ClientProfileEditors key={`header-${client.id}`} client={clientFields} variant="header" canEdit={canEdit} firstHeaderMenuItem={headerFirstItems} lastHeaderMenuItem={headerLastItems} />
              {!canEdit && changePic}
            </div>
          </header>
          <ClientHubSummary sentences={hub.summary} />
          {client.notes && <div className="rounded-[14px] bg-zinc-50 px-4 py-3" role="note" aria-label="Ghi chú chung"><p className="whitespace-pre-wrap break-words text-[13px] text-zinc-700">{client.notes}</p></div>}
          <ClientHubTiles health={hub.health}
            team={<p className="break-words"><b className="font-semibold text-zinc-900">{client.picAccount?.name ?? "Chưa giao PIC"}</b>{client.picAccount && <span className="text-zinc-500"> (PIC)</span>}<span className="text-zinc-500"> · {client.team?.name ?? "Chưa phân team"}</span></p>}
            next={nextTile} upcoming={upcomingTile} />
        </section>
        <div className="grid items-start gap-4 lg:grid-cols-[188px_minmax(0,1fr)]">
          <ClientHubNav items={navItems} current={tab} />
          <div className="min-w-0 space-y-4">
            {tab === "overview" && <>
              <section aria-label={client.metricsScope.kind === "GROUP" ? `Chỉ số gồm ${client.metricsScope.childCount} công ty con` : "Chỉ số khách"} className="tf-panel grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 lg:grid-cols-4">
                {metricItems.map((item) => <div key={item.label} className="min-w-0"><p className="text-xs text-zinc-500">{item.label}</p><p className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-zinc-900">{item.value}</p>{item.detail && <p className="text-xs text-zinc-500">{item.detail}</p>}</div>)}
                {client.metricsScope.kind === "GROUP" && <p className="col-span-full text-xs text-zinc-500">Gồm {client.metricsScope.childCount} công ty con · Hạng vẫn tính riêng từng pháp nhân</p>}
              </section>
              {panel("client-opportunities-title", `Cơ hội (${client.opportunities.length})`, client.opportunities.length ? <ul className="divide-y divide-zinc-100">{client.opportunities.map(opportunityRow)}</ul> : <p className="text-sm text-zinc-500">Chưa có Cơ hội.</p>)}
              {panel("client-tasks-title", `Việc chăm sóc (${client.tasks.length})`, <div>
                {client.tasks.length ? <div>{client.tasks.map((item) => <TaskListItem key={item.id} task={{ id: item.id, title: item.title, status: item.status, priority: item.priority, dueDate: item.dueDate, owner: { kind: "CLIENT", id: client.id, name: client.name, color: null }, personLabel: item.assignee?.name }} />)}</div> : <p className="mb-3 text-sm text-zinc-500">Chưa có việc.</p>}
                {canAssign && <NewTaskInline owner={{ kind: "CLIENT", id: client.id }} status="TODO" members={members} triggerLabel="Thêm việc" />}
              </div>)}
              <SeasonGrid months={months} canEdit={canEdit} eventDialogOptions={eventDialogOptions} addEventSlot={<ExpectedEventDialog {...eventDialogOptions} mode={{ kind: "create" }} trigger="secondary" />} />
              <div className="grid gap-4 xl:grid-cols-2">
                {panel("client-company-title", "Thông tin công ty", <ClientIdentityEditor key={`identity-${client.id}`} client={identity} aliases={client.aliases} canEdit={canEdit} sources={settings.sources} parentOptions={parentOptions} />)}
                {panel("client-tier-title", client.tier === "UNRATED" ? "Vì sao chưa xếp hạng" : `Vì sao ${TIER_LABELS[client.tier].toLocaleLowerCase("vi")}`, <div>
                  <dl className="space-y-1.5 text-[13px]">
                    <div className="flex justify-between gap-3"><dt className="text-zinc-500">Doanh thu 24 tháng</dt><dd className="text-right tabular-nums">{formatVND(client.revenue24m)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-zinc-500">Tiềm năng</dt><dd className="text-right">{settings.potentialScale.find((level) => level.key === client.potentialLevel)?.label ?? client.potentialLevel ?? "Chưa chấm"}{client.potentialScoredBy && <span className="text-zinc-500"> · {client.potentialScoredBy.name} chấm{client.potentialScoredAt ? ` ${formatCrmDate(client.potentialScoredAt, now)}` : ""}</span>}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-zinc-500">Chu kỳ liên hệ</dt><dd className="text-right">{client.cadenceWeeks} tuần</dd></div>
                  </dl>
                  <ClientProfileEditors key={`tier-${client.id}`} client={clientFields} variant="tier" canScore={canScore} potentialScale={settings.potentialScale} />
                  {client.potentialScores.length > 0 && <details className="mt-3 text-xs text-zinc-500"><summary className="cursor-pointer">Lịch sử chấm tiềm năng</summary><ul className="mt-3 space-y-3">{client.potentialScores.map((score) => <li key={score.id}>{formatCrmDate(score.createdAt, now)} · {score.scoredByName} · {settings.potentialScale.find((level) => level.key === score.level)?.label ?? score.level}{score.note ? ` · ${score.note}` : ""}</li>)}</ul></details>}
                </div>)}
                {panel("client-persona-title", "Cách khách mua", <div className="space-y-3">
                  <ClientProfileEditors key={`persona-${client.id}`} client={clientFields} variant="persona" canEdit={canEdit} missing={client.personaDepth.missing} />
                  {client.persona.enoughData ? <details className="text-[13px]"><summary className="cursor-pointer text-zinc-500">Lịch sử mua</summary><dl className="mt-3 space-y-3"><div><dt className="text-xs text-zinc-500">Lịch sử chương trình</dt><dd className="mt-1">{client.persona.programHistory.map((item) => `${programLabels[item.code] ?? item.code} (${item.count})`).join(", ") || "Chưa ghi"}</dd></div><div><dt className="text-xs text-zinc-500">Tháng tổ chức thường gặp</dt><dd className="mt-1">{client.persona.typicalMonths.map((month) => `Tháng ${month}`).join(", ") || "Chưa ghi"}</dd></div><div><dt className="text-xs text-zinc-500">Dải ngân sách</dt><dd className="mt-1 tabular-nums">{formatBudgetSpan(client.persona.budgetRange) ?? "Chưa ghi"}</dd></div><div><dt className="text-xs text-zinc-500">Thắng/thua và lý do</dt><dd className="mt-1 space-y-2"><p>Thắng {client.persona.outcomes.won} · Thua cạnh tranh {client.persona.outcomes.lostCompetitive} · Khách hủy {client.persona.outcomes.cancelled} · CS không tham gia {client.persona.outcomes.declined}</p>{client.persona.outcomes.reasons.map((reason) => <p key={reason.label}>{reason.label} ({reason.count})</p>)}</dd></div></dl></details> : <p className="text-[13px] text-zinc-500">Lịch sử mua: chưa đủ dữ liệu</p>}
                </div>, <>
                  {client.personaDepth.status === "INCOMPLETE" && <span className="rounded-full bg-[#fff7e6] px-2 py-0.5 text-xs font-normal text-[#b86a08]">Thiếu {client.personaDepth.missing.length} mục</span>}
                  {client.personaDepth.status === "COMPLETE" && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600">Đủ thông tin theo hạng</span>}
                </>)}
                {panel("client-agency-title", "Agency đang phục vụ", <ClientCompetitors key={`agency-${client.id}`} clientId={client.id} canEdit={canEdit} options={competitorCatalog.map((c) => ({ id: c.id, name: c.name }))} links={client.competitors.map((link) => ({ competitorId: link.competitor.id, name: link.competitor.name, active: link.competitor.active, note: link.note, since: link.since ? vnDateKey(link.since) : null }))} />)}
                {client.childClients.length > 0 && panel("client-children-title", "Công ty con", <ul className="space-y-1.5 text-[13px]">{client.childClients.map((child) => <li key={child.id} className="flex items-center justify-between gap-2"><Link href={`/crm/clients/${child.id}`} className="min-w-0 break-words hover:underline">{child.name}</Link>{child.archivedAt && <span className="text-xs text-zinc-400">Lưu trữ</span>}</li>)}</ul>)}
              </div>
            </>}
            {tab === "collab" && panel("client-collab-title", "Lịch sử hợp tác", <ClientHistoryTimeline clientId={client.id} grid={hub.grid} programs={programs.map((p) => ({ code: p.code, label: p.label, color: p.color }))} showRevenue={showRevenue}
              projects={hub.projectRows.map((row) => ({ id: row.id, name: row.name, programLabel: row.programLabel, date: row.date, revenue: row.revenue, feedback: row.feedback, canRate: crmCanRateProject(actor, resource, row.isMember) }))} />)}
            {tab === "playbook" && panel("client-playbook-title", "Sổ tay làm việc với khách", <ClientPlaybook clientId={client.id} version={client.version} canEdit={crmCanEditPlaybook(actor, resource)} sections={playbookSections} />)}
            {tab === "bids" && panel("client-bids-title", "Thầu và bài học", <ClientBidLessons items={hub.bids.items.map((item) => ({ ...item, stage: opportunityStages.get(item.id) }))} counts={hub.bids.counts} frequentCompetitors={hub.bids.frequentCompetitors} winners={hub.winners} />)}
            {tab === "documents" && panel("client-documents-title", "Tài liệu", <ClientDocuments groups={hub.documents} meetings={hub.meetings} now={now} />)}
            {tab === "units" && panel("client-units-title", "Đơn vị mua", <ClientProfileEditors key={`units-${client.id}`} client={clientFields} variant="buyingUnits" canEdit={canEdit} buyingUnits={client.buyingUnits.map((unit) => ({ id: unit.id, name: unit.name, active: unit.active, programs: [...new Set(unit.opportunityBuyingUnit.map((opportunity) => opportunity.programType.label))] }))} />)}
            {tab === "activity" && panel("client-activity-title", "Hoạt động", <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <nav className="flex flex-wrap gap-2" aria-label="Lọc hoạt động">{[{ key: "all", label: "Tất cả" }, { key: "draft", label: "Nháp" }, { key: "changes", label: "Thay đổi hồ sơ" }].map((option) => { const active = activityView === option.key; return <Link key={option.key} scroll={false} href={crmTabHref(base, { ...rawQuery, task: undefined, touchpoints: option.key === "all" ? undefined : option.key }, "activity", "overview")} aria-current={active ? "page" : undefined} className={`rounded-full border px-3 py-1 text-[13px] ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}>{option.label}</Link>; })}</nav>
                {canLog && activityView !== "changes" && <TouchpointDialog options={touchpointOptions} triggerVariant="secondary" prefill={{ clientId: id }} lockClient />}
              </div>
              {activityView === "changes" ? (client.fieldChanges.length ? <ol className="divide-y divide-zinc-100">{client.fieldChanges.map((change) => { const line = describeHubFieldChange(change, potentialLabels); return <li key={change.id} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 py-3 text-sm">
                <span className="pt-0.5 text-xs tabular-nums text-zinc-500">{formatCrmDate(change.createdAt, now)}</span>
                <div className="min-w-0"><p><b className="font-semibold">{line.label}</b><span className="text-zinc-500"> · {change.actorName}</span></p><p className="break-words text-zinc-700">{line.text}</p></div>
              </li>; })}</ol> : <p className="py-4 text-sm text-zinc-500">Chưa có thay đổi.</p>)
              : activity.length ? <ol className="divide-y divide-zinc-100">{activity.map(item => <li key={item.key} data-activity-kind={item.kind} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 py-3 text-sm">
                <span className="pt-0.5 text-xs tabular-nums text-zinc-500">{item.dateLabel}</span>
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><b className="font-semibold">{item.title}</b>{item.actor && <span className="text-zinc-500">· {item.actor}</span>}{item.outcome && <span className={`tf-badge font-normal ${OPPORTUNITY_OUTCOMES.find(o => o.key === item.outcome)?.className ?? ""}`}>{OPPORTUNITY_OUTCOMES.find(o => o.key === item.outcome)?.label}</span>}{item.draft && <span className="tf-badge border border-dashed border-zinc-300 font-normal text-zinc-500">Chờ xác nhận</span>}</p>
                  {item.kind === "TOUCHPOINT" && item.outcomeLevel !== null && <div><OutcomeDots level={item.outcomeLevel} /></div>}
                  {item.detail && (item.kind === "OPPORTUNITY_CLOSED" && item.opportunity ? <Link href={`/crm/opportunities/${item.opportunity.id}`} className="block break-words hover:underline">{item.detail}</Link> : <p className="whitespace-pre-wrap break-words">{item.detail}</p>)}
                  {item.kind === "TOUCHPOINT" && item.opportunity && <Link href={`/crm/opportunities/${item.opportunity.id}`} className="block text-xs text-brand-700 hover:underline">{item.opportunity.name}</Link>}
                  {item.draft && canLog && item.touchpointId && <DraftTouchpointActions draft={{ id: item.touchpointId, clientId: id, opportunityId: item.opportunity?.id ?? null, occurredAt: item.date.toISOString() }} options={touchpointOptions} />}
                </div>
              </li>)}</ol> : <p className="py-4 text-sm text-zinc-500">{activityView === "draft" ? "Không có điểm chạm nháp." : "Chưa có hoạt động."}</p>}
            </div>)}
          </div>
        </div>
      </div></ClientEditSession>
    </main>
    {task && selectedTask && <CrmTaskDialog key={task.id} task={task} members={members} currentUserId={user.id} closeHref={closeHref} canEdit={crmCan(actor, "EDIT_TASK", { kind: "TASK", owner: resource, assigneeId: selectedTask.assigneeId, creatorId: selectedTask.creatorId })} canDelete={canAssign} canAssign={canAssign} />}
  </div>;
}
