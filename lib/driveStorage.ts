import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DOCX_MIME,
  DriveNotConnectedError,
  GOOGLE_DOC_MIME_TYPE,
  createDriveFolder,
  driveConnected,
  driveFolderName,
  listDirectPermissions,
  recordDriveError,
  renameDriveItem,
  shareDriveItem,
  sharedDriveId,
  trashDriveItem,
  unshareDriveItem,
  uploadDriveFile,
} from "@/lib/googleDrive";

/**
 * Lưu file dự án và file task trên Shared Drive:
 *
 *   <năm>/<Tên dự án>/Tài liệu/          ← tab Tài liệu dự án, biên bản họp (Google Doc)
 *   <năm>/<Tên dự án>/Công việc/<task>/  ← tệp giao việc và tệp kết quả
 *
 * File luôn được ghi vào database trước (như cũ), rồi đẩy lên Drive và xoá nội dung khỏi database.
 * Nhờ vậy khi Drive chưa kết nối hoặc Google lỗi, app vẫn chạy và lần sau đẩy tiếp.
 */

const SYNC_STALE_MS = 10 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DOCS_FOLDER_NAME = "Tài liệu";
export const TASKS_FOLDER_NAME = "Công việc";

export const driveFolderKeys = {
  year: (year: number) => `year:${year}`,
  project: (projectId: string) => `project:${projectId}`,
  docs: (projectId: string) => `project:${projectId}:docs`,
  tasks: (projectId: string) => `project:${projectId}:tasks`,
  task: (taskId: string) => `task:${taskId}`,
};

/** Năm của dự án theo giờ Việt Nam (thư mục năm). */
export function projectYear(createdAt: Date) {
  return new Date(createdAt.getTime() + VN_OFFSET_MS).getUTCFullYear();
}

/** Biên bản họp lưu dạng .docx trong app, lên Drive thì thành Google Doc (bỏ đuôi .docx). */
export function googleDocName(name: string) {
  return name.replace(/\.docx$/i, "");
}

async function ensureFolder(key: string, name: string, parentId: string): Promise<string> {
  const existing = await prisma.driveFolder.findUnique({ where: { key } });
  if (existing) return existing.folderId;
  const folderId = await createDriveFolder(name, parentId);
  try {
    await prisma.driveFolder.create({ data: { key, folderId, name: driveFolderName(name) } });
    return folderId;
  } catch (error) {
    // Hai lượt cùng tạo một thư mục: giữ thư mục đã lưu trước, bỏ thư mục vừa tạo.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await trashDriveItem(folderId).catch(() => undefined);
      const winner = await prisma.driveFolder.findUnique({ where: { key } });
      if (winner) return winner.folderId;
    }
    throw error;
  }
}

async function projectFolder(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, name: true, createdAt: true },
  });
  const year = projectYear(project.createdAt);
  const yearId = await ensureFolder(driveFolderKeys.year(year), String(year), sharedDriveId());
  const folderId = await ensureFolder(driveFolderKeys.project(project.id), project.name, yearId);
  return folderId;
}

export async function projectDocsFolder(projectId: string) {
  const root = await projectFolder(projectId);
  return ensureFolder(driveFolderKeys.docs(projectId), DOCS_FOLDER_NAME, root);
}

export async function taskFolder(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { id: true, title: true, projectId: true } });
  const root = await projectFolder(task.projectId);
  const tasksId = await ensureFolder(driveFolderKeys.tasks(task.projectId), TASKS_FOLDER_NAME, root);
  return ensureFolder(driveFolderKeys.task(task.id), task.title, tasksId);
}

// ---------- Đẩy file lên Drive ----------

type PushResult = { pushed: number; failed: number; notConnected: boolean };

function staleBefore() {
  return new Date(Date.now() - SYNC_STALE_MS);
}

const pendingWhere = () => ({
  data: { not: null },
  OR: [{ driveSyncStartedAt: null }, { driveSyncStartedAt: { lt: staleBefore() } }],
});

