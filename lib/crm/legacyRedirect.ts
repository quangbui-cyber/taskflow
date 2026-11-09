import type { Prisma, PrismaClient } from "@prisma/client";

export async function legacyProjectRedirectHref(db: PrismaClient | Prisma.TransactionClient, projectId: string): Promise<string | null> {
  const opportunity = await db.opportunity.findUnique({ where: { legacyProjectId: projectId }, select: { id: true } });
  return opportunity ? `/crm/opportunities/${opportunity.id}` : null;
}
