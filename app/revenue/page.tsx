import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireProjectManager } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import RevenueBreakdown, { type RevenueRow } from "@/components/RevenueBreakdown";
import { avatarClass } from "@/lib/avatar";
import { PROJECT_STATUSES, formatVND } from "@/lib/types";
import {
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  UsersRound,
} from "lucide-react";

const EARNED = ["ON_PROCESS", "DONE"];
const LOST = ["CANCEL", "FAIL"];
const BRAND_GREEN = "#a8d431";
const BRAND_GREEN_DARK = "#587216";
const BRAND_GREEN_SOFT = "#f7fbe9";

function MixLegend({
  dotClass,
  brand = false,
  label,
  value,
  count,
}: {
  dotClass: string;
  brand?: boolean;
  label: string;
  value: number;
  count: number;
}) {
  return (
    <div>
      <p
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500"
        style={brand ? { color: BRAND_GREEN_DARK } : undefined}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full ${dotClass}`}
          style={brand ? { backgroundColor: BRAND_GREEN } : undefined}
          aria-hidden="true"
        />
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums text-zinc-950">
        {formatVND(value)}
      </p>
      <p className="text-xs text-zinc-400">{count} dự án</p>
    </div>
  );
}

export default async function RevenuePage() {
  const user = await requireProjectManager();
  const isAdmin = user.role === "ADMIN";

  // Admin thấy toàn bộ; Account chỉ thấy project mình tham gia
  const projectScope = isAdmin
    ? {}
    : { members: { some: { userId: user.id } } };

  const [projects, sidebarProjects] = await Promise.all([
    prisma.project.findMany({
      where: projectScope,
      select: {
        id: true,
        name: true,
        color: true,
        status: true,
        revenue: true,
        owner: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        account: {
          select: {
            id: true,
            name: true,
            team: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { revenue: "desc" },
    }),
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
      select: { id: true, name: true, color: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const revenueOf = (statuses: string[]) =>
    projects
      .filter((p) => statuses.includes(p.status))
      .reduce((sum, p) => sum + p.revenue, 0);
  const countOf = (statuses: string[]) =>
    projects.filter((p) => statuses.includes(p.status)).length;

  const earned = revenueOf(EARNED);
  const bidding = revenueOf(["BIDDING"]);
  const pendingRevenue = revenueOf(["PENDING"]);
  const lost = revenueOf(LOST);
  const totalMix = earned + bidding + pendingRevenue + lost;

  function groupRevenue(
    dimension: (p: (typeof projects)[number]) => { id: string; name: string } | null
  ): RevenueRow[] {
    const map = new Map<string, RevenueRow>();
    for (const p of projects) {
      const dim = dimension(p);
      const key = dim?.id ?? "__none__";
      const name = dim?.name ?? "Chưa gán";
      const entry = map.get(key) ?? {
        name,
        earned: 0,
        bidding: 0,
        count: 0,
        wonCount: 0,
        lostCount: 0,
      };
      entry.count += 1;
      if (EARNED.includes(p.status)) entry.earned += p.revenue;
      if (p.status === "BIDDING") entry.bidding += p.revenue;
      if (p.status === "DONE") entry.wonCount += 1;
      if (LOST.includes(p.status)) entry.lostCount += 1;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.earned - a.earned);
  }
  const byClient = groupRevenue((p) => p.client);
  const byAccount = groupRevenue((p) => p.account);
  const byTeam = groupRevenue((p) => p.account?.team ?? null);

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="revenue" />

      <main className="tf-main">
        <div className="tf-page space-y-6">
          <div>
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-[8px]"
                style={{ backgroundColor: BRAND_GREEN_SOFT, color: BRAND_GREEN_DARK }}
              >
                <CircleDollarSign size={20} aria-hidden="true" />
              </span>
              <h1 className="tf-page-title" style={{ color: BRAND_GREEN_DARK }}>
                Doanh số
              </h1>
            </div>
            {!isAdmin && (
              <p className="tf-page-subtitle">Chỉ tính các dự án bạn tham gia.</p>
            )}
          </div>

          <section className="tf-panel p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">Cơ cấu doanh số</h2>
              <span className="text-sm text-zinc-400">
                Tổng {formatVND(totalMix)}
              </span>
            </div>
            {totalMix > 0 ? (
              <>
                <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-zinc-100">
                  {earned > 0 && (
                    <div
                      style={{
                        width: `${(earned / totalMix) * 100}%`,
                        backgroundColor: BRAND_GREEN,
                      }}
                      title={`Doanh thu: ${formatVND(earned)}`}
                    />
                  )}
                  {bidding > 0 && (
                    <div
                      className="bg-amber-400"
                      style={{ width: `${(bidding / totalMix) * 100}%` }}
                      title={`Bidding: ${formatVND(bidding)}`}
                    />
                  )}
                  {pendingRevenue > 0 && (
                    <div
                      className="bg-violet-400"
                      style={{ width: `${(pendingRevenue / totalMix) * 100}%` }}
                      title={`Pending: ${formatVND(pendingRevenue)}`}
                    />
                  )}
                  {lost > 0 && (
                    <div
                      className="bg-red-500"
                      style={{ width: `${(lost / totalMix) * 100}%` }}
                      title={`Cancel / Fail: ${formatVND(lost)}`}
                    />
                  )}
                </div>
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <MixLegend
                    dotClass=""
                    brand
                    label="Doanh thu"
                    value={earned}
                    count={countOf(EARNED)}
                  />
                  <MixLegend
                    dotClass="bg-amber-400"
                    label="Bidding"
                    value={bidding}
                    count={countOf(["BIDDING"])}
                  />
                  <MixLegend
                    dotClass="bg-violet-400"
                    label="Pending"
                    value={pendingRevenue}
                    count={countOf(["PENDING"])}
                  />
                  <MixLegend
                    dotClass="bg-red-500"
                    label="Cancel / Fail"
                    value={lost}
                    count={countOf(LOST)}
                  />
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-zinc-400">Chưa có dữ liệu.</p>
            )}
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <RevenueBreakdown title="Theo Client" rows={byClient} icon={Building2} />
            <RevenueBreakdown
              title="Theo Account"
              rows={byAccount}
              icon={BriefcaseBusiness}
            />
            <RevenueBreakdown
              title="Theo Team"
              rows={byTeam}
              icon={UsersRound}
            />
          </div>

          <section className="tf-panel overflow-hidden">
            <div className="border-b border-zinc-100 px-5 py-3">
              <h2 className="font-semibold">
                Các dự án ({projects.length})
              </h2>
            </div>
            {projects.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-400">
                Chưa có dự án nào.
              </p>
            ) : (
              PROJECT_STATUSES.map((s) => {
                const group = projects.filter((p) => p.status === s.key);
                if (group.length === 0) return null;
                const subtotal = group.reduce((sum, p) => sum + p.revenue, 0);
                return (
                  <div key={s.key}>
                    <div className="flex items-center gap-2 border-y border-zinc-100 bg-zinc-50 px-4 py-2">
                      <span className={`tf-badge ${s.className}`}>{s.label}</span>
                      <span className="text-xs text-zinc-400">{group.length}</span>
                      <span className="ml-auto text-xs font-semibold tabular-nums text-zinc-600">
                        {formatVND(subtotal)}
                      </span>
                    </div>
                    <div className="divide-y divide-zinc-50">
                      {group.map((p) => (
                        <Link
                          key={p.id}
                          href={`/projects/${p.id}`}
                          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-50"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: p.color }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {p.name}
                          </span>
                          <span className="hidden min-w-0 max-w-[220px] truncate text-xs text-zinc-400 sm:block">
                            {p.client?.name ?? "—"} · {p.account?.name ?? "—"}
                          </span>
                          {isAdmin && (
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${avatarClass(p.owner.id)}`}
                              title={`Chủ dự án: ${p.owner.name}`}
                            >
                              {p.owner.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="w-[110px] shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-600">
                            {formatVND(p.revenue)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
