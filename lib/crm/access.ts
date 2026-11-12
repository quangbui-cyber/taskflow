import type { Prisma, PrismaClient } from "@prisma/client";
import { cache } from "react";
import { prisma } from "../prisma";
import { crmAccessFor, crmEnabled, parseCrmAccessUsers, CRM_ACCESS_SETTING_KEY } from "../features";

type Db = PrismaClient | Prisma.TransactionClient;

/** crm54: the stored list, strictly parsed. Missing or malformed means an empty list (Admin only). */
export async function loadCrmAccessUserIds(db: Db): Promise<string[]> {
  const row = await db.crmSetting.findUnique({ where: { key: CRM_ACCESS_SETTING_KEY }, select: { value: true } });
  return parseCrmAccessUsers(row?.value) ?? [];
}

/** Read from the database on every call: role and active state come from the stored user, not the session. */
export async function crmEnabledForUser(db: Db, user: { id: string } | null | undefined): Promise<boolean> {
  if (!crmEnabled() || !user?.id) return false;
  const [stored, accessUserIds] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { id: true, role: true, isActive: true, deletedAt: true } }),
    loadCrmAccessUserIds(db),
  ]);
  return crmAccessFor(stored, { enabled: true, accessUserIds });
}

/** Per-request memo for server components; server actions and route handlers still read fresh each request. */
const allowedForRequest = cache((userId: string) => crmEnabledForUser(prisma, { id: userId }));
export function crmAllowed(user: { id: string } | null | undefined): Promise<boolean> {
  if (!crmEnabled() || !user?.id) return Promise.resolve(false);
  return allowedForRequest(user.id);
}

/** Prisma filter for users who may see CRM: active Admins plus active listed users. */
export function crmAllowedUserWhere(accessUserIds: readonly string[]): Prisma.UserWhereInput {
  return { isActive: true, deletedAt: null, OR: [{ role: "ADMIN" }, { id: { in: [...accessUserIds] } }] };
}

/** Subset of userIds allowed to receive CRM tasks, notifications and pushes. Flag off returns none. */
export async function filterCrmAllowedUserIds(db: Db, userIds: readonly string[]): Promise<string[]> {
  if (!crmEnabled() || !userIds.length) return [];
  const accessUserIds = await loadCrmAccessUserIds(db);
  const rows = await db.user.findMany({ where: { AND: [{ id: { in: [...new Set(userIds)] } }, crmAllowedUserWhere(accessUserIds)] }, select: { id: true } });
  const allowed = new Set(rows.map(({ id }) => id));
  return userIds.filter((id) => allowed.has(id));
}

/** All user ids allowed to use CRM now (Admins plus active listed users). */
export async function listCrmAllowedUserIds(db: Db): Promise<string[]> {
  if (!crmEnabled()) return [];
  const rows = await db.user.findMany({ where: crmAllowedUserWhere(await loadCrmAccessUserIds(db)), select: { id: true } });
  return rows.map(({ id }) => id);
}

/** Limited mode: CRM on and opened per person. This plan has no company-wide mode, so it follows the master switch. */
export function crmLimitedAccessActive(): boolean { return crmEnabled(); }

/**
 * Library guard for CRM-owned work (Client/Opportunity tasks, files, assignees): denies only while CRM is on
 * and the user is outside the list. With CRM off the existing callers keep their own flag checks unchanged.
 */
export async function crmDeniedForUser(db: Db, user: { id: string } | null | undefined): Promise<boolean> {
  return crmEnabled() && !(await crmEnabledForUser(db, user));
}
