"use server";

import { revalidatePath } from "next/cache";
import { getMembership, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  addChatAppToSpace,
  addChatMembers,
  chatSpaceDisplayName,
  createChatSpace,
  GoogleChatSetupError,
} from "@/lib/googleChatSpace";
import { canManageChatSpaces, GoogleNotConnectedError, googleWorkspaceConfigured } from "@/lib/googleWorkspace";
import { chatAppConfigured, chatAppProblem, sendChatAppMessage } from "@/lib/googleChatApp";

export type ProjectChatState = { error?: string; success?: string; needsConnect?: boolean };

const SETUP_ERROR =
  "Google Chat API chưa được bật hoặc chưa cấu hình cho app. Nhờ quản trị viên bật Google Chat API trong Google Cloud.";
const CONNECT_ERROR = "Cần kết nối Google (cho phép tạo nhóm Chat) trước.";

async function chatProject(projectId: string) {
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      googleChatSpaceName: true,
      googleChatSpaceById: true,
      members: {
        where: { user: { isActive: true, deletedAt: null } },
        select: { user: { select: { email: true } } },
      },
    },
  });
  if (!project) return { error: "Dự án không tồn tại." } as const;
  const isMember = user.role === "ADMIN" || Boolean(await getMembership(projectId, user.id));
  if (!isMember) return { error: "Chỉ thành viên dự án hoặc Admin được làm việc này." } as const;
  return { user, project, emails: project.members.map((member) => member.user.email) } as const;
}

async function userCanManageChat(userId: string) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleToken: true, googleScopes: true },
  });
  return Boolean(row?.googleToken && canManageChatSpaces(row.googleScopes));
}

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Thêm Chat app "myCreative" vào nhóm để app gửi thông báo task vào nhóm.
 * Trả về câu ghi chú (rỗng nếu thêm được) để nối vào thông báo cho người bấm.
 */
async function ensureChatApp(spaceName: string, actorIds: string[]): Promise<string> {
  if (!chatAppConfigured()) return " Máy chủ chưa cài Chat app nên nhóm chưa nhận được thông báo task.";
  for (const actorId of actorIds) {
    try {
      await addChatAppToSpace(actorId, spaceName);
      return "";
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) continue;
      if (error instanceof GoogleChatSetupError) return " Google Chat API chưa cấu hình xong nên chưa thêm được myCreative vào nhóm.";
      console.error("Adding the Chat app to the space failed", error);
      return " Chưa thêm được myCreative vào nhóm, bấm “Thêm người còn thiếu” để thử lại.";
    }
  }
  return " Để nhóm nhận thông báo task, hãy bấm Kết nối Google lại (cho phép thêm myCreative vào nhóm) rồi bấm “Thêm người còn thiếu”.";
}

/** Tạo nhóm Google Chat tên trùng tên dự án, thêm sẵn mọi thành viên dự án. */
export async function createProjectChatSpace(projectId: string): Promise<ProjectChatState> {
  if (!googleWorkspaceConfigured()) return { error: "Chức năng Google chưa được cấu hình." };
  const access = await chatProject(projectId);
  if ("error" in access) return access;
  const { user, project, emails } = access;
  if (project.googleChatSpaceName) return { error: "Dự án đã có nhóm Google Chat." };
  if (!(await userCanManageChat(user.id))) return { error: CONNECT_ERROR, needsConnect: true };

  try {
    const space = await createChatSpace(user.id, {
      displayName: chatSpaceDisplayName(project.name),
      fallbackSuffix: project.id.slice(-6),
      memberEmails: emails,
    });
    // Hai người bấm cùng lúc: chỉ lưu nhóm tạo trước.
    const saved = await prisma.project.updateMany({
      where: { id: project.id, googleChatSpaceName: null },
      data: {
        googleChatSpaceName: space.name,
        googleChatSpaceUri: space.uri,
        googleChatSpaceById: user.id,
      },
    });
    if (saved.count === 0) {
      refresh(project.id);
      return { error: "Người khác vừa tạo nhóm cho dự án này. Bạn có thể xoá nhóm thừa trong Google Chat." };
    }
    let note = await ensureChatApp(space.name, [user.id]);
    if (space.pending.length > 0) {
      const extra = await addChatMembers(user.id, space.name, space.pending);
      if (extra.failed.length > 0) note += ` ${extra.failed.length} người chưa thêm được, bấm "Thêm người còn thiếu" để thử lại.`;
    }
    refresh(project.id);
    return { success: `Đã tạo nhóm Google Chat và thêm các thành viên dự án.${note}` };
  } catch (error) {
    if (error instanceof GoogleNotConnectedError) return { error: CONNECT_ERROR, needsConnect: true };
    if (error instanceof GoogleChatSetupError) return { error: SETUP_ERROR };
    console.error("createProjectChatSpace failed", error);
    return { error: "Google chưa tạo được nhóm Chat. Thử lại sau ít phút." };
  }
}

