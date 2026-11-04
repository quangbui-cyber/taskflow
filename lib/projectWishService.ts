import type { PrismaClient } from "@prisma/client";
import type { GoogleChatMessage, GoogleChatResult } from "./googleChat";
import { executionWishWhere, projectWishChatMessage, readProjectWish } from "./projectWishes";

export type ProjectWishState = { error?: string; success?: string; warning?: string };
export type ProjectWishDependencies = {
  db: Pick<PrismaClient, "project" | "projectWish">;
  chatReady: () => boolean;
  send: (space: string, message: GoogleChatMessage, requestId: string) => Promise<GoogleChatResult>;
};

export async function deliverProjectWish(wishId: string, authorId: string, deps: ProjectWishDependencies): Promise<ProjectWishState> {
  const wish = await deps.db.projectWish.findUnique({
    where: { id: wishId },
    include: {
      author: { select: { name: true } },
      project: { select: { name: true, googleChatSpaceName: true } },
    },
  });
  if (!wish || wish.authorId !== authorId) return { error: "Không tìm thấy lời chúc của bạn." };
  if (wish.chatSentAt) return { success: "Lời chúc đã được gửi vào nhóm Google Chat." };

  const saved = "Đã lưu lời chúc trên trang chủ.";
  const space = wish.project.googleChatSpaceName;
  if (!space) return { success: saved, warning: "Dự án chưa có nhóm Google Chat. Bạn có thể gửi lại sau khi nhóm được kết nối." };
  if (!deps.chatReady()) return { success: saved, warning: "Google Chat chưa được cấu hình. Bạn có thể gửi lại sau." };
  if (wish.chatSpaceName && wish.chatSpaceName !== space) {
    return { success: saved, warning: "Nhóm Chat của dự án đã thay đổi. Lời chúc được giữ trên trang chủ để tránh gửi nhầm nhóm." };
  }

  try {
    await deps.db.projectWish.updateMany({
      where: { id: wish.id, chatSpaceName: null },
      data: { chatSpaceName: space },
    });
    const result = await deps.send(
      space,
      projectWishChatMessage(wish.project.name, wish.author.name, wish.body),
      wish.id,
    );
    if (!result.ok) return { success: saved, warning: `${result.error} Lời chúc vẫn được giữ, bạn có thể thử gửi lại.` };
    await deps.db.projectWish.update({ where: { id: wish.id }, data: { chatSentAt: new Date() } });
    return { success: "Đã lưu lời chúc và gửi vào nhóm Google Chat của dự án." };
  } catch (error) {
    console.error("Project wish Chat delivery failed", error);
    return { success: saved, warning: "Chưa xác nhận được việc gửi Google Chat. Bạn có thể gửi lại mà không tạo tin trùng." };
  }
}

export async function saveProjectWish(
  data: { id: string; projectId: string; body: unknown },
  authorId: string,
  deps: ProjectWishDependencies,
): Promise<ProjectWishState> {
  const input = readProjectWish(data.body);
  if ("error" in input) return input;
  const projectId = data.projectId;
  const id = data.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return { error: "Phiên gửi không hợp lệ. Vui lòng tải lại trang." };
  }
  try {
    const project = await deps.db.project.findFirst({
      where: { id: projectId, ...executionWishWhere() },
      select: { id: true, googleChatSpaceName: true },
    });
    if (!project) return { error: "Chương trình không còn diễn ra hôm nay. Vui lòng tải lại trang." };
    const wish = await deps.db.projectWish.upsert({
      where: { id },
      update: {},
      create: { id, projectId: project.id, authorId, body: input.body, chatSpaceName: project.googleChatSpaceName },
    });
    if (wish.authorId !== authorId || wish.projectId !== project.id || wish.body !== input.body) {
      return { error: "Phiên gửi đã được sử dụng. Vui lòng tải lại trang." };
    }
    try {
      return await deliverProjectWish(wish.id, authorId, deps);
    } catch (error) {
      console.error("Reading saved project wish failed", error);
      return { success: "Đã lưu lời chúc trên trang chủ.", warning: "Chưa xác nhận được việc gửi Google Chat. Bạn có thể thử gửi lại." };
    }
  } catch (error) {
    console.error("Creating project wish failed", error);
    return { error: "Chưa lưu được lời chúc. Nội dung vẫn ở đây, bạn hãy thử lại." };
  }
}

