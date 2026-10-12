"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/auth";
import {
  MAX_ANNUAL_LEAVE_DAYS,
  MAX_USED_LEAVE_DAYS,
  canCancelLeave,
  canDecideLeave,
  countLeaveDays,
  formatLeaveDate,
  formatLeaveDays,
  isHalfDay,
  isLeaveType,
  leaveApproverIds,
  leaveRangeError,
  leaveTypeInfo,
  parseLeaveDate,
} from "@/lib/leave";
import { loadLeaveManagers } from "@/lib/leaveData";
import { notify } from "@/lib/notify";

export type LeaveState = { error?: string; success?: string };

function cleanText(input: unknown, maxLength: number) {
  if (typeof input !== "string") return null;
  return input.replace(/\s+/g, " ").trim().slice(0, maxLength) || null;
}

function describeRange(start: Date, end: Date, days: number) {
  const range =
    start.getTime() === end.getTime()
      ? formatLeaveDate(start)
      : `${formatLeaveDate(start)} – ${formatLeaveDate(end)}`;
  return `${range} (${formatLeaveDays(days)} ngày)`;
}

export async function createLeaveRequest(
  _prev: LeaveState,
  formData: FormData
): Promise<LeaveState> {
  const user = await requireUser();
  const type = String(formData.get("type") ?? "");
  const startDate = parseLeaveDate(formData.get("startDate"));
  const endDate = parseLeaveDate(formData.get("endDate"));
  const rawHalfDay = String(formData.get("halfDay") ?? "");
  const halfDay = rawHalfDay ? rawHalfDay : null;

  if (!isLeaveType(type)) return { error: "Loại nghỉ không hợp lệ." };
  if (!startDate || !endDate) return { error: "Vui lòng chọn ngày nghỉ." };
  if (halfDay && !isHalfDay(halfDay)) return { error: "Buổi nghỉ không hợp lệ." };
  const rangeError = leaveRangeError(startDate, endDate, halfDay);
  if (rangeError) return { error: rangeError };

  const [overlap, requester] = await Promise.all([
    prisma.leaveRequest.findFirst({
      where: {
        userId: user.id,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { startDate: true, endDate: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        managerId: true,
        manager: { select: { isActive: true } },
      },
    }),
  ]);
  const leaveManagers = await loadLeaveManagers();
  const approverIds = leaveApproverIds(
    {
      id: requester.id,
      managerId: requester.managerId,
      managerActive: requester.manager?.isActive,
    },
    leaveManagers.map((manager) => manager.id)
  );
  if (approverIds.length === 0) {
    return {
      error:
        "Chưa có người duyệt đơn của bạn: bạn chưa có quản lý trực tiếp và chưa có quản lý nghỉ phép nào khác. Hãy báo Admin.",
    };
  }
  if (overlap) {
    return {
      error: `Bạn đã có đơn nghỉ trùng ngày (${formatLeaveDate(overlap.startDate)} – ${formatLeaveDate(overlap.endDate)}).`,
    };
  }

  const days = countLeaveDays(startDate, endDate, halfDay);
  await prisma.leaveRequest.create({
    data: {
      userId: user.id,
      type,
      startDate,
      endDate,
      halfDay,
      days,
      reason: cleanText(formData.get("reason"), 500),
    },
  });

  // Báo cho người duyệt: quản lý trực tiếp, hoặc quản lý nghỉ phép nếu chưa có.
  await notify(approverIds, {
    type: "LEAVE_REQUEST",
    message: `${user.name} xin ${leaveTypeInfo(type).label.toLowerCase()} ${describeRange(startDate, endDate, days)}. Cần bạn duyệt.`,
  });

  revalidatePath("/leave");
  return { success: "Đã gửi đơn xin nghỉ." };
}

export async function cancelLeaveRequest(requestId: string): Promise<LeaveState> {
  const user = await requireUser();
  const request = await prisma.leaveRequest.findFirst({
    where: { id: requestId, userId: user.id },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      days: true,
      deciderId: true,
    },
  });
  if (!request) return { error: "Không tìm thấy đơn nghỉ." };
  if (!canCancelLeave(request)) {
    return { error: "Đơn này không còn huỷ được." };
  }

  // Điều kiện status trong where chặn trường hợp đơn vừa được xử lý ở nơi khác.
  const updated = await prisma.leaveRequest.updateMany({
    where: { id: request.id, status: request.status },
    data: { status: "CANCELLED" },
  });
  if (updated.count === 0) {
    return { error: "Đơn vừa được cập nhật. Hãy tải lại trang." };
  }

  // Đơn đã duyệt bị huỷ: báo người đã duyệt và quản lý nghỉ phép.
  if (request.status === "APPROVED") {
    const leaveManagers = await loadLeaveManagers();
    await notify(
      [request.deciderId, ...leaveManagers.map((manager) => manager.id)].filter(
        (id) => id !== user.id
      ),
      {
        type: "LEAVE_DECISION",
        message: `${user.name} đã huỷ đơn nghỉ đã duyệt ${describeRange(request.startDate, request.endDate, request.days)}.`,
      }
    );
  }

  revalidatePath("/leave");
  return { success: "Đã huỷ đơn nghỉ." };
}

