import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import QuickClientCreator from "@/components/QuickClientCreator";
import TierBadge from "@/components/crm/TierBadge";
import OutcomeDots from "@/components/crm/OutcomeDots";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled } from "@/lib/features";
import { canCreateClient } from "@/lib/clientCatalog";
import { loadClientList, CLIENT_PAGE_SIZE, type ClientListFilters } from "@/lib/crm/clientData";
import { getCrmSettings } from "@/lib/crm/settings";
import { TIER_LABELS } from "@/lib/crm/labels";
import type { TierValue } from "@/lib/crm/settingsSchema";
import { formatCrmDate } from "@/lib/crm/dates";
import { ownerHref } from "@/lib/workOwner";

const STATUS_OPTIONS = [{ key: "OVERDUE", label: "Quá hạn" }, { key: "NO_NEXT_STEP", label: "Chưa có bước tiếp theo" }, { key: "ON_TRACK", label: "Đúng hạn" }, { key: "PENDING_PIC_CONFIRM", label: "Chờ PIC xác nhận" }] as const;
function compactRevenue(amount: number) {
  const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
  return amount >= 1e9 ? `${number.format(amount / 1e9)} tỷ` : amount >= 1e6 ? `${number.format(amount / 1e6)} triệu` : `${number.format(amount)} ₫`;
}
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!crmEnabled()) notFound();
  const raw = await searchParams;
  const params = Object.fromEntries(["q", "tier", "pic", "team", "status", "page"].map((key) => [key, typeof raw[key] === "string" ? raw[key] : undefined])) as Record<"q" | "tier" | "pic" | "team" | "status" | "page", string | undefined>;
  const now = new Date();
  const page = /^\d{1,5}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  const filters: ClientListFilters = {
    q: params.q?.trim().slice(0, 200) || undefined,
    tier: params.tier && Object.hasOwn(TIER_LABELS, params.tier) ? params.tier as TierValue : undefined,
    picAccountId: params.pic && params.pic.length <= 64 ? params.pic : undefined,
    teamId: params.team && params.team.length <= 64 ? params.team : undefined,
    status: STATUS_OPTIONS.find((option) => option.key === params.status)?.key,
    take: page * CLIENT_PAGE_SIZE,
  };
  const [settings, accounts, teams, projects] = await Promise.all([
    getCrmSettings(prisma),
    prisma.account.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.salesTeam.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const data = await loadClientList(prisma, filters, settings, now);
  const filtered = !!(filters.q || filters.tier || filters.picAccountId || filters.teamId || filters.status);
  const more = new URLSearchParams();
  for (const key of ["q", "tier", "pic", "team", "status"] as const) if (params[key]) more.set(key, params[key]!);
  more.set("page", String(page + 1));
  type Row = typeof data.rows[number];
  const nextStep = (client: Row) => client.nextStep ? <div className="space-y-1">
    <Link href={ownerHref({ kind: client.nextStep.opportunityId ? "OPPORTUNITY" : "CLIENT", id: client.nextStep.opportunityId ?? client.id }, client.nextStep.id)} className="text-sm hover:underline">{client.nextStep.title}</Link>
    {client.nextStep.dueDate && <p className={`text-xs ${client.overdue ? "text-[#b86a08]" : "text-zinc-500"}`}>{formatCrmDate(client.nextStep.dueDate, now)}</p>}
  </div> : <span className="text-sm text-zinc-400">Chưa có bước tiếp theo</span>;
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmClients" />
    <main className="tf-main"><HubTabs section="crmClients" role={user.role} />
      <div className="tf-page space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="tf-page-title">Khách hàng</h1><p className="tf-page-subtitle">{data.total} khách · {data.inCareCount} đang chăm sóc</p></div>
          {canCreateClient(user.role) && <QuickClientCreator openProfileOnCreate triggerLabel="Thêm khách hàng" triggerClassName="tf-button-primary" />}
        </header>
        <form action="/crm/clients" className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(160px,2fr)_repeat(4,minmax(110px,1fr))_auto]">
          <label className="block text-sm">Tìm khách hàng<input name="q" defaultValue={filters.q ?? ""} maxLength={200} placeholder="Tìm khách hàng" className="tf-field mt-2" /></label>
          <label className="block text-sm">Hạng<select name="tier" defaultValue={filters.tier ?? ""} className="tf-field mt-2"><option value="">Tất cả hạng</option>{Object.entries(TIER_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="block text-sm">PIC<select name="pic" defaultValue={filters.picAccountId ?? ""} className="tf-field mt-2"><option value="">Tất cả PIC</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label className="block text-sm">Team<select name="team" defaultValue={filters.teamId ?? ""} className="tf-field mt-2"><option value="">Tất cả team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <label className="block text-sm">Tình trạng<select name="status" defaultValue={filters.status ?? ""} className="tf-field mt-2"><option value="">Tất cả tình trạng</option>{STATUS_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          <button type="submit" className="tf-button-secondary">Lọc</button>
        </form>
        {data.rows.length ? <section className="tf-panel overflow-hidden" aria-label="Danh sách khách hàng">
          <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead><tr className="border-b border-zinc-200 text-xs text-zinc-500">{["Khách hàng", "Hạng", "PIC", "Bước tiếp theo", "Lần gần nhất", "Cơ hội mở", "Doanh thu 24 tháng"].map((label, index) => <th key={label} scope="col" className={`px-4 py-3 font-semibold ${index === 6 ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100">{data.rows.map((client) => <tr key={client.id} className="align-top"><td className="px-4 py-4"><Link href={`/crm/clients/${client.id}`} className="font-semibold hover:underline">{client.name}</Link><p className="mt-1 text-xs text-zinc-500">{client.buyingUnitCount} đơn vị mua</p></td><td className="px-4 py-4"><TierBadge tier={client.tier} /></td><td className="px-4 py-4">{client.picAccount?.name ?? <span className="text-zinc-400">Chưa giao</span>}</td><td className="min-w-40 px-4 py-4">{nextStep(client)}</td><td className="px-4 py-4">{client.lastTouchpoint ? <div className="space-y-1"><p>{formatCrmDate(client.lastTouchpoint.occurredAt, now)}</p><OutcomeDots level={client.lastTouchpoint.outcomeLevel} /></div> : "—"}</td><td className="px-4 py-4 tabular-nums">{client.openOpportunityCount}</td><td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">{compactRevenue(client.revenue24m)}</td></tr>)}</tbody>
          </table></div>
          <ul className="divide-y divide-zinc-100 md:hidden">{data.rows.map((client) => <li key={client.id} className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/crm/clients/${client.id}`} className="text-sm font-semibold hover:underline">{client.name}</Link><TierBadge tier={client.tier} /></div><p className="text-xs text-zinc-500">PIC: {client.picAccount?.name ?? "Chưa giao"}</p>{nextStep(client)}</li>)}</ul>
        </section> : <section className="tf-panel space-y-4 p-8 text-center"><p className="text-sm text-zinc-500">{filtered ? "Không có kết quả phù hợp bộ lọc." : "Chưa có khách hàng"}</p>{filtered && <Link href="/crm/clients" className="tf-button-secondary">Xóa bộ lọc</Link>}</section>}
        {data.hasMore && <div className="text-center"><Link href={`/crm/clients?${more}`} className="tf-button-secondary">Tải thêm</Link></div>}
      </div>
    </main>
  </div>;
}
