import { prisma } from "../prisma";
import { driveConnected, moveDriveItem } from "../googleDrive";
import { ownerFolderKeys, projectYearFolder, rekeyOwnerFolders, syncOwnerSharingSafe } from "../driveStorage";

/** Called after the win commits. Offline folder identity transfer must still complete. */
export async function handOverOpportunityDrive(opportunityId: string, projectId: string): Promise<void> {
  try {
    await rekeyOwnerFolders(prisma, { kind: "OPPORTUNITY", id: opportunityId }, { kind: "PROJECT", id: projectId });
  } catch { console.warn("CRM Drive folder rekey failed."); }

  try {
    if (!await driveConnected()) return;
  } catch { console.warn("CRM Drive connection check failed."); return; }

  try {
    const [folder, project] = await Promise.all([
      prisma.driveFolder.findUnique({ where: { key: ownerFolderKeys({ kind: "PROJECT", id: projectId }).root }, select: { folderId: true } }),
      prisma.project.findUnique({ where: { id: projectId }, select: { name: true, createdAt: true } }),
    ]);
    if (folder && project) await moveDriveItem(folder.folderId, await projectYearFolder(project.createdAt), project.name);
  } catch { console.warn("CRM Drive folder move failed."); }

  try {
    await syncOwnerSharingSafe({ kind: "PROJECT", id: projectId });
  } catch { console.warn("CRM Drive sharing handover failed."); }
}

/** Recover wins interrupted before their DB keys moved. Open Opportunities have no Project. */
export async function retryOpportunityDriveHandovers(deadline: number): Promise<{ retried: number }> {
  let retried = 0;
  try {
    if (!Number.isFinite(deadline) || Date.now() >= deadline) return { retried };
    const folders = await prisma.driveFolder.findMany({ where: { key: { startsWith: "opportunity:" } }, select: { key: true } });
    const ids = folders.flatMap(({ key }) => {
      const parts = key.split(":");
      return parts.length === 2 && parts[1] ? [parts[1]] : [];
    });
    if (!ids.length || Date.now() >= deadline) return { retried };
    const projects = await prisma.project.findMany({ where: { sourceOpportunityId: { in: ids } }, select: { id: true, sourceOpportunityId: true }, take: 50 });
    for (const project of projects) {
      if (Date.now() >= deadline) break;
      if (!project.sourceOpportunityId) continue;
      await handOverOpportunityDrive(project.sourceOpportunityId, project.id);
      retried++;
    }
  } catch { console.warn("CRM Drive handover retry failed."); }
  return { retried };
}
