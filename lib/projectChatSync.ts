import { after } from "next/server";
import { addChatMembers } from "./googleChatSpace";
import { prisma } from "./prisma";

/**
 * Người mới vào dự án thì tự thêm vào nhóm Google Chat của dự án (nếu có), bằng tài khoản
 * của người tạo nhóm. Chạy sau khi thao tác chính xong; lỗi chỉ ghi log — thành viên vẫn
 * có thể bấm "Thêm người còn thiếu" trên trang dự án.
 */
export function queueChatMemberSync(projectId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  after(async () => {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { googleChatSpaceName: true, googleChatSpaceById: true },
      });
      if (!project?.googleChatSpaceName || !project.googleChatSpaceById) return;
      const users = await prisma.user.findMany({
        where: { id: { in: userIds }, isActive: true, deletedAt: null },
        select: { email: true },
      });
      await addChatMembers(
        project.googleChatSpaceById,
        project.googleChatSpaceName,
        users.map((user) => user.email),
      );
    } catch {
      console.warn("Could not add new project members to the Google Chat space.");
    }
  });
}
