import Link from "next/link";
import { ChevronRight, Target } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import {
  KpiCompanyPlanEditor,
  KpiPlanLockBar,
  KpiTeamAllocationEditor,
} from "@/components/KpiPlanEditor";
import {
  KpiMonthlyChart,
  KpiProgressBar,
  KpiSummary,
  formatCompactVND,
} from "@/components/KpiViews";
import {
  canAllocateTeamKpi,
  canViewTeamKpi,
  isValidKpiYear,
  sumMonths,
  vietnamYearMonth,
} from "@/lib/kpi";
import { loadKpiOverview, loadMemberContribution } from "@/lib/kpiData";
import { formatVND } from "@/lib/types";

const KPI_BLUE_DARK = "#1d4ed8";
const KPI_BLUE_SOFT = "#eff6ff";

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function kpiHref(params: {
  year: number;
  view?: string;
  team?: string;
  scope?: string;
}) {
  const query = new URLSearchParams({ year: String(params.year) });
  if (params.view) query.set("view", params.view);
  if (params.team) query.set("team", params.team);
  if (params.scope && params.scope !== "company") {
    query.set("scope", params.scope);
  }
  return `/kpi?${query.toString()}`;
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-blue-600 bg-blue-600 font-medium text-white"
          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function KpiPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    view?: string;
    team?: string;
    scope?: string;
  }>;
}) {
  // Mọi người dùng đều vào được tab KPI; nội dung lọc theo vai trò bên dưới.
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const isAdmin = user.role === "ADMIN";
  const currentYear = vietnamYearMonth(new Date()).year;
  const requestedYear = Number(params.year);
  const year = isValidKpiYear(requestedYear) ? requestedYear : currentYear;

  const [overview, contribution, planYears, viewerAccount, sidebarProjects] =
    await Promise.all([
      loadKpiOverview(year),
      loadMemberContribution(user.id, year),
      prisma.kpiPlan.findMany({ select: { year: true } }),
      prisma.account.findUnique({
        where: { userId: user.id },
        select: { id: true, teamId: true },
      }),
      prisma.project.findMany({
        where: { members: { some: { userId: user.id } } },
        select: {
          id: true,
          name: true,
          color: true,
          status: true,
          category: true,
          responsibleTeam: { select: { id: true, name: true } },
          responsibleGroup: { select: { id: true, name: true } },
          account: { select: { team: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const viewer = {
    role: user.role,
    accountId: viewerAccount?.id ?? null,
    teamId: viewerAccount?.teamId ?? null,
  };
  const years = [
    ...new Set([
      ...planYears.map((plan) => plan.year),
      currentYear,
      currentYear + 1,
      year,
    ]),
  ].sort((a, b) => a - b);

  // Account chỉ thấy team mình và tổng công ty; Admin thấy mọi team.
  const visibleTeams = overview.teams.filter((team) =>
    canViewTeamKpi(viewer, team.id)
  );
  const editableTeams = overview.teams.filter((team) =>
    canAllocateTeamKpi(viewer, team)
  );
  const canPlan = isAdmin || editableTeams.length > 0;
  const view = params.view === "plan" && canPlan ? "plan" : "track";
  // Người vừa là Admin vừa thuộc một team: mặc định mở team của chính họ.
  const selectedTeam =
    editableTeams.find((team) => team.id === params.team) ??
    editableTeams.find((team) => team.id === viewer.teamId) ??
    editableTeams[0];

  const companyYearTarget =
    overview.companyTarget > 0
      ? overview.companyTarget
      : sumMonths(overview.companyMonthlyTarget);
  // Phòng ban ngoài team kinh doanh: không được biết chỉ tiêu hay tổng doanh số
  // công ty, chỉ xem số dự án mình được thêm vào và doanh số các dự án đó.
  const isSalesViewer = isAdmin || viewerAccount !== null;
  const locked = overview.lockedAt !== null;
  const myAccount = visibleTeams
    .flatMap((team) => team.accounts)
    .find((account) => account.id === viewer.accountId);

  // Phạm vi theo dõi: công ty, từng team được xem (team của mình xếp đầu), cá nhân.
  const scopeTeams = [...visibleTeams].sort(
    (a, b) =>
      Number(b.id === viewer.teamId) - Number(a.id === viewer.teamId)
  );
  const scopes = [
    { key: "company", label: "Công ty" },
    ...scopeTeams.map((team) => ({
      key: `team:${team.id}`,
      label:
        team.id !== viewer.teamId
          ? team.name
          : isAdmin
            ? `${team.name} (team của tôi)`
            : "Team của tôi",
    })),
    ...(myAccount ? [{ key: "me", label: "Của tôi" }] : []),
  ];
  const scopeKey = scopes.some((scope) => scope.key === params.scope)
    ? (params.scope as string)
    : "company";
  const scopeTeam =
    scopeTeams.find((team) => `team:${team.id}` === scopeKey) ?? null;
  const scopeView =
    scopeKey === "me" && myAccount
      ? {
          title: "KPI của tôi",
          yearTarget: sumMonths(myAccount.target),
          monthlyTarget: myAccount.target,
          actual: myAccount.actual,
        }
      : scopeTeam
        ? {
            title: scopeTeam.name,
            yearTarget: sumMonths(scopeTeam.target),
            monthlyTarget: scopeTeam.target,
            actual: scopeTeam.actual,
          }
        : {
            title: "Công ty",
            yearTarget: companyYearTarget,
            monthlyTarget: overview.companyMonthlyTarget,
            actual: overview.companyActual,
          };
  const scopeLeader = scopeTeam?.accounts.find(
    (account) => account.id === scopeTeam.leaderId
  );

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="kpi" />

      <main className="tf-main">
        <div className="tf-page space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-[8px]"
                  style={{
                    backgroundColor: KPI_BLUE_SOFT,
                    color: KPI_BLUE_DARK,
                  }}
                >
                  <Target size={20} aria-hidden="true" />
                </span>
                <h1 className="tf-page-title" style={{ color: KPI_BLUE_DARK }}>
                  KPI doanh số
                </h1>
              </div>
            </div>
            <nav className="flex flex-wrap gap-2" aria-label="Năm kế hoạch">
              {years.map((y) => (
                <Chip
                  key={y}
                  href={kpiHref({
                    year: y,
                    view: view === "plan" ? "plan" : undefined,
                    scope: view === "plan" ? undefined : scopeKey,
                  })}
                  active={y === year}
                >
                  {y}
                </Chip>
              ))}
            </nav>
          </div>

          {canPlan && (
            <nav className="flex gap-2" aria-label="Chế độ xem KPI">
              <Chip href={kpiHref({ year })} active={view === "track"}>
                Theo dõi
              </Chip>
              <Chip
                href={kpiHref({ year, view: "plan" })}
                active={view === "plan"}
              >
                Lập kế hoạch
              </Chip>
            </nav>
          )}

          {view === "plan" ? (
            <>
              {overview.hasPlan && (
                <KpiPlanLockBar
                  year={year}
                  lockedAtLabel={
                    overview.lockedAt ? formatDateTime(overview.lockedAt) : null
                  }
                  canToggle={isAdmin}
                />
              )}

              {isAdmin && (
                <KpiCompanyPlanEditor
                  key={year}
                  locked={locked}
                  year={year}
                  companyTarget={overview.companyTarget}
                  teams={overview.teams.map((team) => ({
                    id: team.id,
                    name: team.name,
                    months: team.target,
                    accounts: team.accounts.map((account) => ({
                      id: account.id,
                      name: account.name,
                    })),
                  }))}
                />
              )}

              {!overview.hasPlan ? (
                <section className="tf-panel px-5 py-4 text-sm text-zinc-500">
                  {isAdmin
                    ? `Lưu kế hoạch KPI năm ${year} ở trên trước, sau đó mới chia chỉ tiêu team xuống từng Account.`
                    : `Admin chưa lập kế hoạch KPI năm ${year} nên chưa thể chia chỉ tiêu cho Account.`}
                </section>
              ) : (
                selectedTeam && (
                  <>
                    {editableTeams.length > 1 && (
                      <nav
                        className="flex flex-wrap gap-2"
                        aria-label="Chọn team để chia KPI"
                      >
                        {editableTeams.map((team) => (
                          <Chip
                            key={team.id}
                            href={kpiHref({ year, view: "plan", team: team.id })}
                            active={team.id === selectedTeam.id}
                          >
                            {team.name}
                          </Chip>
                        ))}
                      </nav>
                    )}
                    <KpiTeamAllocationEditor
                      key={`${year}-${selectedTeam.id}`}
                      locked={locked}
                      year={year}
                      team={{
                        id: selectedTeam.id,
                        name: selectedTeam.name,
                        months: selectedTeam.target,
                      }}
                      accounts={selectedTeam.accounts.map((account) => ({
                        id: account.id,
                        name: account.name,
                        months: account.target,
                      }))}
                    />
                  </>
                )
              )}

              {isAdmin && overview.changes.length > 0 && (
                <section className="tf-panel overflow-hidden">
                  <div className="border-b border-zinc-100 px-5 py-3">
                    <h2 className="font-semibold">Lịch sử thay đổi</h2>
                  </div>
                  <ul className="divide-y divide-zinc-50">
                    {overview.changes.map((change) => (
                      <li
                        key={change.id}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm"
                      >
                        <span className="min-w-0 flex-1 text-zinc-800">
                          {change.summary}
                        </span>
                        <span className="shrink-0 text-xs text-zinc-500">
                          {change.userName}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                          {formatDateTime(change.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <>
              {isSalesViewer && !overview.hasPlan && (
                <section className="tf-panel px-5 py-4 text-sm text-zinc-500">
                  Chưa có kế hoạch KPI năm {year}.{" "}
                  {isAdmin ? (
                    <Link
                      href={kpiHref({ year, view: "plan" })}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      Lập kế hoạch
                    </Link>
                  ) : (
                    "Admin sẽ xác lập kế hoạch năm."
                  )}
                </section>
              )}

              {isSalesViewer && (
                <>
                  <nav
                    className="flex flex-wrap gap-2"
                    aria-label="Phạm vi theo dõi KPI"
                  >
                    {scopes.map((scope) => (
                      <Chip
                        key={scope.key}
                        href={kpiHref({ year, scope: scope.key })}
                        active={scope.key === scopeKey}
                      >
                        {scope.label}
                      </Chip>
                    ))}
                  </nav>

                  <section className="space-y-4">
                    <div>
                      <h2 className="font-semibold">{scopeView.title}</h2>
                      {scopeTeam && (
                        <p className="mt-0.5 text-xs text-zinc-400">
                          {scopeTeam.accounts.length} Account
                          {scopeLeader
                            ? ` · Manager: ${scopeLeader.name}`
                            : ""}
                        </p>
                      )}
                    </div>
                    <KpiSummary
                      year={year}
                      yearTarget={scopeView.yearTarget}
                      monthlyTarget={scopeView.monthlyTarget}
                      actual={scopeView.actual}
                    />
                    <div className="tf-panel p-5">
                      <KpiMonthlyChart
                        target={scopeView.monthlyTarget}
                        actual={scopeView.actual}
                      />
                    </div>
                  </section>
                </>
              )}

              {!isSalesViewer && (
                <section className="space-y-4">
                  <h2 className="font-semibold">Dự án tôi tham gia</h2>
                  <div className="tf-metric-strip">
                    <section className="tf-metric-item">
                      <p className="text-xs font-medium text-zinc-500">
                        Số dự án tham gia
                      </p>
                      <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                        {contribution.joinedCount}
                      </p>
                    </section>
                    <section className="tf-metric-item">
                      <p className="text-xs font-medium text-zinc-500">
                        Số dự án thất bại
                      </p>
                      <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                        {contribution.failedCount}
                      </p>
                    </section>
                    <section className="tf-metric-item">
                      <p className="text-xs font-medium text-zinc-500">
                        Doanh số đóng góp
                      </p>
                      <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                        {formatCompactVND(contribution.total)}
                      </p>
                    </section>
                    <section className="tf-metric-item">
                      <p className="text-xs font-medium text-zinc-500">
                        Số dự án đã ghi nhận
                      </p>
                      <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                        {contribution.projects.length}
                      </p>
                    </section>
                  </div>
                  <div className="tf-panel overflow-hidden">
                    {contribution.projects.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-zinc-400">
                        Chưa có dự án nào bạn tham gia được ghi nhận doanh số
                        trong năm {year}.
                      </p>
                    ) : (
                      <ul className="divide-y divide-zinc-50">
                        {contribution.projects.map((project) => (
                          <li key={project.id}>
                            <Link
                              href={`/projects/${project.id}`}
                              prefetch={false}
                              className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-zinc-50"
                            >
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {project.name}
                              </span>
                              <span className="shrink-0 text-xs text-zinc-400">
                                Tháng {project.month}
                              </span>
                              <span className="w-32 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-700">
                                {formatVND(project.revenue)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              )}

              {isAdmin && scopeKey === "company" && (
                <section className="tf-panel overflow-hidden">
                  <div className="border-b border-zinc-100 px-5 py-3">
                    <h2 className="font-semibold">KPI theo team</h2>
                  </div>
                  {scopeTeams.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-zinc-400">
                      Chưa có team kinh doanh.
                    </p>
                  ) : (
                    <ul className="divide-y divide-zinc-100">
                      {scopeTeams.map((team) => {
                        const teamTarget = sumMonths(team.target);
                        const teamActual = sumMonths(team.actual);
                        const leader = team.accounts.find(
                          (account) => account.id === team.leaderId
                        );
                        return (
                          <li key={team.id}>
                            <Link
                              href={kpiHref({ year, scope: `team:${team.id}` })}
                              prefetch={false}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 transition-colors hover:bg-zinc-50 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">
                                  {team.name}
                                </p>
                                <p className="truncate text-xs text-zinc-400">
                                  {team.accounts.length} Account
                                  {leader ? ` · Manager: ${leader.name}` : ""}
                                </p>
                              </div>
                              <p className="col-start-1 text-xs tabular-nums text-zinc-500 sm:col-start-auto sm:text-right">
                                <span className="font-semibold text-zinc-900">
                                  {formatCompactVND(teamActual)}
                                </span>{" "}
                                /{" "}
                                {teamTarget > 0
                                  ? formatCompactVND(teamTarget)
                                  : "—"}
                              </p>
                              <div className="col-span-2 sm:col-span-1">
                                <KpiProgressBar
                                  actual={teamActual}
                                  target={teamTarget}
                                />
                              </div>
                              <ChevronRight
                                size={16}
                                className="col-start-2 row-start-1 shrink-0 text-zinc-400 sm:col-start-auto sm:row-start-auto"
                                aria-hidden="true"
                              />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}

              {isSalesViewer && scopeTeam && (
                <section className="tf-panel overflow-hidden">
                  <div className="border-b border-zinc-100 px-5 py-3">
                    <h2 className="font-semibold">Account trong team</h2>
                  </div>
                  {scopeTeam.accounts.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-zinc-400">
                      Team này chưa có Account nào.
                    </p>
                  ) : (
                    <ul className="divide-y divide-zinc-100">
                      {scopeTeam.accounts.map((account) => {
                        const target = sumMonths(account.target);
                        const actual = sumMonths(account.actual);
                        return (
                          <li
                            key={account.id}
                            className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 px-5 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)]"
                          >
                            <p className="truncate text-sm font-medium text-zinc-800">
                              {account.name}
                              {account.id === scopeTeam.leaderId && (
                                <span className="ml-2 text-xs font-normal text-zinc-400">
                                  Manager
                                </span>
                              )}
                            </p>
                            <p className="text-xs tabular-nums text-zinc-500 sm:text-right">
                              <span className="font-semibold text-zinc-900">
                                {formatCompactVND(actual)}
                              </span>{" "}
                              / {target > 0 ? formatCompactVND(target) : "—"}
                            </p>
                            <KpiProgressBar actual={actual} target={target} />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