async function pushProjectFile(id: string): Promise<boolean> {
  const claimedAt = new Date();
  const claim = await prisma.projectFile.updateMany({ where: { id, ...pendingWhere() }, data: { driveSyncStartedAt: claimedAt } });
  if (claim.count === 0) return false;
  try {
    const file = await prisma.projectFile.findUniqueOrThrow({
      where: { id },
      select: { id: true, projectId: true, name: true, mimeType: true, data: true, driveFileId: true },
    });
    if (!file.data) {
      await prisma.projectFile.updateMany({ where: { id, driveSyncStartedAt: claimedAt }, data: { driveSyncStartedAt: null } });
      return false;
    }
    const isRecap = Boolean(await prisma.meetingRecap.findFirst({ where: { projectFileId: id }, select: { id: true } }));
    const asDoc = isRecap && (file.mimeType === DOCX_MIME || file.mimeType === GOOGLE_DOC_MIME_TYPE);
    const name = asDoc ? googleDocName(file.name) : file.name;
    const driveFileId = await uploadDriveFile({
      name,
      mimeType: file.mimeType === GOOGLE_DOC_MIME_TYPE ? DOCX_MIME : file.mimeType,
      data: file.data,
      fileId: file.driveFileId ?? undefined,
      parentId: file.driveFileId ? undefined : await projectDocsFolder(file.projectId),
      convertTo: asDoc ? GOOGLE_DOC_MIME_TYPE : undefined,
    });
    // Chỉ xoá nội dung khỏi database nếu không ai ghi bản mới trong lúc đang đẩy.
    const done = await prisma.projectFile.updateMany({
      where: { id, driveSyncStartedAt: claimedAt },
      data: {
        driveFileId,
        data: null,
        driveSyncStartedAt: null,
        ...(asDoc ? { mimeType: GOOGLE_DOC_MIME_TYPE, name } : {}),
      },
    });
    return done.count > 0;
  } catch (error) {
    await prisma.projectFile.updateMany({ where: { id, driveSyncStartedAt: claimedAt }, data: { driveSyncStartedAt: null } });
    throw error;
  }
}

async function pushTaskFile(id: string): Promise<boolean> {
  const claimedAt = new Date();
  const claim = await prisma.taskFile.updateMany({ where: { id, ...pendingWhere() }, data: { driveSyncStartedAt: claimedAt } });
  if (claim.count === 0) return false;
  try {
    const file = await prisma.taskFile.findUniqueOrThrow({
      where: { id },
      select: { id: true, taskId: true, name: true, mimeType: true, data: true, driveFileId: true },
    });
    if (!file.data) {
      await prisma.taskFile.updateMany({ where: { id, driveSyncStartedAt: claimedAt }, data: { driveSyncStartedAt: null } });
      return false;
    }
    const driveFileId = await uploadDriveFile({
      name: file.name,
      mimeType: file.mimeType,
      data: file.data,
      fileId: file.driveFileId ?? undefined,
      parentId: file.driveFileId ? undefined : await taskFolder(file.taskId),
    });
    const done = await prisma.taskFile.updateMany({
      where: { id, driveSyncStartedAt: claimedAt },
      data: { driveFileId, data: null, driveSyncStartedAt: null },
    });
    return done.count > 0;
  } catch (error) {
    await prisma.taskFile.updateMany({ where: { id, driveSyncStartedAt: claimedAt }, data: { driveSyncStartedAt: null } });
    throw error;
  }
}

/**
 * Đẩy các file còn nằm trong database lên Drive. Gọi sau mỗi lần tải lên (trong `after`),
 * trong cron hằng đêm và từ nút "Chuyển file cũ" của Admin. Không bao giờ ném lỗi ra ngoài.
 */