export async function decideLeaveRequest(
  requestId: string,
  approve: boolean,
  rawNote: string
): Promise<LeaveState> {
  const viewer = await requireUser();
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      days: true,
      user: {
        select: {
          id: true,
          name: true,
          managerId: true,
          manager: { select: { isActive: true } },
        },
      },
    },
  });
  if (!request) return { error: "Không tìm thấy đơn nghỉ." };
  const leaveManagerIds = (await loadLeaveManagers()).map(
    (manager) => manager.id
  );
  if (
    !canDecideLeave(
      { id: viewer.id, isLeaveManager: leaveManagerIds.includes(viewer.id) },
      {
        id: request.user.id,
        managerId: request.user.managerId,
        managerActive: request.user.manager?.isActive,
      }
    )
  ) {
    return {
      error:
        "Đơn này do quản lý trực tiếp của người xin duyệt (hoặc quản lý nghỉ phép nếu họ chưa có quản lý).",
    };
  }
  if (request.status !== "PENDING") {
    return { error: "Đơn này đã được xử lý." };
  }

  const updated = await prisma.leaveRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      deciderId: viewer.id,
      decidedAt: new Date(),
      decisionNote: cleanText(rawNote, 300),
    },
  });
  if (updated.count === 0) {
    return { error: "Đơn vừa được xử lý ở nơi khác. Hãy tải lại trang." };
  }

  const range = describeRange(request.startDate, request.endDate, request.days);
  await notify([request.user.id], {
    type: "LEAVE_DECISION",
    message: `${viewer.name} đã ${approve ? "duyệt" : "từ chối"} đơn nghỉ ${range} của bạn.`,
  });
  // Sau khi có kết quả, báo cho quản lý nghỉ phép để nắm tình hình.
  await notify(
    leaveManagerIds.filter(
      (id) => id !== viewer.id && id !== request.user.id
    ),
    {
      type: "LEAVE_DECISION",
      message: `${viewer.name} đã ${approve ? "duyệt" : "từ chối"} đơn nghỉ ${range} của ${request.user.name}.`,
    }
  );

  revalidatePath("/leave");
  return {
    success: approve
      ? `Đã duyệt đơn của ${request.user.name}.`
      : `Đã từ chối đơn của ${request.user.name}.`,
  };
}

/** Admin đặt số ngày phép năm cho một người. */
export async function setAnnualLeaveDays(
  userId: string,
  days: number
): Promise<LeaveState> {
  await requireAdmin();
  if (
    typeof days !== "number" ||
    !Number.isFinite(days) ||
    days < 0 ||
    days > MAX_ANNUAL_LEAVE_DAYS ||
    !Number.isInteger(days * 2)
  ) {
    return {
      error: `Số ngày phép phải từ 0 đến ${MAX_ANNUAL_LEAVE_DAYS}, bước 0,5.`,
    };
  }

  const updated = await prisma.user.updateMany({
    where: { id: userId },
    data: { annualLeaveDays: days },
  });
  if (updated.count === 0) return { error: "Tài khoản không tồn tại." };
  revalidatePath("/leave");
  return { success: "Đã lưu số ngày phép năm." };
}

/** Admin đặt tổng số ngày đã dùng của một người trong năm, không sửa đơn nghỉ. */
export async function setUsedLeaveDays(
  userId: string,
  year: number,
  days: number
): Promise<LeaveState> {
  await requireAdmin();
  if (
    typeof userId !== "string" ||
    !userId ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    typeof days !== "number" ||
    !Number.isFinite(days) ||
    days < 0 ||
    days > MAX_USED_LEAVE_DAYS ||
    !Number.isInteger(days * 2)
  ) {
    return {
      error: `Số ngày đã dùng phải từ 0 đến ${MAX_USED_LEAVE_DAYS}, bước 0,5.`,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const person = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!person) return false;

    const approved = await tx.leaveRequest.aggregate({
      where: {
        userId,
        type: "ANNUAL",
        status: "APPROVED",
        startDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      _sum: { days: true },
    });
    const adjustmentDays = days - (approved._sum.days ?? 0);
    await tx.leaveUsageAdjustment.upsert({
      where: { userId_year: { userId, year } },
      create: { userId, year, adjustmentDays },
      update: { adjustmentDays },
    });
    return true;
  });
  if (!result) return { error: "Tài khoản không tồn tại." };

  revalidatePath("/leave");
  return { success: "Đã lưu số ngày phép đã dùng." };
}

/** Admin đặt lại toàn bộ danh sách quản lý nghỉ phép. */
export async function setLeaveManagers(userIds: string[]): Promise<LeaveState> {
  await requireAdmin();
  if (
    !Array.isArray(userIds) ||
    userIds.length > 20 ||
    userIds.some((id) => typeof id !== "string" || !id)
  ) {
    return { error: "Danh sách quản lý không hợp lệ." };
  }
  const ids = [...new Set(userIds)];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true },
  });
  if (users.length !== ids.length) {
    return { error: "Có tài khoản không tồn tại hoặc đã bị vô hiệu hoá." };
  }

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { isLeaveManager: true, id: { notIn: ids } },
      data: { isLeaveManager: false },
    }),
    prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { isLeaveManager: true },
    }),
  ]);
  revalidatePath("/leave");
  return { success: "Đã lưu quản lý nghỉ phép." };
}
