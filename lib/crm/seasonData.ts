import type { Prisma, PrismaClient } from "@prisma/client";
import { KPI_RECOGNIZED_STATUSES } from "../kpi";
import { vnDateKey } from "./dates";
import { revenue24mWindow } from "./tier";
import type { SeasonEventInput, SeasonProjectInput } from "./seasonGrid";

export async function loadSeasonGridInput(db: PrismaClient | Prisma.TransactionClient, clientId: string, now: Date): Promise<{ projects: SeasonProjectInput[]; events: SeasonEventInput[] }> {
  const { start, end } = revenue24mWindow(now);
  const [projects, events] = await Promise.all([
    db.project.findMany({
      where: { clientId, category: "CLIENT", status: { in: KPI_RECOGNIZED_STATUSES }, OR: [
        { executionStartAt: { gte: start, lt: end } },
        { executionStartAt: null, onProcessAt: { gte: start, lt: end } },
      ] },
      select: { id: true, name: true, type: true, executionStartAt: true, onProcessAt: true },
      orderBy: [{ executionStartAt: "asc" }, { onProcessAt: "asc" }, { id: "asc" }],
    }),
    db.expectedEvent.findMany({
      where: { clientId, status: { in: ["ACTIVE", "BRIEF_RECEIVED"] }, year: { gte: Number(vnDateKey(now).slice(0, 4)) - 1 } },
      select: { id: true, programTypeCode: true, precision: true, year: true, month: true, quarter: true, date: true, source: true, status: true, revision: true, buyingUnitId: true, buyingUnit: { select: { name: true } }, note: true,
        expectedEventSteps: { orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: { id: true, kind: true, offsetDays: true, dueDate: true, status: true, revision: true } } },
      orderBy: [{ year: "asc" }, { month: "asc" }, { quarter: "asc" }, { date: "asc" }, { id: "asc" }],
    }),
  ]);
  return { projects, events: events.filter(event => ["DAY", "MONTH", "QUARTER"].includes(event.precision) && ["CLIENT_CONFIRMED", "HISTORY", "INDUSTRY_SEASON"].includes(event.source)).map(({ buyingUnit, expectedEventSteps, ...event }) => ({ ...event, precision: event.precision as SeasonEventInput["precision"], source: event.source as SeasonEventInput["source"], buyingUnitName: buyingUnit?.name ?? null, steps: expectedEventSteps })) };
}
