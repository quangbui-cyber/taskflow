import type { Prisma, PrismaClient } from "@prisma/client";
import { KPI_RECOGNIZED_STATUSES } from "../kpi";
import { storedFileDriveUrl } from "../storedFileResponse";
import { eventAnchorDate, type EventTiming } from "./reminders";
import { vnDayStart } from "./dates";
import type { ClientProfileData } from "./clientData";
import { buildClientSummary, buildHealthSignals, buildHistoryGrid, collectBidLessons, groupClientDocuments, playbookSectionStatus, typicalSeasons, type DocumentSource, type PlaybookSection } from "./clientHub";

type Db = PrismaClient | Prisma.TransactionClient;
export type HubViewer = { id: string; role: string };
const FILE_LIMIT = 300;
const MEETING_LIMIT = 200;

/**
 * Extra reads for the client hub on top of loadClientProfile: a fixed number of batched queries (no per-row
 * queries). Project files and Project meetings are only returned when the viewer may open that Project
 * (Admin, Project owner or member), the same rule as /api/projects/[id]/files.
 */
export async function loadClientHub(db: Db, client: ClientProfileData, viewer: HubViewer, programLabels: Record<string, string>, now: Date, options: { showRevenue: boolean }) {
  const opportunityIds = client.clientOpportunities.map((opportunity) => opportunity.id);
  const admin = viewer.role === "ADMIN";
  const projectAccess: Prisma.ProjectWhereInput = admin ? {} : { OR: [{ ownerId: viewer.id }, { members: { some: { userId: viewer.id } } }] };
  const [projects, playbookUpdates, files, projectMeetings, recaps, competitorLinks] = await Promise.all([
    // Same recognized Project set as loadClientRevenue24m (CLIENT, ON_PROCESS/DONE, onProcessAt set), without the window.
    db.project.findMany({
      where: { clientId: client.id, category: "CLIENT", status: { in: KPI_RECOGNIZED_STATUSES }, onProcessAt: { not: null } },
      orderBy: [{ onProcessAt: "desc" }, { id: "asc" }],
      select: { id: true, name: true, type: true, status: true, revenue: true, onProcessAt: true, executionStartAt: true, ownerId: true, members: { where: { userId: viewer.id }, select: { id: true }, take: 1 }, feedback: { select: { rating: true, note: true, caseStudy: true, updatedAt: true } } },
    }),
    db.clientPlaybookUpdate.findMany({ where: { clientId: client.id }, select: { section: true, updatedAt: true, updatedBy: { select: { id: true, name: true } } } }),
    db.projectFile.findMany({
      where: { OR: [{ clientId: client.id, projectId: null }, { opportunityId: { in: opportunityIds }, projectId: null }, { projectId: { not: null }, project: { clientId: client.id, ...projectAccess } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: FILE_LIMIT,
      select: { id: true, name: true, mimeType: true, size: true, createdAt: true, driveFileId: true, projectId: true, opportunityId: true, project: { select: { id: true, name: true } }, opportunity: { select: { id: true, name: true } }, uploader: { select: { id: true, name: true } } },
    }),
    db.meeting.findMany({
      where: { project: { clientId: client.id, ...projectAccess } },
      orderBy: [{ startAt: "desc" }, { id: "desc" }], take: MEETING_LIMIT,
      select: { id: true, title: true, startAt: true, status: true, project: { select: { id: true, name: true } } },
    }),
    db.meetingRecap.findMany({ where: { sentAt: { not: null }, meeting: { OR: [{ clientId: client.id }, { opportunityId: { in: opportunityIds } }, { project: { clientId: client.id, ...projectAccess } }] } }, select: { meetingId: true } }),
    opportunityIds.length ? db.opportunityCompetitor.findMany({ where: { opportunityId: { in: opportunityIds } }, select: { opportunityId: true, isWinner: true, competitor: { select: { name: true } } } }) : Promise.resolve([]),
  ]);

  // Header summary and health signals.
  const seasons = typicalSeasons(client.projects, client.persona.typicalMonths, programLabels);
  const summary = buildClientSummary({
    sinceYear: Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(client.createdAt)),
    projectCount: projects.length, revenue24m: client.revenue24m, showRevenue: options.showRevenue, seasons,
    vendorSelection: client.vendorSelection, quotesRequired: client.quotesRequired, valuedMost: client.valuedMost,
    vendorStatus: client.vendorStatus, vendorRegisteredUntil: client.vendorRegisteredUntil, now,
  });
  const confirmed = client.touchpoints.filter((touchpoint) => touchpoint.status === "CONFIRMED");
  const lastClosed = client.clientOpportunities.filter((o) => o.outcome !== null).sort((a, b) => (b.closedAt ?? b.updatedAt).getTime() - (a.closedAt ?? a.updatedAt).getTime())[0] ?? null;
  const health = buildHealthSignals({
    now, cadenceWeeks: client.cadenceWeeks, clientCreatedAt: client.createdAt,
    lastConfirmedTouchAt: confirmed[0]?.occurredAt ?? null,
    lastResponseAt: confirmed.find((touchpoint) => (touchpoint.outcomeLevel ?? 0) >= 2)?.occurredAt ?? null,
    projects, lastClosed: lastClosed ? { outcome: lastClosed.outcome!, closedAt: lastClosed.closedAt } : null,
  });

  // "Sắp tới": nearest open Opportunity with a month, else nearest active expected event.
  const today = vnDayStart(now);
  const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1) - 7 * 3600000);
  const thisMonth = monthStart(Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(now)), Number(new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(now)));
  const upcomingOpportunity = client.clientOpportunities
    .filter((o) => o.outcome === null && o.expectedMonth && monthStart(o.expectedYear, o.expectedMonth) >= thisMonth)
    .sort((a, b) => monthStart(a.expectedYear, a.expectedMonth!).getTime() - monthStart(b.expectedYear, b.expectedMonth!).getTime())[0] ?? null;
  const upcomingEvent = client.expectedEvents
    .filter((event) => event.status === "ACTIVE")
    .map((event) => ({ event, anchor: eventAnchorDate(event as EventTiming) }))
    .filter((item): item is { event: typeof item.event; anchor: Date } => !!item.anchor && item.anchor >= (item.event.precision === "DAY" ? today : thisMonth))
    .sort((a, b) => a.anchor.getTime() - b.anchor.getTime())[0] ?? null;

  // Collaboration history.
  const openOpportunities = client.clientOpportunities.filter((o) => o.outcome === null);
  const grid = buildHistoryGrid({ projects, openOpportunities, now });
  const projectRows = projects.map((project) => ({
    id: project.id, name: project.name, type: project.type, programLabel: programLabels[project.type] ?? project.type,
    date: project.executionStartAt ?? project.onProcessAt, revenue: options.showRevenue ? project.revenue : null, status: project.status,
    feedback: project.feedback, isMember: project.ownerId === viewer.id || project.members.length > 0,
  }));

  // Bids and lessons from fields already on Opportunity.
  const competitorsByOpportunity = new Map<string, string[]>();
  for (const link of competitorLinks) competitorsByOpportunity.set(link.opportunityId, [...(competitorsByOpportunity.get(link.opportunityId) ?? []), link.competitor.name]);
  const winners = new Map(competitorLinks.filter((link) => link.isWinner).map((link) => [link.opportunityId, link.competitor.name]));
  const bids = collectBidLessons(client.clientOpportunities.map((o) => ({ id: o.id, name: o.name, outcome: o.outcome, closedAt: o.closedAt, createdAt: o.createdAt, briefSummary: o.briefSummary, winStrategy: o.winStrategy, outcomeNote: o.outcomeNote, lessons: o.lessons, outcomeReasonLabel: o.outcomeReason?.label ?? null, competitors: competitorsByOpportunity.get(o.id) ?? [] })));

  // Documents.
  const documents = groupClientDocuments(files.map((file) => {
    const source: DocumentSource = file.projectId ? "PROJECT" : file.opportunityId ? "OPPORTUNITY" : "CLIENT";
    const href = file.projectId ? `/api/projects/${file.projectId}/files/${file.id}` : file.opportunityId ? `/api/crm/opportunities/${file.opportunityId}/files/${file.id}` : null;
    return { id: file.id, name: file.name, createdAt: file.createdAt, source, href, driveUrl: href ? null : storedFileDriveUrl(file), uploaderName: file.uploader?.name ?? null, context: file.project?.name ?? file.opportunity?.name ?? null };
  }));
  const recapIds = new Set(recaps.map((recap) => recap.meetingId));
  const meetings = [
    ...client.meetings.map((meeting) => ({ id: meeting.id, title: meeting.title, startAt: meeting.startAt, status: meeting.status, context: meeting.opportunity ? `Cơ hội: ${meeting.opportunity.name}` : null })),
    ...projectMeetings.filter((meeting) => !client.meetings.some((own) => own.id === meeting.id)).map((meeting) => ({ id: meeting.id, title: meeting.title, startAt: meeting.startAt, status: meeting.status, context: meeting.project ? `Dự án: ${meeting.project.name}` : null })),
  ].sort((a, b) => b.startAt.getTime() - a.startAt.getTime() || a.id.localeCompare(b.id)).map((meeting) => ({ ...meeting, hasRecap: recapIds.has(meeting.id) }));

  // Playbook.
  const sectionEmpty = playbookSectionStatus(client);
  const updates = Object.fromEntries(playbookUpdates.map((row) => [row.section, { at: row.updatedAt, by: row.updatedBy?.name ?? null }])) as Partial<Record<PlaybookSection, { at: Date; by: string | null }>>;

  return {
    summary, health, upcoming: upcomingOpportunity ? { kind: "OPPORTUNITY" as const, id: upcomingOpportunity.id, name: upcomingOpportunity.name, month: upcomingOpportunity.expectedMonth!, year: upcomingOpportunity.expectedYear, stage: upcomingOpportunity.stage }
      : upcomingEvent ? { kind: "EVENT" as const, id: upcomingEvent.event.id, name: upcomingEvent.event.programType.label, date: upcomingEvent.anchor, precision: upcomingEvent.event.precision } : null,
    grid, projectRows, bids, winners: Object.fromEntries(winners), documents, meetings,
    playbook: { empty: sectionEmpty, emptyCount: Object.values(sectionEmpty).filter(Boolean).length, updates },
  };
}
export type ClientHubData = Awaited<ReturnType<typeof loadClientHub>>;
