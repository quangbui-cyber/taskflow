"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canCreateProjects, canViewRevenue, getMembership, requireUser } from "@/lib/auth";
import { readProjectBusinessFields } from "@/lib/projectPolicy";
import { readProjectResponsibility, type ProjectResponsibility } from "@/lib/projectResponsibility";
import {
  sendGoogleChat,
  validateGoogleChatWebhookUrl,
} from "@/lib/googleChat";
import { readProjectUpload } from "@/lib/projectFiles";
import { parsePurchaseOrderPdf } from "@/lib/purchaseOrderPdf";
import { projectStatusColor, type ProjectCategory } from "@/lib/types";

export type ActionState = { error?: string; success?: string };

const PROJECT_STATUS_KEYS = [
  "BIDDING",
  "ON_PROCESS",
  "PENDING",
  "DONE",
  "CANCEL",
  "FAIL",
];

const PROJECT_TYPE_KEYS = [
  "TEAMBUILDING",
  "MICE",
  "ACTIVATION",
  "EVENT",
  "PUR",
  "OTHER",
];

/** "yyyy-MM-dd" → nửa đêm giờ VN; "" → null; sai định dạng → undefined */
function parseExecutionDate(raw: string): Date | null | undefined {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const date = new Date(`${raw}T00:00:00+07:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseExecutionFields(formData: FormData, category: ProjectCategory):
  | { error: string }
  | { type: string; executionStartAt: Date | null; executionEndAt: Date | null } {
  const type = category === "INTERNAL" ? "OTHER" : String(formData.get("type") ?? "OTHER");
  if (!PROJECT_TYPE_KEYS.includes(type)) {
    return { error: "Loại hình dự án không hợp lệ." };
  }
  const executionStartAt = parseExecutionDate(
    String(formData.get("executionStartAt") ?? "")
  );
  const executionEndAt = parseExecutionDate(
    String(formData.get("executionEndAt") ?? "")
  );
  if (executionStartAt === undefined || executionEndAt === undefined) {
    return { error: "Ngày thực hiện không hợp lệ." };
  }
  if (executionEndAt && !executionStartAt) {
    return { error: "Hãy điền ngày bắt đầu trước khi điền ngày kết thúc." };
  }
  if (executionStartAt && executionEndAt && executionEndAt < executionStartAt) {
    return { error: "Ngày kết thúc phải từ ngày bắt đầu trở đi." };
  }
  return { type, executionStartAt, executionEndAt };
}

async function findValidAccount(accountId: string | null) {
  if (!accountId) return null;
  return prisma.account.findFirst({
    where: {
      id: accountId,
      user: { isActive: true, role: { in: ["ADMIN", "ACCOUNT"] } },
    },
    select: { id: true, userId: true },
  });
}

async function findValidClient(clientId: string | null) {
  if (!clientId) return null;
  return prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });
}

async function validateResponsibility(assignment: ProjectResponsibility) {
  const exists = assignment.responsibleTeamId
    ? await prisma.salesTeam.findUnique({
        where: { id: assignment.responsibleTeamId },
        select: { id: true },
      })
    : assignment.responsibleGroupId
      ? await prisma.memberGroup.findUnique({
          where: { id: assignment.responsibleGroupId },
          select: { id: true },
        })
      : true;
  return exists ? null : { error: "Team/phòng ban không còn tồn tại. Vui lòng chọn lại." };
}

export async function createProject(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  if (!canCreateProjects(user.role)) {
    return { error: "Bạn không có quyền tạo dự án." };
  }
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const business = readProjectBusinessFields(formData, user.role);
  if ("error" in business) return business;
  const { category, revenue, clientId, accountId } = business;
  const projectSource = String(formData.get("projectSource") ?? "");
  let purchaseOrderNumber: string | null = null;
  let projectFile: Awaited<ReturnType<typeof readProjectUpload>> = null;

  if (!name) return { error: "Tên project không được để trống." };
  const assignment = readProjectResponsibility(formData, undefined, category);
  if ("error" in assignment) return assignment;
  const assignmentError = await validateResponsibility(assignment);
  if (assignmentError) return assignmentError;
  const execution = parseExecutionFields(formData, category);
  if ("error" in execution) return execution;
  try {
    projectFile = category === "CLIENT"
      ? await readProjectUpload(formData.get("projectFile"))
      : null;
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Tài liệu PO không hợp lệ.",
    };
  }
  if (projectSource === "JABIL_PO") {
    if (!projectFile || projectFile.mimeType !== "application/pdf") {
      return { error: "Vui lòng tải lại file PO PDF trước khi tạo dự án." };
    }
    try {
      const purchaseOrder = await parsePurchaseOrderPdf(projectFile.data);
      purchaseOrderNumber = purchaseOrder.poNumber || null;
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Tài liệu PO không hợp lệ.",
      };
    }
    if (!purchaseOrderNumber) {
      return {
        error:
          "Không nhận diện được số PO. Vui lòng kiểm tra lại file trước khi tạo dự án.",
      };
    }
  }
  const [account, client] = await Promise.all([
    findValidAccount(accountId),
    findValidClient(clientId),
  ]);
  if (accountId && !account) {
    return { error: "Hãy chọn Account đang hoạt động, đã liên kết tài khoản và Team kinh doanh." };
  }
  if (clientId && !client) {
    return { error: "Client không còn tồn tại. Vui lòng chọn lại." };
  }
  if (purchaseOrderNumber) {
    const existingProject = await prisma.project.findUnique({
      where: { purchaseOrderNumber },
      select: { name: true },
    });
    if (existingProject) {
      return {
        error: `PO ${purchaseOrderNumber} đã được dùng để tạo dự án "${existingProject.name}". Không thể tạo thêm dự án trùng PO.`,
      };
    }
  }
  const initialMembers = [{ userId: user.id, role: "owner" }];
  if (account?.userId && account.userId !== user.id) {
    initialMembers.push({ userId: account.userId, role: "member" });
  }
  const initialStatus =
    category === "INTERNAL" || (projectSource === "JABIL_PO" && projectFile?.mimeType === "application/pdf")
      ? "ON_PROCESS"
      : "BIDDING";
  let project;
  try {
    project = await prisma.project.create({
      data: {
        name,
        description: description || null,
        category,
        ...assignment,
        purchaseOrderNumber,
        color: projectStatusColor(initialStatus),
        status: initialStatus,
        type: execution.type,
        executionStartAt: execution.executionStartAt,
        executionEndAt: execution.executionEndAt,
        onProcessAt: initialStatus === "ON_PROCESS" ? new Date() : null,
        revenue,
        clientId,
        accountId,
        ownerId: user.id,
        members: { create: initialMembers },
        files: projectFile
          ? {
              create: {
                uploaderId: user.id,
                name: projectFile.name,
                mimeType: projectFile.mimeType,
                size: projectFile.size,
                data: projectFile.data,
              },
            }
          : undefined,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        error: `PO ${purchaseOrderNumber} đã tồn tại. Không thể tạo thêm dự án trùng PO.`,
      };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  redirect(`/projects/${project.id}`);
}

/** Sửa thông tin chung của project — chỉ chủ project hoặc admin */
export async function updateProject(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) return { error: "Project không tồn tại." };
  if (project.ownerId !== user.id && user.role !== "ADMIN") {
    return { error: "Chỉ chủ project hoặc admin mới được sửa." };
  }
  if (!name) return { error: "Tên project không được để trống." };
  const business = readProjectBusinessFields(formData, user.role, project);
  if ("error" in business) return business;
  const { category, revenue, clientId, accountId } = business;
  const assignment = readProjectResponsibility(formData, project, category);
  if ("error" in assignment) return assignment;
  const assignmentError = await validateResponsibility(assignment);
  if (assignmentError) return assignmentError;
  const execution = parseExecutionFields(formData, category);
  if ("error" in execution) return execution;
  const [account, client] = await Promise.all([
    findValidAccount(accountId),
    findValidClient(clientId),
  ]);
  if (accountId && !account) {
    return { error: "Hãy chọn Account đang hoạt động, đã liên kết tài khoản và Team kinh doanh." };
  }
  if (clientId && !client) {
    return { error: "Client không còn tồn tại. Vui lòng chọn lại." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        name,
        description: description || null,
        category,
        ...assignment,
        type: execution.type,
        executionStartAt: execution.executionStartAt,
        executionEndAt: execution.executionEndAt,
        revenue: canViewRevenue(user.role) ? revenue : undefined,
        clientId,
        accountId,
      },
    });
    if (account?.userId) {
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: account.userId } },
        create: { projectId, userId: account.userId },
        update: {},
      });
    }
  });

  revalidatePath("/", "layout");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/revenue");
  return {};
}

/** Đổi nhanh trạng thái project từ thanh thông tin đầu trang. */
export async function updateProjectStatus(
  projectId: string,
  status: string
): Promise<ActionState> {
  const user = await requireUser();
  if (!PROJECT_STATUS_KEYS.includes(status)) {
    return { error: "Tình trạng không hợp lệ." };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      status: true,
      onProcessAt: true,
      completedAt: true,
    },
  });
  if (!project) return { error: "Project không tồn tại." };
  if (project.ownerId !== user.id && user.role !== "ADMIN") {
    return { error: "Chỉ chủ project hoặc admin mới được đổi trạng thái." };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      status,
      color: projectStatusColor(status),
      onProcessAt:
        status === "ON_PROCESS" || status === "DONE"
          ? (project.onProcessAt ?? new Date())
          : project.onProcessAt,
      completedAt:
        status === "DONE"
          ? project.status === "DONE"
            ? (project.completedAt ?? new Date())
            : new Date()
          : null,
    },
  });

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/revenue");
  revalidatePath("/team");
  return { success: "Đã cập nhật trạng thái dự án." };
}

export async function deleteProject(projectId: string) {
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project || project.ownerId !== user.id) {
    return { error: "Chỉ chủ project mới được xoá." };
  }
  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/");
  redirect("/");
}

async function manageableProject(projectId: string) {
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      googleChatWebhookUrl: true,
    },
  });

  if (!project) return { error: "Project không tồn tại." } as const;
  const membership =
    user.role === "ADMIN" ? true : await getMembership(projectId, user.id);
  if (!membership) {
    return {
      error: "Chỉ thành viên dự án hoặc admin được cấu hình Google Chat.",
    } as const;
  }
  return { project } as const;
}

export async function saveProjectGoogleChatWebhook(
  projectId: string,
  webhookUrl: string
) {
  const access = await manageableProject(projectId);
  if ("error" in access) return access;

  const normalizedUrl = webhookUrl.trim();
  if (!validateGoogleChatWebhookUrl(normalizedUrl)) {
    return {
      error: "URL không đúng định dạng webhook của Google Chat.",
    };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { googleChatWebhookUrl: normalizedUrl },
  });

  revalidatePath(`/projects/${projectId}`);
  return { success: "Đã kết nối dự án với Google Chat." };
}

export async function testProjectGoogleChatWebhook(projectId: string) {
  const access = await manageableProject(projectId);
  if ("error" in access) return access;
  if (!access.project.googleChatWebhookUrl) {
    return { error: "Dự án chưa có webhook Google Chat." };
  }

  const result = await sendGoogleChat(
    access.project.googleChatWebhookUrl,
    `*${access.project.name}*\nKết nối Google Chat thành công.`
  );
  if (!result.ok) return { error: result.error };
  return { success: "Đã gửi tin thử vào Google Chat." };
}

export async function disconnectProjectGoogleChatWebhook(projectId: string) {
  const access = await manageableProject(projectId);
  if ("error" in access) return access;

  await prisma.project.update({
    where: { id: projectId },
    data: { googleChatWebhookUrl: null },
  });
  revalidatePath(`/projects/${projectId}`);
  return { success: "Đã ngắt kết nối Google Chat." };
}

export async function addMember(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId") ?? "");
  const inviteeId = String(formData.get("inviteeId") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  const membership = await getMembership(projectId, user.id);
  if (!membership) return { error: "Bạn không thuộc project này." };

  const invitee = inviteeId
    ? await prisma.user.findUnique({ where: { id: inviteeId } })
    : await prisma.user.findUnique({ where: { email } });
  if (!invitee) {
    return {
      error:
        "Không tìm thấy người dùng này. Họ cần có tài khoản trước khi được thêm vào project.",
    };
  }
  if (!invitee.isActive) {
    return { error: "Tài khoản này đã bị vô hiệu hóa và không thể thêm vào dự án." };
  }

  const existing = await getMembership(projectId, invitee.id);
  if (existing) return { error: "Người này đã là thành viên." };

  await prisma.projectMember.create({
    data: { projectId, userId: invitee.id, role: "member" },
  });

  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function addMemberGroup(
  projectId: string,
  groupId: string
): Promise<ActionState> {
  const user = await requireUser();
  const membership = await getMembership(projectId, user.id);
  if (!membership) return { error: "Bạn không thuộc project này." };

  const group = await prisma.memberGroup.findUnique({
    where: { id: groupId },
    select: {
      name: true,
      members: {
        where: { user: { isActive: true } },
        select: { userId: true },
      },
    },
  });
  if (!group) return { error: "Nhóm không tồn tại." };
  if (group.members.length === 0) return { error: "Nhóm chưa có thành viên." };

  const memberIds = group.members.map((member) => member.userId);
  const existingMembers = await prisma.projectMember.findMany({
    where: { projectId, userId: { in: memberIds } },
    select: { userId: true },
  });
  const existingIds = new Set(existingMembers.map((member) => member.userId));
  const newMemberIds = memberIds.filter((userId) => !existingIds.has(userId));

  if (newMemberIds.length === 0) {
    return { error: `Tất cả thành viên nhóm "${group.name}" đã có trong project.` };
  }

  await prisma.projectMember.createMany({
    data: newMemberIds.map((userId) => ({
      projectId,
      userId,
      role: "member",
    })),
    skipDuplicates: true,
  });

  revalidatePath(`/projects/${projectId}`);
  return {
    success: `Đã thêm ${newMemberIds.length} người từ nhóm "${group.name}".`,
  };
}

export async function removeMember(projectId: string, memberUserId: string) {
  const user = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) return;
  // Chủ project được xoá người khác; thành viên được tự rời
  if (project.ownerId !== user.id && user.id !== memberUserId) return;
  if (memberUserId === project.ownerId) return; // không xoá được chủ project

  await prisma.$transaction(async (tx) => {
    const projectTasks = await tx.task.findMany({
      where: { projectId },
      select: { id: true },
    });
    const taskIds = projectTasks.map((task) => task.id);

    await tx.task.updateMany({
      where: { projectId, assigneeId: memberUserId },
      data: { assigneeId: null },
    });

    if (taskIds.length > 0) {
      await tx.taskFollower.deleteMany({
        where: { taskId: { in: taskIds }, userId: memberUserId },
      });
    }

    await tx.notification.deleteMany({
      where: { projectId, userId: memberUserId },
    });

    await tx.projectMember.deleteMany({
      where: { projectId, userId: memberUserId },
    });
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  revalidatePath("/team");
  revalidatePath("/notifications");
}
