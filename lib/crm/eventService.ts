import type { Prisma, PrismaClient } from "@prisma/client";
import { OPEN_TASK_STATUS_FILTER } from "../types";
import { loadClientResource } from "./actor";
import { vnDateKey } from "./dates";
import { crmCan, type CrmActor } from "./policy";
import { planReminderSteps, rescheduleSteps, type EventTiming, type ExistingStep } from "./reminders";
import { getCrmSettings } from "./settings";

type Actor = CrmActor & { name: string };
type Failure = { error: string };
type EventInput = EventTiming & { clientId: string; buyingUnitId: string | null; programTypeCode: string; source: string; note: string | null };
const INVALID = "Thông tin sự kiện dự kiến không hợp lệ.";
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 64;

export function validateExpectedEventInput(raw: unknown): { value: EventInput } | Failure {
  if (!record(raw) || !id(raw.clientId) || typeof raw.programTypeCode !== "string" || !/^[A-Z][A-Z0-9_]{1,31}$/.test(raw.programTypeCode) || !Number.isInteger(raw.year) || Number(raw.year) < 2000 || Number(raw.year) > 2100 || !["CLIENT_CONFIRMED", "HISTORY", "INDUSTRY_SEASON"].includes(String(raw.source))) return { error: INVALID };
  if ((raw.buyingUnitId != null && !id(raw.buyingUnitId)) || (raw.note != null && (typeof raw.note !== "string" || raw.note.length > 2000))) return { error: INVALID };
  let date: Date | null = null; let month: number | null = null; let quarter: number | null = null;
  if (raw.precision === "DAY") {
    if (raw.date instanceof Date) date = new Date(raw.date);
    else if (typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw.date) && raw.date.length <= 40) date = new Date(raw.date.length === 10 ? `${raw.date}T00:00:00+07:00` : raw.date);
    if (!date || !Number.isFinite(date.getTime()) || Number(vnDateKey(date).slice(0, 4)) !== raw.year || (typeof raw.date === "string" && raw.date.length === 10 && vnDateKey(date) !== raw.date) || raw.quarter != null) return { error: INVALID };
    month = Number(vnDateKey(date).slice(5, 7));
    if (raw.month != null && raw.month !== month) return { error: INVALID };
  } else if (raw.precision === "MONTH") {
    if (!Number.isInteger(raw.month) || Number(raw.month) < 1 || Number(raw.month) > 12 || raw.quarter != null || raw.date != null) return { error: INVALID };
    month = Number(raw.month);
  } else if (raw.precision === "QUARTER") {
    if (!Number.isInteger(raw.quarter) || Number(raw.quarter) < 1 || Number(raw.quarter) > 4 || raw.month != null || raw.date != null) return { error: INVALID };
    quarter = Number(raw.quarter);
  } else return { error: INVALID };
  return { value: { clientId: raw.clientId, buyingUnitId: (raw.buyingUnitId as string | null) ?? null, programTypeCode: raw.programTypeCode, precision: raw.precision, year: Number(raw.year), month, quarter, date, source: String(raw.source), note: typeof raw.note === "string" ? raw.note.trim() || null : null } };
}

