import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { AiSourceNotFoundError, prismaAiScopeReader } from "@/lib/ai/access/resolveAiReadScope";
import { readAiRun } from "@/lib/ai/runs/aiRunService";
import { prismaAiSourceStore } from "@/lib/ai/sources/sourceRevisions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const missing = () => new Response("Not found", { status: 404, headers: privateHeaders });

export async function GET(_request: Request, { params }: {
  params: Promise<{ id: string; runId: string; revisionId: string }>;
}) {
  const actor = await getCurrentUser();
  if (!actor) return missing();
  const { id, runId, revisionId } = await params;
  try {
    await readAiRun(actor.id, id, runId);
    const linked = await prisma.aiRunSource.findFirst({ where: {
      runId, sourceRevisionId: revisionId, run: { projectId: id, actorId: actor.id },
    }, select: { sourceRevision: { select: { originKind: true, originId: true,
      originVersion: true, sha256: true, filename: true, mimeType: true, snapshotBytes: true } } } });
    if (!linked) return missing();
    const revision = linked.sourceRevision;
    const metadata = await prismaAiScopeReader.source({
      kind: revision.originKind as Parameters<typeof prismaAiScopeReader.source>[0]["kind"],
      id: revision.originId,
    }, id);
    if (!metadata || metadata.version !== revision.originVersion) return missing();
    const bytes = revision.snapshotBytes ? new Uint8Array(revision.snapshotBytes) :
      await prismaAiSourceStore.readBytes(metadata);
    if (createHash("sha256").update(bytes).digest("hex") !== revision.sha256) return missing();
    const disposition = ["application/pdf", "text/plain"].includes(revision.mimeType) ? "inline" : "attachment";
    return new Response(new Uint8Array(bytes), { headers: {
      ...privateHeaders, "Content-Type": revision.mimeType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(revision.filename)}`,
    } });
  } catch (error) {
    if (error instanceof AiSourceNotFoundError) return missing();
    throw error;
  }
}
