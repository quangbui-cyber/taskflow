import "server-only";

import { prisma } from "@/lib/prisma";

export type KnowledgeSource = {
  originKind: string;
  authorityStatus: string;
  projectId: string | null;
  publicationStatus: string | null;
};

const RECORD_KINDS = new Set([
  "COSTFLOW_PO", "COSTFLOW_IC", "FINANCE_SHEET", "VENDOR_INVOICE_FILE",
  "COSTFLOW_EVIDENCE", "EXCEL_INTAKE_SOURCE",
]);

export function isAuthoritativeKnowledgeSource(source: KnowledgeSource): boolean {
  if (source.originKind === "SOP" || source.originKind === "POLICY") {
    return source.projectId === null && source.authorityStatus === "CONFIRMED" &&
      source.publicationStatus === "PUBLISHED";
  }
  return !!source.projectId && RECORD_KINDS.has(source.originKind) &&
    source.authorityStatus === "CONFIRMED" && source.publicationStatus === null;
}

export function assertKnowledgePublisher(
  actor: { id: string; role: string; isActive: boolean },
  configuredRole = process.env.AI_KNOWLEDGE_PUBLISHER_ROLE,
): void {
  if (!configuredRole || !actor.isActive || actor.role !== configuredRole) {
    throw new Error("Knowledge publication is disabled or unauthorized.");
  }
}

export async function publishKnowledgeRevision(input: {
  actorId: string;
  sourceRevisionId: string;
  supersedesId?: string;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}) {
  const actor = await prisma.user.findUnique({
    where: { id: input.actorId }, select: { id: true, role: true, isActive: true },
  });
  if (!actor) throw new Error("Knowledge publication is disabled or unauthorized.");
  assertKnowledgePublisher(actor);
  return prisma.$transaction(async (tx) => {
    const source = await tx.aiSourceRevision.findUnique({ where: { id: input.sourceRevisionId } });
    if (!source || source.projectId !== null || source.scopeKey !== "GLOBAL" ||
        !["SOP", "POLICY"].includes(source.originKind) || source.authorityStatus !== "CONFIRMED") {
      throw new Error("Only confirmed global SOP or policy revisions can be published.");
    }
    const existing = await tx.aiKnowledgePublication.findMany({
      where: { sourceRevisionId: source.id }, orderBy: { publicationVersion: "desc" }, take: 1,
    });
    const previous = input.supersedesId ? await tx.aiKnowledgePublication.findUnique({
      where: { id: input.supersedesId }, include: { sourceRevision: { select: { originId: true } } },
    }) : null;
    if (input.supersedesId && (!previous || previous.status !== "PUBLISHED" ||
        previous.scopeKey !== "GLOBAL" || previous.sourceRevision.originId !== source.originId)) {
      throw new Error("Invalid publication supersession.");
    }
    if (input.effectiveFrom && input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
      throw new Error("Invalid effective interval.");
    }
    const draft = await tx.aiKnowledgePublication.create({ data: {
      sourceRevisionId: source.id, scopeKey: "GLOBAL", publicationVersion: (existing[0]?.publicationVersion ?? 0) + 1,
      status: "DRAFT", effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
      publishedById: actor.id, supersedesId: previous?.id,
    } });
    const published = await tx.aiKnowledgePublication.update({
      where: { id: draft.id }, data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    if (previous) await tx.aiKnowledgePublication.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
    return published;
  });
}
