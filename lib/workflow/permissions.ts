import { Prisma } from "@prisma/client";

const APPROVAL_ROLES = new Set(["MANAGER", "ACCOUNTANT", "CEO"]);

export async function assertEligibleApprovalReceiver(
  tx: Prisma.TransactionClient,
  input: { userId: string; role: string; standardAssigneeId?: string | null },
) {
  if (!APPROVAL_ROLES.has(input.role)) throw new Error("Vai trò chuyển giao không hợp lệ.");
  const user = await tx.user.findFirst({ where: { id: input.userId, isActive: true }, select: { id: true } });
  if (!user) throw new Error("Người nhận không còn hoạt động.");
  if (input.userId === input.standardAssigneeId) return input.userId;
  const grant = await tx.workflowRoleGrant.findFirst({ where: { userId: input.userId, role: input.role, revokedAt: null }, select: { id: true } });
  if (!grant) throw new Error("Người nhận chưa được cấp đúng vai trò duyệt đang chờ.");
  return input.userId;
}
