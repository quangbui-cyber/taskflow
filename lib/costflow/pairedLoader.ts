import "server-only";

import { prisma } from "@/lib/prisma";
import { emptyFinance, type FinanceData } from "./types";
import {
  selectPairedWorkspace,
  type PairedFinance,
  type PairedRouteParams,
} from "./pairedReadModel";
import { listCompanySuppliers } from "./supplierReadModel";

type Actor = { id: string; role: string };

export async function loadPairedFinance(
  projectId: string,
  actor: Actor,
  params: PairedRouteParams,
): Promise<{ finance: PairedFinance; resolvedQuotationId?: string } | null> {
  const [project, workspace, ddGrant] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        client: { select: { id: true, name: true } },
        members: { where: { userId: actor.id }, select: { userId: true } },
      },
    }),
    prisma.costFlowWorkspace.findUnique({
      where: { projectId },
      select: { data: true, version: true },
    }),
    prisma.workflowRoleGrant.findFirst({
      where: { userId: actor.id, role: "AC_DD", revokedAt: null },
      select: { id: true },
    }),
  ]);
  if (!project || !["ACCOUNT", "ADMIN"].includes(actor.role)) return null;

  const source = workspace?.data
    ? workspace.data as unknown as FinanceData
    : emptyFinance();
  const fullAccess = actor.role === "ADMIN"
    || Boolean(ddGrant)
    || source.config.accountantId === actor.id
    || project.members.some(member => member.userId === actor.id);
  if (!fullAccess || source.closed) return null;

  const selection = selectPairedWorkspace(source, actor.id, params);
  if (!selection) return null;

  const [clients, suppliers, files, evidence, requests] = await Promise.all([
    prisma.client.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    listCompanySuppliers(prisma),
    prisma.projectFile.findMany({
      where: { projectId },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.costFlowEvidence.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        kind: true,
        requestId: true,
        sha256: true,
        mimeType: true,
      },
    }),
    selection.requestIds.length
      ? prisma.workflowRequest.findMany({
          where: { id: { in: selection.requestIds }, projectId, module: "COSTFLOW" },
          select: { id: true, state: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    finance: {
      project,
      clients,
      suppliers,
      fullAccess: true,
      version: workspace?.version ?? 0,
      data: selection.data,
      requests,
      files,
      evidence,
    },
    resolvedQuotationId: selection.resolvedQuotationId,
  };
}
