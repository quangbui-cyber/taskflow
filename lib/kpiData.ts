import { prisma } from "@/lib/prisma";
import {
  KPI_RECOGNIZED_STATUSES,
  addMonths,
  emptyMonths,
  kpiYearRange,
  vietnamYearMonth,
} from "@/lib/kpi";

export type KpiAccountRow = {
  id: string;
  name: string;
  userId: string | null;
  target: number[]; // chỉ tiêu 12 tháng (VND)
  actual: number[]; // doanh số ghi nhận 12 tháng (VND)
};

export type KpiTeamRow = {
  id: string;
  name: string;
  leaderId: string | null;
  target: number[]; // Admin giao cho team
  allocated: number[]; // tổng đã chia xuống các Account
  actual: number[];
  accounts: KpiAccountRow[];
};

export type KpiOverview = {
  year: number;
  hasPlan: boolean;
  lockedAt: Date | null;
  changes: Array<{
    id: string;
    userName: string;
    summary: string;
    createdAt: Date;
  }>;
  companyTarget: number; // KPI cả năm của công ty
  companyMonthlyTarget: number[]; // tổng chỉ tiêu tháng của các team
  companyActual: number[]; // gồm cả dự án chưa gán Account
  teams: KpiTeamRow[];
};

function fillMonths(
  rows: Array<{ month: number; amount: number }>
): number[] {
  const months = emptyMonths();
  for (const row of rows) {
    if (row.month >= 1 && row.month <= 12) months[row.month - 1] = row.amount;
  }
  return months;
}

/** Kế hoạch và doanh số ghi nhận của cả công ty trong một năm, gom theo team và Account. */
export async function loadKpiOverview(year: number): Promise<KpiOverview> {
  const range = kpiYearRange(year);
  const [plan, teams, projects] = await Promise.all([
    prisma.kpiPlan.findUnique({
      where: { year },
      select: {
        companyTarget: true,
        lockedAt: true,
        changes: {
          select: { id: true, userName: true, summary: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        teamTargets: { select: { teamId: true, month: true, amount: true } },
        accountTargets: {
          select: { accountId: true, month: true, amount: true },
        },
      },
    }),
    prisma.salesTeam.findMany({
      select: {
        id: true,
        name: true,
        leaderId: true,
        accounts: {
          select: { id: true, name: true, userId: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    // Cùng quy tắc với trang Doanh số: dự án khách hàng, ghi nhận vào tháng
    // chuyển sang On Process.
    prisma.project.findMany({
      where: {
        category: "CLIENT",
        status: { in: KPI_RECOGNIZED_STATUSES },
        onProcessAt: { gte: range.start, lt: range.end },
      },
      select: { revenue: true, onProcessAt: true, accountId: true },
    }),
  ]);

  const companyActual = emptyMonths();
  const actualByAccount = new Map<string, number[]>();
  for (const project of projects) {
    if (!project.onProcessAt) continue;
    const index = vietnamYearMonth(project.onProcessAt).month - 1;
    companyActual[index] += project.revenue;
    if (!project.accountId) continue;
    const months = actualByAccount.get(project.accountId) ?? emptyMonths();
    months[index] += project.revenue;
    actualByAccount.set(project.accountId, months);
  }

  const teamRows: KpiTeamRow[] = teams.map((team) => {
    const accounts: KpiAccountRow[] = team.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      userId: account.userId,
      target: fillMonths(
        plan?.accountTargets.filter((t) => t.accountId === account.id) ?? []
      ),
      actual: actualByAccount.get(account.id) ?? emptyMonths(),
    }));
    return {
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      target: fillMonths(
        plan?.teamTargets.filter((t) => t.teamId === team.id) ?? []
      ),
      allocated: accounts.reduce(
        (sum, account) => addMonths(sum, account.target),
        emptyMonths()
      ),
      actual: accounts.reduce(
        (sum, account) => addMonths(sum, account.actual),
        emptyMonths()
      ),
      accounts,
    };
  });

  return {
    year,
    hasPlan: plan !== null,
    lockedAt: plan?.lockedAt ?? null,
    changes: plan?.changes ?? [],
    companyTarget: plan?.companyTarget ?? 0,
    companyMonthlyTarget: teamRows.reduce(
      (sum, team) => addMonths(sum, team.target),
      emptyMonths()
    ),
    companyActual,
    teams: teamRows,
  };
}

export type KpiMemberContribution = {
  total: number;
  joinedCount: number; // dự án khách hàng tham gia trong năm
  failedCount: number; // trong đó ở trạng thái Fail
  projects: Array<{
    id: string;
    name: string;
    revenue: number;
    month: number; // tháng ghi nhận (1-12)
  }>;
};

/**
 * Doanh số ghi nhận trong năm của các dự án mà một người được thêm làm thành viên —
 * dùng cho phòng ban không thuộc team kinh doanh.
 */
export async function loadMemberContribution(
  userId: string,
  year: number
): Promise<KpiMemberContribution> {
  const range = kpiYearRange(year);
  const inYear = { gte: range.start, lt: range.end };
  // Dự án thuộc năm nếu được tạo hoặc được ghi nhận doanh số trong năm đó
  // (dự án Fail thường chưa từng On Process nên chỉ có ngày tạo).
  const joined = await prisma.project.findMany({
    where: {
      members: { some: { userId } },
      category: "CLIENT",
      OR: [{ createdAt: inYear }, { onProcessAt: inYear }],
    },
    select: {
      id: true,
      name: true,
      status: true,
      revenue: true,
      onProcessAt: true,
    },
    orderBy: { onProcessAt: "asc" },
  });
  const projects = joined.filter(
    (project) =>
      KPI_RECOGNIZED_STATUSES.includes(project.status) &&
      project.onProcessAt !== null &&
      project.onProcessAt >= range.start &&
      project.onProcessAt < range.end
  );

  return {
    joinedCount: joined.length,
    failedCount: joined.filter((project) => project.status === "FAIL").length,
    total: projects.reduce((sum, project) => sum + project.revenue, 0),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      revenue: project.revenue,
      month: vietnamYearMonth(project.onProcessAt!).month,
    })),
  };
}
