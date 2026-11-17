import { del, get, list } from "@vercel/blob";
import {
  isTaskCreationUploadPath,
  TASK_CREATION_UPLOAD_PREFIX,
  validateTaskCreationFile,
} from "@/lib/taskCreationFiles";
import type { ProjectUpload } from "@/lib/projectFiles";
import type { TaskFileKind } from "@/lib/types";
import { isTaskFileKind } from "@/lib/taskFiles";

export async function readStagedTaskFiles(formData: FormData, projectId: string, userId: string) {
  const paths = new Set<string>();
  const entries = formData.getAll("stagedFiles").map((value) => {
    const entry = typeof value === "string" ? JSON.parse(value) : null;
    if (
      !entry ||
      !isTaskFileKind(entry.kind) ||
      typeof entry.pathname !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.type !== "string" ||
      !Number.isSafeInteger(entry.size) ||
      !isTaskCreationUploadPath(entry.pathname, projectId, userId) ||
      paths.has(entry.pathname)
    ) {
      throw new Error("Tệp đính kèm không hợp lệ.");
    }
    const pathname: string = entry.pathname;
    const kind: TaskFileKind = entry.kind;
    paths.add(pathname);
    return { kind, pathname, meta: validateTaskCreationFile(entry) };
  });

  const uploads: { kind: TaskFileKind; upload: ProjectUpload }[] = [];
  for (const { kind, pathname, meta } of entries) {
    const blob = await get(pathname, { access: "private" });
    if (
      blob?.statusCode !== 200 ||
      blob.blob.size !== meta.size ||
      blob.blob.contentType !== meta.mimeType
    ) {
      await blob?.stream?.cancel();
      throw new Error(`Không xác nhận được tệp “${meta.name}”. Vui lòng thử lại.`);
    }
    const data = new Uint8Array(await new Response(blob.stream).arrayBuffer());
    if (data.byteLength !== meta.size) {
      throw new Error(`Tệp “${meta.name}” tải lên chưa đầy đủ. Vui lòng thử lại.`);
    }
    uploads.push({ kind, upload: { ...meta, data } });
  }
  return { uploads, paths: Array.from(paths) };
}

export async function discardStagedTaskFiles(paths: string[]) {
  if (paths.length === 0) return;
  await del(paths).catch((error) => console.error("Task attachment cleanup failed", error));
}

export async function cleanExpiredTaskUploads() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return;
  // Files left by interrupted forms are eligible well after their upload tokens expire.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: TASK_CREATION_UPLOAD_PREFIX, limit: 100, cursor });
    await discardStagedTaskFiles(
      page.blobs.filter(({ uploadedAt }) => uploadedAt.getTime() < cutoff).map(({ pathname }) => pathname)
    );
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