async function lockClient(tx: Prisma.TransactionClient, actor: Actor, clientId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientId}))`;
  await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
  const resource = await loadClientResource(tx, clientId);
  return resource && crmCan(actor, "EDIT", resource);
}
async function validTargets(tx: Prisma.TransactionClient, input: EventInput) {
  const program = await tx.programType.findUnique({ where: { code: input.programTypeCode }, select: { active: true } });
  return !!program?.active && (!input.buyingUnitId || !!await tx.buyingUnit.findFirst({ where: { id: input.buyingUnitId, clientId: input.clientId, active: true }, select: { id: true } }));
}

export async function createExpectedEvent(db: PrismaClient, actor: Actor, raw: unknown): Promise<{ ok: true; eventId: string; clientId: string; steps: number } | Failure> {
  const parsed = validateExpectedEventInput(raw); if ("error" in parsed) return parsed;
  const input = parsed.value;
  return db.$transaction(async tx => {
    if (!await lockClient(tx, actor, input.clientId)) return { error: DENIED };
    if (!await validTargets(tx, input)) return { error: INVALID };
    const settings = await getCrmSettings(tx);
    const steps = planReminderSteps(input, settings.reminderOffsets[input.programTypeCode] ?? [], new Date());
    const event = await tx.expectedEvent.create({ data: { ...input, createdById: actor.id, expectedEventSteps: { create: steps.map(step => ({ ...step, revision: 0, status: "PLANNED" })) } } });
    return { ok: true as const, eventId: event.id, clientId: event.clientId, steps: steps.length };
  });
}

export async function updateExpectedEvent(db: PrismaClient, actor: Actor, raw: unknown): Promise<{ ok: true; clientId: string; recomputed: number } | Failure> {
  if (!record(raw) || !id(raw.eventId)) return { error: INVALID };
  const parsed = validateExpectedEventInput(raw); if ("error" in parsed) return parsed;
  const input = parsed.value; const eventId = raw.eventId;
  return db.$transaction(async tx => {
    if (!await lockClient(tx, actor, input.clientId)) return { error: DENIED };
    await tx.$queryRaw`SELECT id FROM "ExpectedEvent" WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.expectedEvent.findUnique({ where: { id: eventId }, include: { expectedEventSteps: true } });
    if (!event || event.clientId !== input.clientId) return { error: DENIED };
    if (event.status !== "ACTIVE") return { error: "Sự kiện dự kiến đã kết thúc." };
    if (!await validTargets(tx, input)) return { error: INVALID };
    const settings = await getCrmSettings(tx);
    const next = planReminderSteps(input, settings.reminderOffsets[input.programTypeCode] ?? [], new Date());
    const changes = rescheduleSteps(event.expectedEventSteps as ExistingStep[], next);
    const revision = event.revision + 1;
    await tx.expectedEvent.update({ where: { id: eventId }, data: { ...input, revision } });
    await tx.reminderStep.updateMany({ where: { id: { in: changes.supersedeIds } }, data: { status: "SUPERSEDED" } });
    for (const step of changes.retarget) {
      await tx.reminderStep.update({ where: { id: step.stepId }, data: { dueDate: step.dueDate } });
      if (step.taskId) await tx.task.updateMany({ where: { id: step.taskId, status: OPEN_TASK_STATUS_FILTER }, data: { dueDate: step.dueDate } });
    }
    if (changes.create.length) await tx.reminderStep.createMany({ data: changes.create.map(step => ({ ...step, expectedEventId: eventId, revision, status: "PLANNED" })) });
    return { ok: true as const, clientId: input.clientId, recomputed: changes.retarget.length + changes.create.length };
  });
}

export async function cancelExpectedEvent(db: PrismaClient, actor: Actor, eventId: string): Promise<{ ok: true; clientId: string } | Failure> {
  if (!id(eventId)) return { error: INVALID };
  return db.$transaction(async tx => {
    const initial = await tx.expectedEvent.findUnique({ where: { id: eventId }, select: { clientId: true } });
    if (!initial || !await lockClient(tx, actor, initial.clientId)) return { error: DENIED };
    await tx.$queryRaw`SELECT id FROM "ExpectedEvent" WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.expectedEvent.findUniqueOrThrow({ where: { id: eventId }, include: { expectedEventSteps: true } });
    if (event.status === "BRIEF_RECEIVED") return { error: "Sự kiện đã nhận Brief." };
    const reason = "Sự kiện dự kiến đã hủy";
    await tx.expectedEvent.update({ where: { id: eventId }, data: { status: "CANCELLED" } });
    await tx.reminderStep.updateMany({ where: { expectedEventId: eventId, status: "PLANNED" }, data: { status: "SUPERSEDED" } });
    const taskIds = [...new Set(event.expectedEventSteps.filter(s => s.status === "OPEN" && s.taskId).map(s => s.taskId!))];
    await tx.reminderStep.updateMany({ where: { expectedEventId: eventId, status: "OPEN" }, data: { status: "CLOSED", closedReason: reason } });
    for (const taskId of taskIds) {
      // A consolidated task may still represent another active event.
      if (!await tx.reminderStep.count({ where: { taskId, status: "OPEN", expectedEvent: { status: "ACTIVE" } } })) await tx.task.updateMany({ where: { id: taskId, status: OPEN_TASK_STATUS_FILTER }, data: { status: "CANCELLED", closedReason: reason } });
    }
    return { ok: true as const, clientId: initial.clientId };
  });
}
