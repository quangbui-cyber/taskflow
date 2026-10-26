import { jwtVerify, SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { MAX_DRIVE_FILE_SIZE, validateUploadMeta, type UploadMeta } from "@/lib/projectFiles";
import { findAccessibleTask, isTaskFileKind } from "@/lib/taskFiles";

/**
 * Tải file thẳng từ trình duyệt lên Drive:
 * 1. app kiểm quyền và mở phiên tải lên Drive, trả kèm một vé có chữ ký;
 * 2. trình duyệt đẩy file lên Drive;
 * 3. trình duyệt gửi lại vé + mã file, app kiểm file trên Drive đúng thư mục, đúng dung lượng rồi mới lưu.
 */

const AUDIENCE = "drive-upload";
const TICKET_MAX_AGE = 2 * 60 * 60;

export type UploadTarget =
  | { type: "project"; projectId: string }
  | { type: "task"; taskId: string; kind: "BRIEF" | "RESULT" };

export type UploadTicket = UploadMeta & {
  target: UploadTarget;
  projectId: string;
  folderId: string;
  userId: string;
};

function secret() {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error("SESSION_SECRET is required.");
  return new TextEncoder().encode(raw);
}

export async function signUploadTicket(ticket: UploadTicket) {
  return new SignJWT({ ticket })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("mycreative")
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TICKET_MAX_AGE}s`)
    .sign(secret());
}

export async function verifyUploadTicket(token: string): Promise<UploadTicket> {
  const { payload } = await jwtVerify(token, secret(), { issuer: "mycreative", audience: AUDIENCE });
  const ticket = payload.ticket as UploadTicket | undefined;
  if (!ticket || typeof ticket.folderId !== "string" || typeof ticket.userId !== "string") {
    throw new Error("Invalid upload ticket.");
  }
  return ticket;
}

/** Đọc yêu cầu tải lên từ trình duyệt. */
export function parseUploadRequest(body: unknown): { target: UploadTarget; meta: UploadMeta } {
  const input = (body ?? {}) as Record<string, unknown>;
  const meta = validateUploadMeta(
    { name: String(input.name ?? ""), type: String(input.mimeType ?? ""), size: Number(input.size) },
    MAX_DRIVE_FILE_SIZE
  );
  if (input.target === "project" && typeof input.projectId === "string") {
    return { target: { type: "project", projectId: input.projectId }, meta };
  }
  if (input.target === "task" && typeof input.taskId === "string" && isTaskFileKind(input.kind)) {
    return { target: { type: "task", taskId: input.taskId, kind: input.kind }, meta };
  }
  throw new Error("Nơi lưu tệp không hợp lệ.");
}

/** Người dùng có được tải file vào dự án / task này không; trả về dự án và task (nếu có). */
export async function uploadAccess(target: UploadTarget, user: { id: string; role: string }) {
  if (target.type === "project") {
    const project = await prisma.project.findFirst({
      where: user.role === "ADMIN" ? { id: target.projectId } : { id: target.projectId, members: { some: { userId: user.id } } },
      select: { id: true },
    });
    return project ? { projectId: project.id, task: null } : null;
  }
  const task = await findAccessibleTask(target.taskId, user);
  return task ? { projectId: task.projectId, task } : null;
}
