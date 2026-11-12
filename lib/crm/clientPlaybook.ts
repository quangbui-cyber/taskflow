import type { Prisma, PrismaClient } from "@prisma/client";
import { crmCanEditPlaybook, type CrmActor, type CrmOwnerResource } from "./policy";
import { logClientChanges } from "./clientService";
import { diffClientFields } from "./clientProfile";
import { normalizePlaybookInput, PLAYBOOK_SECTIONS, playbookHistoryValue, type PlaybookSection } from "./clientHub";

type Actor = CrmActor & { name: string };
export type PlaybookResult = { ok: true; version: number; changed: number } | { error: string };
const DENIED = "Bạn không có quyền sửa mục này. Liên hệ PIC hoặc AD/AM của team.";
const STALE = "Dữ liệu vừa được người khác cập nhật. Tải lại trang để xem bản mới.";
const INVALID = "Thông tin sổ tay không hợp lệ.";

export async function lockClientForEdit(tx: Prisma.TransactionClient, clientId: string) {
  await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
  const client = await tx.client.findUnique({ where: { id: clientId }, include: { picAccount: { select: { userId: true, teamId: true } } } });
  if (!client) return null;
  const resource: CrmOwnerResource = { kind: "CLIENT", picUserId: client.picAccount?.userId ?? null, teamId: client.responsibleTeamId ?? client.picAccount?.teamId ?? null };
  return { client, resource };
}

/**
 * Saves one playbook section with the client version (CAS). Only fields sent are touched, so two people
 * editing different sections each save their part after reloading; the same transaction writes the field
 * history and the per-section "who and when" row.
 */
export async function saveClientPlaybookSection(db: PrismaClient, actor: Actor, input: { clientId: string; expectedVersion: number; section: PlaybookSection; fields: Record<string, unknown> }): Promise<PlaybookResult> {
  if (!input || typeof input.clientId !== "string" || !input.clientId || input.clientId.length > 64 || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || !Object.hasOwn(PLAYBOOK_SECTIONS, input.section)) return { error: INVALID };
  const normalized = normalizePlaybookInput(input.section, input.fields);
  if ("error" in normalized) return normalized;
  return db.$transaction(async (tx) => {
    const locked = await lockClientForEdit(tx, input.clientId);
    if (!locked || !crmCanEditPlaybook(actor, locked.resource)) return { error: DENIED };
    const { client } = locked;
    if (client.version !== input.expectedVersion) return { error: STALE };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(normalized.data)) {
      before[field] = playbookHistoryValue(field, client[field as keyof typeof client]);
      after[field] = playbookHistoryValue(field, value);
    }
    const diffs = diffClientFields(before, after);
    if (!diffs.length) return { ok: true, version: client.version, changed: 0 };
    const changed = await tx.client.updateMany({ where: { id: client.id, version: input.expectedVersion }, data: { ...normalized.data, version: { increment: 1 } } });
    if (changed.count !== 1) return { error: STALE };
    await logClientChanges(tx, client.id, actor, diffs);
    await tx.clientPlaybookUpdate.upsert({
      where: { clientId_section: { clientId: client.id, section: input.section } },
      create: { clientId: client.id, section: input.section, updatedById: actor.id },
      update: { updatedById: actor.id, updatedAt: new Date() },
    });
    return { ok: true, version: input.expectedVersion + 1, changed: diffs.length };
  });
}