/** Thêm vào nhóm những thành viên dự án chưa có trong nhóm. */
export async function addMissingChatMembers(projectId: string): Promise<ProjectChatState> {
  const access = await chatProject(projectId);
  if ("error" in access) return access;
  const { user, project, emails } = access;
  if (!project.googleChatSpaceName) return { error: "Dự án chưa có nhóm Google Chat." };

  // Người tạo nhóm là quản lý nhóm nên thêm người chắc chắn được; không có thì dùng người bấm.
  const candidates = [project.googleChatSpaceById, user.id].filter(
    (id, index, list): id is string => Boolean(id) && list.indexOf(id) === index,
  );
  // Nhóm tạo trước khi có Chat app: thêm myCreative để nhóm nhận thông báo task.
  const appNote = await ensureChatApp(project.googleChatSpaceName, candidates);
  for (const actorId of candidates) {
    if (!(await userCanManageChat(actorId))) continue;
    try {
      const result = await addChatMembers(actorId, project.googleChatSpaceName, emails);
      if (result.failed.length > 0 && actorId !== candidates[candidates.length - 1]) continue;
      refresh(project.id);
      if (result.failed.length > 0) {
        return { error: `Thêm được ${result.added} người, ${result.failed.length} người chưa thêm được (có thể không dùng tài khoản công ty).${appNote}` };
      }
      const base = result.added > 0 ? `Đã thêm ${result.added} người vào nhóm Chat.` : "Mọi thành viên dự án đã có trong nhóm Chat.";
      return appNote ? { error: `${base}${appNote}` } : { success: base };
    } catch (error) {
      if (error instanceof GoogleChatSetupError) return { error: SETUP_ERROR };
      if (error instanceof GoogleNotConnectedError) continue;
      console.error("addMissingChatMembers failed", error);
      return { error: "Google chưa thêm được người vào nhóm. Thử lại sau ít phút." };
    }
  }
  return { error: CONNECT_ERROR, needsConnect: true };
}

/** Bỏ liên kết nhóm khỏi dự án (nhóm trong Google Chat vẫn giữ nguyên). */
export async function unlinkProjectChatSpace(projectId: string): Promise<ProjectChatState> {
  const access = await chatProject(projectId);
  if ("error" in access) return access;
  const { user, project } = access;
  const allowed = user.role === "ADMIN" || user.id === project.ownerId || user.id === project.googleChatSpaceById;
  if (!allowed) return { error: "Chỉ chủ dự án, người tạo nhóm hoặc Admin được bỏ liên kết." };
  await prisma.project.update({
    where: { id: project.id },
    data: { googleChatSpaceName: null, googleChatSpaceUri: null, googleChatSpaceById: null },
  });
  refresh(project.id);
  return { success: "Đã bỏ liên kết. Nhóm trong Google Chat vẫn còn, bạn có thể xoá trong Google Chat nếu muốn." };
}

/** Gửi một tin thử vào nhóm Chat của dự án dưới tên myCreative. */
export async function testProjectChat(projectId: string): Promise<ProjectChatState> {
  const access = await chatProject(projectId);
  if ("error" in access) return access;
  const { project } = access;
  if (!project.googleChatSpaceName) return { error: "Dự án chưa có nhóm Google Chat." };
  if (!chatAppConfigured()) return { error: chatAppProblem() ?? "Máy chủ chưa cài Chat app." };
  const result = await sendChatAppMessage(project.googleChatSpaceName, `*${project.name}*\nKết nối Google Chat thành công.`);
  return result.ok ? { success: "Đã gửi tin thử vào nhóm Google Chat." } : { error: result.error };
}
