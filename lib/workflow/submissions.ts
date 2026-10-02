import "server-only";
import { prisma } from "@/lib/prisma";
import { loadDocument } from "./service";
import type { DocumentPayload } from "./documents";
import type { ApprovalStep } from "./approval";

export function submittedFileIds(body: DocumentPayload): string[] | null {
  const manifest = body.submittedFiles;
  return manifest?.schemaVersion === 1 ? [manifest.mainFileId,...Object.values(manifest.supportingFiles),...manifest.referenceFileIds] : null;
}

export async function loadSubmissionView(requestId: string, selection: string | undefined, actor: {id:string;role:string}) {
  const current = await loadDocument(requestId,actor);
  if (!current) return null;
  const documents = new Map<string,NonNullable<typeof current>>([[requestId,current]]);
  const queue = [current];
  const seen = new Set([requestId]);
  while (queue.length && seen.size < 100) {
    const document = queue.shift()!;
    const children = await prisma.workflowRequest.findMany({where:{parentId:document.request.id,module:"WORKFLOW"},select:{id:true}});
    const candidates = [...children.map(child=>child.id),...(document.request.parentId ? [document.request.parentId] : [])];
    for (const id of candidates) {
      if (seen.has(id)) continue; seen.add(id);
      const candidate = await loadDocument(id,actor);
      if (!candidate || candidate.request.kind !== current.request.kind || candidate.request.creatorId !== document.request.creatorId) continue;
      // Traverse only actual directed parent edges; unauthorized branches stop here.
      if (candidate.request.parentId !== document.request.id && document.request.parentId !== candidate.request.id) continue;
      documents.set(id,candidate); queue.push(candidate);
    }
  }
  const histories = await prisma.workflowHistory.findMany({where:{requestId:{in:[...documents.keys()]},action:"SUBMIT_DOCUMENT"},orderBy:[{createdAt:"asc"},{id:"asc"}]});
  const attempts = histories.map((h,index)=>({id:h.id,requestId:h.requestId,number:index+1,createdAt:h.createdAt}));
  if (!selection || selection === "current") return {detail:current,attempts,historical:false,selection:"current",currentRequestId:requestId,legacyMissingManifest:false};
  const history = histories.find(h=>h.id===selection);
  if (!history) return null;
  const source = documents.get(history.requestId)!;
  const snapshot = history.snapshot as unknown as {title:string;projectId:string|null;templateId:string|null;state:string;steps:ApprovalStep[];currentStep:number;payload:DocumentPayload};
  if (!snapshot || !snapshot.payload || snapshot.templateId !== source.request.templateId) return null;
  const ids = submittedFileIds(snapshot.payload);
  const manifest = snapshot.payload.submittedFiles;
  const files = source.request.files.filter(f=> {
    if (f.kind === "REFERENCE" || f.kind === "SIGNED") return true;
    if (!ids?.includes(f.id)) return false;
    return f.kind === "MAIN" && f.id===manifest?.mainFileId || f.kind === "SUPPORTING" && Object.values(manifest?.supportingFiles ?? {}).includes(f.id);
  });
  const selectedProject = snapshot.projectId ? await prisma.project.findUnique({where:{id:snapshot.projectId},select:{id:true,name:true}}) : null;
  return {detail:{...source,canTransfer:false,linked:null,request:{...source.request,...snapshot,project:selectedProject,files,decisions:[],history:[]}},attempts,historical:true,selection:history.id,currentRequestId:requestId,legacyMissingManifest:ids===null};
}