export async function pushPendingFiles(options: { projectId?: string; limit?: number; deadline?: number } = {}): Promise<PushResult> {
  const result: PushResult = { pushed: 0, failed: 0, notConnected: false };
  if (!(await driveConnected())) return { ...result, notConnected: true };
  const limit = options.limit ?? 50;
  const deadline = options.deadline ?? Date.now() + 45_000;

  const projectFiles = await prisma.projectFile.findMany({
    where: { ...pendingWhere(), ...(options.projectId ? { projectId: options.projectId } : {}) },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const taskFiles = await prisma.taskFile.findMany({
    where: { ...pendingWhere(), ...(options.projectId ? { task: { projectId: options.projectId } } : {}) },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: Math.max(0, limit - projectFiles.length),
  });

  const jobs = [
    ...projectFiles.map((row) => () => pushProjectFile(row.id)),
    ...taskFiles.map((row) => () => pushTaskFile(row.id)),
  ];
  let lastError: string | null = null;
  for (const job of jobs) {
    if (Date.now() > deadline) break;
    try {
      if (await job()) result.pushed += 1;
    } catch (error) {
      if (error instanceof DriveNotConnectedError) return { ...result, notConnected: true };
      result.failed += 1;
      lastError = error instanceof Error ? error.message : "Không rõ lỗi";
      console.error("Drive upload failed", error);
    }
  }
  if (lastError) await recordDriveError(`Không đẩy được ${result.failed} file lên Drive: ${lastError}`);
  if (result.pushed > 0) await syncProjectSharingSafe(options.projectId);
  return result;
}

export async function pendingDriveFileCounts() {
  const [projectFiles, taskFiles, onDrive] = await Promise.all([
    prisma.projectFile.count({ where: { data: { not: null } } }),
    prisma.taskFile.count({ where: { data: { not: null } } }),
    Promise.all([
      prisma.projectFile.count({ where: { driveFileId: { not: null }, data: null } }),
      prisma.taskFile.count({ where: { driveFileId: { not: null }, data: null } }),
    ]).then(([a, b]) => a + b),
  ]);
  return { pending: projectFiles + taskFiles, onDrive };
}

// ---------- Xoá ----------

/** Xoá file trong app thì đưa file trên Drive vào thùng rác. */
export async function trashDriveFileSafe(driveFileId: string | null | undefined) {
  if (!driveFileId) return;
  try {
    await trashDriveItem(driveFileId);
  } catch (error) {
    if (!(error instanceof DriveNotConnectedError)) console.error("Drive trash failed", error);
  }
}

async function trashFolderKeys(keys: string[]) {
  const folders = await prisma.driveFolder.findMany({ where: { key: { in: keys } } });
  for (const folder of folders) await trashDriveFileSafe(folder.folderId);
  await prisma.driveFolder.deleteMany({ where: { key: { in: keys } } });
}

export async function trashProjectFolderSafe(projectId: string, taskIds: string[]) {
  try {
    const root = await prisma.driveFolder.findUnique({ where: { key: driveFolderKeys.project(projectId) } });
    // Thùng rác thư mục dự án là đủ (thư mục con đi theo); chỉ dọn bản ghi trong database.
    if (root) await trashDriveFileSafe(root.folderId);
    await prisma.driveFolder.deleteMany({
      where: {
        key: {
          in: [
            driveFolderKeys.project(projectId),
            driveFolderKeys.docs(projectId),
            driveFolderKeys.tasks(projectId),
            ...taskIds.map(driveFolderKeys.task),
          ],
        },
      },
    });
  } catch (error) {
    console.error("Drive project cleanup failed", error);
  }
}

export async function trashTaskFolderSafe(taskId: string) {
  try {
    await trashFolderKeys([driveFolderKeys.task(taskId)]);
  } catch (error) {
    console.error("Drive task cleanup failed", error);
  }
}

// ---------- Quyền xem ----------

/** Việc cần làm để quyền trên Drive khớp với danh sách người được xem trong app. */
export function sharingChanges(
  current: { id: string; email: string; inherited: boolean }[],
  desiredEmails: string[],
  ownerEmail: string
) {
  const desired = new Set(desiredEmails.map((email) => email.toLowerCase()));
  desired.delete(ownerEmail.toLowerCase());
  const direct = current.filter((permission) => !permission.inherited);
  const has = new Set(current.map((permission) => permission.email));
  return {
    add: [...desired].filter((email) => !has.has(email)).sort(),
    remove: direct.filter((permission) => !desired.has(permission.email) && permission.email !== ownerEmail.toLowerCase()),
  };
}

/** Thành viên dự án và Admin (đang hoạt động) được xem thư mục dự án. */
export async function syncProjectSharing(projectId: string) {
  const folder = await prisma.driveFolder.findUnique({ where: { key: driveFolderKeys.project(projectId) } });
  if (!folder) return { added: 0, removed: 0, failed: [] as string[] };
  const [members, admins, connection] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectId, user: { isActive: true, deletedAt: null } },
      select: { user: { select: { email: true } } },
    }),
    prisma.user.findMany({ where: { role: "ADMIN", isActive: true, deletedAt: null }, select: { email: true } }),
    prisma.googleDriveConnection.findUnique({ where: { id: "default" }, select: { email: true } }),
  ]);
  const desired = [...members.map((row) => row.user.email), ...admins.map((row) => row.email)];
  const current = await listDirectPermissions(folder.folderId);
  const changes = sharingChanges(current, desired, connection?.email ?? "");
  const failed: string[] = [];
  for (const email of changes.add) {
    // Gmail cá nhân có thể bị chặn nếu Workspace không cho chia sẻ ra ngoài tên miền.
    await shareDriveItem(folder.folderId, email).catch(() => failed.push(email));
  }
  for (const permission of changes.remove) await unshareDriveItem(folder.folderId, permission.id);
  if (failed.length > 0) await recordDriveError(`Không share được thư mục dự án cho: ${failed.join(", ")}`);
  return { added: changes.add.length - failed.length, removed: changes.remove.length, failed };
}

