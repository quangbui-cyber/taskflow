import { jwtVerify, SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { MAX_DRIVE_FILE_SIZE, validateUploadMeta, type UploadMeta } from "@/lib/projectFiles";
import { isTaskFileKind } from "@/lib/taskFiles";
import { assertTaskAccess, assertOwnerAccess } from "./taskAccess";
import { parseOwnerInput, type WorkOwnerKind } from "./workOwner";
import { crmEnabled } from "./features";

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
  | { type: "opportunity" | "client"; id: string }
  | { type: "task"; taskId: string; kind: "BRIEF" | "RESULT" };

export type UploadTicket = UploadMeta & {
  target: UploadTarget;
  projectId?: string;
  ownerKind?: WorkOwnerKind;
  ownerId?: string;
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
  const owner = parseOwnerInput(ticket.ownerKind ?? "PROJECT", ticket.ownerId ?? ticket.projectId);
  if (!owner) throw new Error("Invalid upload owner.");
  ticket.ownerKind = owner.kind;
  ticket.ownerId = owner.id;
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
  const kind = input.target ?? input.kind;
  if (kind === "opportunity" || kind === "client") {
    const id = input.id ?? (kind === "opportunity" ? input.opportunityId : input.clientId);
    if (parseOwnerInput(kind.toUpperCase(), id)) return { target: { type: kind, id: id as string }, meta };
  }
  if (input.target === "task" && typeof input.taskId === "string" && isTaskFileKind(input.kind)) {
    return { target: { type: "task", taskId: input.taskId, kind: input.kind }, meta };
  }
  throw new Error("Nơi lưu tệp không hợp lệ.");
}

/** Người dùng có được tải file vào dự án / task này không; trả về dự án và task (nếu có). */
export async function uploadAccess(target: UploadTarget, user: { id: string; role: string }) {
  if (target.type === "task") {
    const access = await assertTaskAccess(prisma, user, target.taskId, "EDIT");
    if (!("task" in access) || (access.task.owner.kind !== "PROJECT" && !crmEnabled())) return null;
    return { owner: access.task.owner, projectId: access.task.projectId, task: access.task };
  }
  const owner = target.type === "project" ? parseOwnerInput("PROJECT", target.projectId) : parseOwnerInput(target.type.toUpperCase(), target.id);
  if (!owner || (owner.kind !== "PROJECT" && !crmEnabled())) return null;
  const access = await assertOwnerAccess(prisma, user, owner, "CREATE_TASK");
  return "ok" in access ? { owner, projectId: owner.kind === "PROJECT" ? owner.id : null, task: null } : null;
}
