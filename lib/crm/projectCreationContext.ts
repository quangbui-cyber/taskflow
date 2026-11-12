import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { crmEnabledForUser } from "./access";
import { getCrmSettings } from "./settings";
import type { ProjectCreationContext } from "./projectCreation";

export async function loadProjectCreationContext(db: PrismaClient | Prisma.TransactionClient, userId: string): Promise<ProjectCreationContext> {
  const crmOn = await crmEnabledForUser(db, { id: userId });
  // The disabled feature must not require CRM tables to keep the old Project flow alive.
  if (!crmOn) return { crmOn, setting: { mode: "PROJECT_OFFICIAL", pilotTeamIds: [], plannedCutoverDate: null }, actorTeamId: null };
  const [settings, account] = await Promise.all([
    getCrmSettings(db),
    db.account.findUnique({ where: { userId }, select: { teamId: true } }),
  ]);
  return { crmOn, setting: settings.pipelineMode, actorTeamId: account?.teamId ?? null };
}
