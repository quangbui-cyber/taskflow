"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireRevenueViewer } from "@/lib/auth";
import {
  canAllocateTeamKpi,
  isValidKpiYear,
  parseMonthlyAmounts,
  sumMonths,
} from "@/lib/kpi";

export type KpiState = { error?: string; success?: string };

const KPI_AMOUNT_ERROR =
  "Chỉ tiêu quá lớn: mỗi tháng tối đa 1.000 tỷ ₫ (1.000.000 triệu). Lưu ý đơn vị nhập là triệu đồng.";
const KPI_LOCKED_ERROR =
  "Kế hoạch đã chốt. Admin cần mở lại kế hoạch trước khi sửa chỉ tiêu.";

type MonthlyRow = { id: string; months: number[] };

function parseRows(input: unknown): MonthlyRow[] | null {
  if (!Array.isArray(input)) return null;
  const rows: MonthlyRow[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== "object" || item === null) return null;
    const { id, months } = item as { id?: unknown; months?: unknown };
    const parsed = parseMonthlyAmounts(months);
    if (typeof id !== "string" || !id || seen.has(id) || !parsed) return null;
    seen.add(id);
    rows.push({ id, months: parsed });
  }
  return rows;
}

/** Số tiền gọn cho nhật ký: "2,7 tỷ", "700,5 triệu". */
function compactVND(value: number) {
  const format = (n: number) =>
    new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
  return value >= 1_000_000_000
    ? `${format(value / 1_000_000_000)} tỷ`
    : `${format(value / 1_000_000)} triệu`;
}

/** Admin xác lập KPI năm của công ty và giao chỉ tiêu tháng cho từng team. */
export async function saveCompanyKpiPlan(
  year: number,
  companyTarget: number,
  teamRows: MonthlyRow[]
): Promise<KpiState> {
  const admin = await requireAdmin();
  if (!isValidKpiYear(year)) return { error: "Năm kế hoạch không hợp lệ." };
  if (
    typeof companyTarget !== "number" ||
    !Number.isFinite(companyTarget) ||
    companyTarget < 0
  ) {
    return { error: "KPI công ty không hợp lệ." };
  }
  const rows = parseRows(teamRows);
  if (!rows) return { error: KPI_AMOUNT_ERROR };

  const [teams, existing] = await Promise.all([
    prisma.salesTeam.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: { id: true },
    }),
    prisma.kpiPlan.findUnique({ where: { year }, select: { lockedAt: true } }),
  ]);
  if (teams.length !== rows.length) {
    return { error: "Có team không còn tồn tại. Hãy tải lại trang." };
  }
  if (existing?.lockedAt) return { error: KPI_LOCKED_ERROR };

  const assigned = rows.reduce((sum, row) => sum + sumMonths(row.months), 0);
  await prisma.$transaction(async (tx) => {
    const plan = await tx.kpiPlan.upsert({
      where: { year },
      update: { companyTarget: Math.round(companyTarget) },
      create: { year, companyTarget: Math.round(companyTarget) },
      select: { id: true },
    });
    await tx.kpiTeamTarget.deleteMany({
      where: { planId: plan.id, teamId: { in: rows.map((row) => row.id) } },
    });
    await tx.kpiTeamTarget.createMany({
      data: rows.flatMap((row) =>
        row.months.map((amount, index) => ({
          planId: plan.id,
          teamId: row.id,
          month: index + 1,
          amount,
        }))
      ),
    });
    await tx.kpiPlanChange.create({
      data: {
        planId: plan.id,
        userId: admin.id,
        userName: admin.name,
        summary: `Lưu kế hoạch công ty: KPI ${compactVND(companyTarget)}, giao team ${compactVND(assigned)}`,
      },
    });
  });

  revalidatePath("/kpi");
  return { success: `Đã lưu kế hoạch KPI năm ${year}.` };
}

/** Admin hoặc trưởng team chia chỉ tiêu của team xuống từng Account. */
export async function saveTeamKpiAllocation(
  year: number,
  teamId: string,
  accountRows: MonthlyRow[]
): Promise<KpiState> {
  const user = await requireRevenueViewer();
  if (!isValidKpiYear(year)) return { error: "Năm kế hoạch không hợp lệ." };
  const rows = parseRows(accountRows);
  if (!rows) return { error: KPI_AMOUNT_ERROR };

  const [team, viewerAccount, plan] = await Promise.all([
    prisma.salesTeam.findUnique({
      where: { id: teamId },
      select: {
        name: true,
        leaderId: true,
        accounts: { select: { id: true } },
      },
    }),
    prisma.account.findUnique({
      where: { userId: user.id },
      select: { id: true },
    }),
    prisma.kpiPlan.findUnique({
      where: { year },
      select: { id: true, lockedAt: true },
    }),
  ]);
  if (!team) return { error: "Team không tồn tại." };
  if (
    !canAllocateTeamKpi(
      { role: user.role, accountId: viewerAccount?.id ?? null },
      team
    )
  ) {
    return { error: "Chỉ Admin hoặc Manager của team được chia KPI của team." };
  }
  if (!plan) {
    return { error: `Admin chưa lập kế hoạch KPI năm ${year}.` };
  }
  if (plan.lockedAt) return { error: KPI_LOCKED_ERROR };
  const teamAccountIds = new Set(team.accounts.map((account) => account.id));
  if (rows.some((row) => !teamAccountIds.has(row.id))) {
    return { error: "Có Account không thuộc team này. Hãy tải lại trang." };
  }

  const allocated = rows.reduce((sum, row) => sum + sumMonths(row.months), 0);
  await prisma.$transaction([
    prisma.kpiAccountTarget.deleteMany({
      where: { planId: plan.id, accountId: { in: rows.map((row) => row.id) } },
    }),
    prisma.kpiAccountTarget.createMany({
      data: rows.flatMap((row) =>
        row.months.map((amount, index) => ({
          planId: plan.id,
          accountId: row.id,
          month: index + 1,
          amount,
        }))
      ),
    }),
    prisma.kpiPlanChange.create({
      data: {
        planId: plan.id,
        userId: user.id,
        userName: user.name,
        summary: `Chia KPI ${team.name} xuống Account: ${compactVND(allocated)}`,
      },
    }),
  ]);

  revalidatePath("/kpi");
  return { success: `Đã lưu phần chia KPI của ${team.name}.` };
}

/** Admin chốt kế hoạch (khoá mọi chỉnh sửa) hoặc mở lại để sửa. */
export async function setKpiPlanLocked(
  year: number,
  locked: boolean
): Promise<KpiState> {
  const admin = await requireAdmin();
  const plan = await prisma.kpiPlan.findUnique({
    where: { year },
    select: { id: true, lockedAt: true },
  });
  if (!plan) return { error: `Chưa có kế hoạch KPI năm ${year}.` };
  if (Boolean(plan.lockedAt) === locked) {
    return { success: locked ? "Kế hoạch đã chốt." : "Kế hoạch đang mở." };
  }

  await prisma.$transaction([
    prisma.kpiPlan.update({
      where: { id: plan.id },
      data: { lockedAt: locked ? new Date() : null },
    }),
    prisma.kpiPlanChange.create({
      data: {
        planId: plan.id,
        userId: admin.id,
        userName: admin.name,
        summary: locked ? "Chốt kế hoạch" : "Mở lại kế hoạch để sửa",
      },
    }),
  ]);

  revalidatePath("/kpi");
  return {
    success: locked
      ? `Đã chốt kế hoạch KPI năm ${year}.`
      : `Đã mở lại kế hoạch KPI năm ${year}.`,
  };
}
