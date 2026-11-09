import type { Prisma, PrismaClient } from "@prisma/client";
import type { ProjectFileDTO } from "../../components/ProjectFilesPanel";
import { storedFileDriveUrl } from "../storedFileResponse";
import { isClosedTaskStatus } from "../types";
import { vnDayStart } from "./dates";
import { formatExpectedTiming } from "./opportunityFormat";

type Db = PrismaClient | Prisma.TransactionClient;
/** CRM projections contain no access decisions; callers check the persisted resource. */
export async function loadOpportunityDetail(db: Db, opportunityId: string, now: Date) {
  const opportunity = await db.opportunity.findUnique({ where: { id: opportunityId }, include: {
    client: { select: { id: true, name: true } }, buyingUnit: { select: { name: true } }, programType: { select: { label: true } },
    picAccount: { select: { id: true, name: true, userId: true, team: { select: { id: true, name: true } } } },
    responsibleTeam: { select: { id: true, name: true } }, outcomeReason: { select: { label: true } }, expectedEvent: { select: { source: true } },
    opportunityStageEvents: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }] },
    project: { select: { id: true, name: true } },
  } });
  if (!opportunity) return null;
  const workWhere = opportunity.outcome === "WON" ? { sourceOpportunityId: opportunityId } : { opportunityId };
  const [taskRows, fileRows, meetingRows, touchpoints] = await Promise.all([
    db.task.findMany({ where: workWhere, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }], include: {
      assignee: { select: { id: true, name: true, avatarUrl: true } }, creator: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, color: true } }, opportunity: { select: { id: true, name: true } }, client: { select: { id: true, name: true } },
      _count: { select: { comments: true, files: true } },
    } }),
    db.projectFile.findMany({ where: workWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: {
      id: true, name: true, mimeType: true, size: true, createdAt: true, driveFileId: true, uploader: { select: { id: true, name: true, avatarUrl: true } },
    } }),
    db.meeting.findMany({ where: workWhere, orderBy: [{ startAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, title: true, startAt: true, projectId: true } }),
    db.touchpoint.findMany({ where: { opportunityId, status: { in: ["CONFIRMED", "DRAFT"] } }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 50, select: {
      id: true, occurredAt: true, kind: true, author: { select: { name: true } }, outcomeLevel: true, notes: true, status: true,
    } }),
  ]);
  const tasks = taskRows.sort((a, b) => Number(isClosedTaskStatus(a.status)) - Number(isClosedTaskStatus(b.status)));
  const next = tasks.find(task => !isClosedTaskStatus(task.status));
  const files: ProjectFileDTO[] = fileRows.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, createdAt: file.createdAt.toISOString(), driveUrl: storedFileDriveUrl(file), uploader: file.uploader }));
  return {
    id: opportunity.id, name: opportunity.name, version: opportunity.version, stage: opportunity.stage, outcome: opportunity.outcome,
    client: opportunity.client, buyingUnitName: opportunity.buyingUnit?.name ?? null, programTypeCode: opportunity.programTypeCode, programTypeLabel: opportunity.programType.label,
    timingLabel: formatExpectedTiming(opportunity), expectedEventSource: opportunity.expectedEvent?.source ?? null,
    budgetMin: opportunity.budgetMin === null ? null : Number(opportunity.budgetMin), budgetMax: opportunity.budgetMax === null ? null : Number(opportunity.budgetMax),
    contractValue: opportunity.contractValue === null ? null : Number(opportunity.contractValue), wonAt: opportunity.wonAt,
    pic: opportunity.picAccount ? { accountId: opportunity.picAccount.id, name: opportunity.picAccount.name, userId: opportunity.picAccount.userId } : null,
    team: opportunity.responsibleTeam ?? opportunity.picAccount?.team ?? null,
    source: opportunity.source, demandSignal: opportunity.demandSignal, briefReceivedAt: opportunity.briefReceivedAt, proposalDueAt: opportunity.proposalDueAt,
    briefSummary: opportunity.briefSummary, winStrategy: opportunity.winStrategy, proposalPlannedAt: opportunity.proposalPlannedAt,
    outcomeReasonLabel: opportunity.outcomeReason?.label ?? null, outcomeNote: opportunity.outcomeNote, lessons: opportunity.lessons,
    legacyStatus: opportunity.legacyStatus, closedAt: opportunity.closedAt, project: opportunity.project,
    stageEvents: opportunity.opportunityStageEvents.map(event => ({ id: event.id, fromStage: event.fromStage, toStage: event.toStage, outcome: event.outcome, actorName: event.actorName, occurredAt: event.occurredAt })),
    tasks, nextStep: next ? { taskId: next.id, title: next.title, assigneeName: next.assignee?.name ?? null, dueDate: next.dueDate, overdue: !!next.dueDate && next.dueDate < vnDayStart(now), escalated: next.escalatedAt !== null } : null,
    files, meetings: meetingRows.map(row => ({ id: row.id, title: row.title, startsAt: row.startAt, projectId: row.projectId })),
    touchpoints: touchpoints.map(row => ({ id: row.id, occurredAt: row.occurredAt, kind: row.kind, authorName: row.author?.name ?? null, outcomeLevel: row.outcomeLevel, notes: row.notes, status: row.status })),
    openBidPrepTaskCount: tasks.filter(task => task.crmKind === "BID_PREP" && !isClosedTaskStatus(task.status)).length,
  };
}
export type OpportunityDetail = NonNullable<Awaited<ReturnType<typeof loadOpportunityDetail>>>;