/** Gọi sau khi thêm/gỡ thành viên; lỗi chỉ ghi log, nightly sync sẽ sửa lại. */
export async function syncProjectSharingSafe(projectId?: string) {
  if (!projectId) return;
  try {
    if (await driveConnected()) await syncProjectSharing(projectId);
  } catch (error) {
    if (!(error instanceof DriveNotConnectedError)) console.error("Drive sharing sync failed", error);
  }
}

/** Đổi tên dự án/task thì đổi tên thư mục. */
export async function renameDriveFolderSafe(key: string, name: string) {
  try {
    const folder = await prisma.driveFolder.findUnique({ where: { key } });
    const next = driveFolderName(name);
    if (!folder || folder.name === next || !(await driveConnected())) return;
    await renameDriveItem(folder.folderId, next);
    await prisma.driveFolder.update({ where: { key }, data: { name: next } });
  } catch (error) {
    if (!(error instanceof DriveNotConnectedError)) console.error("Drive rename failed", error);
  }
}

/** Cron hằng đêm: đẩy file còn sót, sửa tên thư mục, đối chiếu quyền của mọi dự án đã có thư mục. */
export async function nightlyDriveSync(deadline: number) {
  if (!(await driveConnected())) return { skipped: true };
  const push = await pushPendingFiles({ limit: 200, deadline: deadline - 15_000 });
  const folders = await prisma.driveFolder.findMany({ where: { key: { startsWith: "project:" } } });
  const projectIds = folders.filter((folder) => folder.key.split(":").length === 2).map((folder) => folder.key.slice(8));
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } });
  let synced = 0;
  for (const project of projects) {
    if (Date.now() > deadline) break;
    await renameDriveFolderSafe(driveFolderKeys.project(project.id), project.name);
    try {
      await syncProjectSharing(project.id);
      synced += 1;
    } catch (error) {
      if (error instanceof DriveNotConnectedError) break;
      console.error("Drive nightly sharing failed", project.id, error);
    }
  }
  return { skipped: false, ...push, synced };
}

/** Gọi trong server action/route: chạy sau khi đã trả kết quả cho người dùng. */
export function queueDriveSharingSync(projectId: string) {
  after(() => syncProjectSharingSafe(projectId));
}

export function queueDrivePush(projectId: string) {
  after(async () => {
    await pushPendingFiles({ projectId });
  });
}
