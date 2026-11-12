import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import NewClientWizard from "@/components/crm/NewClientWizard";
import ClientPortfolioMatrix from "@/components/crm/ClientPortfolioMatrix";
import ClientCards from "@/components/crm/ClientCards";
import CrmViewSwitch from "@/components/crm/CrmViewSwitch";
import TierBadge from "@/components/crm/TierBadge";
import OutcomeDots from "@/components/crm/OutcomeDots";
import TouchpointDialog from "@/components/crm/TouchpointDialog";
import PendingPicConfirmButton from "@/components/crm/PendingPicConfirmButton";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { loadTouchpointDialogOptions } from "@/lib/crm/dialogOptions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmAllowed } from "@/lib/crm/access";
import { canCreateClient } from "@/lib/clientCatalog";
import { loadClientList, loadClientCardExtras, CLIENT_PAGE_SIZE, type ClientCardExtras, type ClientListFilters } from "@/lib/crm/clientData";
import { crmViewCookieName, resolveCrmView } from "@/lib/crm/viewPreference";
import { loadNewClientWizardOptions } from "@/lib/crm/clientService";
import { getCrmSettings, listClientTags } from "@/lib/crm/settings";
import { CLIENT_LIFECYCLE_KEYS, CLIENT_LIFECYCLE_LABELS, type ClientLifecycle } from "@/lib/crm/clientLifecycle";
import { vnDayStart } from "@/lib/crm/dates";
import { TIER_LABELS } from "@/lib/crm/labels";
import type { TierValue } from "@/lib/crm/settingsSchema";
import { formatCrmDate } from "@/lib/crm/dates";
import { ownerHref } from "@/lib/workOwner";

const STATUS_OPTIONS = [{ key: "OVERDUE", label: "Quá hạn" }, { key: "NO_NEXT_STEP", label: "Chưa có việc tiếp theo" }, { key: "ON_TRACK", label: "Đúng hạn" }, { key: "PENDING_PIC_CONFIRM", label: "Chờ PIC xác nhận" }] as const;
const LIFECYCLE_TONE: Record<ClientLifecycle, string> = { PROSPECT: "bg-zinc-100 text-zinc-600", ACTIVE: "bg-brand-50 text-brand-700", DORMANT: "bg-[#fff7e6] text-[#b86a08]", ARCHIVED: "border border-dashed border-zinc-300 text-zinc-500" };
function compactRevenue(amount: number) {
  const number = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
  return amount >= 1e9 ? `${number.format(amount / 1e9)} tỷ` : amount >= 1e6 ? `${number.format(amount / 1e6)} triệu` : `${number.format(amount)} ₫`;
}
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) notFound();
  const actor = await loadCrmActor(user);
  const raw = await searchParams;
  const params = Object.fromEntries(["q", "tier", "pic", "team", "status", "page", "lifecycle", "tag", "view"].map((key) => [key, typeof raw[key] === "string" ? raw[key] : undefined])) as Record<"q" | "tier" | "pic" | "team" | "status" | "page" | "lifecycle" | "tag" | "view", string | undefined>;
  const view = resolveCrmView("clients", params.view, (await cookies()).get(crmViewCookieName("clients"))?.value, user.id);
  const now = new Date();
  const page = /^\d{1,5}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  const filters: ClientListFilters = {
    q: params.q?.trim().slice(0, 200) || undefined,
    tier: params.tier && Object.hasOwn(TIER_LABELS, params.tier) ? params.tier as TierValue : undefined,
    picAccountId: params.pic && params.pic.length <= 64 ? params.pic : undefined,
    teamId: params.team && params.team.length <= 64 ? params.team : undefined,
    status: STATUS_OPTIONS.find((option) => option.key === params.status)?.key,
    lifecycle: CLIENT_LIFECYCLE_KEYS.find((key) => key === params.lifecycle),
    tagId: params.tag && params.tag.length <= 64 ? params.tag : undefined,
    take: page * CLIENT_PAGE_SIZE,
  };
  const [settings, accounts, teams, projects, tags] = await Promise.all([
    getCrmSettings(prisma),
    prisma.account.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.salesTeam.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { members: { some: { userId: user.id } } }, select: { id: true, name: true, color: true, status: true, category: true, responsibleTeam: { select: { id: true, name: true } }, responsibleGroup: { select: { id: true, name: true } }, account: { select: { team: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" } }),
    listClientTags(prisma, { includeHidden: true }),
  ]);
  const data = await loadClientList(prisma, filters, settings, now);
  const [touchpointOptions, extras, wizardOptions] = await Promise.all([
    loadTouchpointDialogOptions(prisma, actor, {}),
    view === "table" ? Promise.resolve(new Map<string, ClientCardExtras>()) : loadClientCardExtras(prisma, data.rows.map((row) => row.id), now),
    canCreateClient(user.role) ? loadNewClientWizardOptions(prisma, actor, settings) : null,
  ]);
  const filtered = !!(filters.q || filters.tier || filters.picAccountId || filters.teamId || filters.status || filters.lifecycle || filters.tagId);
  const today = vnDayStart(now);
  const touchAge = (date: Date) => { const days = Math.round((today.getTime() - vnDayStart(date).getTime()) / 86400000); return days <= 0 ? "Hôm nay" : `${days} ngày trước`; };
  const visibleTags = tags.filter((tag) => tag.active || tag.id === filters.tagId);
  const FILTER_KEYS = ["q", "tier", "pic", "team", "status", "lifecycle", "tag"] as const;
  // Filters stay in the URL across views; the view itself is also remembered per user (cookie).
  const hrefWith = (patch: Partial<Record<typeof FILTER_KEYS[number] | "view" | "page", string | null>>) => {
    const query = new URLSearchParams();
    for (const key of FILTER_KEYS) if (params[key]) query.set(key, params[key]!);
    query.set("view", view);
    for (const [key, value] of Object.entries(patch)) { if (value) query.set(key, value); else query.delete(key); }
    return `/crm/clients?${query}`;
  };
  const viewOptions = [{ key: "map", label: "Bản đồ" }, { key: "cards", label: "Thẻ" }, { key: "table", label: "Bảng" }].map((option) => ({ ...option, href: hrefWith({ view: option.key, page: null }) }));
  type Row = typeof data.rows[number];
  const labels = (client: Row) => <div className="mt-1 flex flex-wrap items-center gap-1.5"><span className={`tf-badge font-normal ${LIFECYCLE_TONE[client.lifecycle]}`}>{CLIENT_LIFECYCLE_LABELS[client.lifecycle]}</span>{client.tags.map((tag) => <span key={tag.id} className="rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600">{tag.label}</span>)}</div>;
  const pendingPic = (client: Row) => client.importStatus === "PENDING_PIC_CONFIRM" && <div className="mt-2 space-y-2"><span className="tf-badge border border-dashed border-zinc-300 text-zinc-500">Chờ PIC xác nhận</span>{crmCan(actor, "CONFIRM_IMPORTED_CLIENT", { kind: "CLIENT", picUserId: client.picAccount?.userId ?? null, teamId: client.responsibleTeamId ?? client.picAccount?.teamId ?? null }) && <div><PendingPicConfirmButton clientId={client.id} /></div>}</div>;
  const nextStep = (client: Row) => client.nextStep ? <div className="space-y-1">
    <Link href={ownerHref({ kind: client.nextStep.opportunityId ? "OPPORTUNITY" : "CLIENT", id: client.nextStep.opportunityId ?? client.id }, client.nextStep.id)} className="text-sm hover:underline">{client.nextStep.title}</Link>
    {client.nextStep.dueDate && <p className={`text-xs ${client.overdue ? "text-[#b86a08]" : "text-zinc-500"}`}>{formatCrmDate(client.nextStep.dueDate, now)}</p>}
  </div> : <span className="text-sm text-zinc-400">Chưa có việc tiếp theo</span>;
  return <div className="tf-shell">
    <Sidebar user={user} projects={projects} activeSection="crmClients" />
    <main className="tf-main"><HubTabs section="crmClients" role={user.role} />
      <div className="tf-page space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="tf-page-title">Khách hàng</h1><p className="tf-page-subtitle">{[`${data.total} khách`, `${data.inCareCount} đang chăm sóc`, data.overdueCount ? `${data.overdueCount} trễ hẹn` : null].filter(Boolean).join(" · ")}</p></div>
          <div className="flex flex-wrap items-center gap-2"><CrmViewSwitch page="clients" label="Chế độ xem khách hàng" current={view} options={viewOptions} /><TouchpointDialog options={touchpointOptions} triggerVariant="secondary" />{wizardOptions && <NewClientWizard options={wizardOptions} />}</div>
        </header>
        <form action="/crm/clients" aria-label="Lọc khách hàng" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="view" value={view} />
          <label className="min-w-0 basis-full sm:basis-64"><span className="sr-only">Tìm khách hàng</span><input name="q" defaultValue={filters.q ?? ""} maxLength={200} placeholder="Tìm tên, tên gọi khác, MST" className="tf-field" /></label>
          <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">Hạng</span><select name="tier" defaultValue={filters.tier ?? ""} className="tf-field"><option value="">Hạng</option>{Object.entries(TIER_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">PIC</span><select name="pic" defaultValue={filters.picAccountId ?? ""} className="tf-field"><option value="">PIC</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">Team</span><select name="team" defaultValue={filters.teamId ?? ""} className="tf-field"><option value="">Team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">Tình trạng</span><select name="status" defaultValue={filters.status ?? ""} className="tf-field"><option value="">Tình trạng</option>{STATUS_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">Vòng đời</span><select name="lifecycle" defaultValue={filters.lifecycle ?? ""} className="tf-field"><option value="">Vòng đời</option>{CLIENT_LIFECYCLE_KEYS.map((key) => <option key={key} value={key}>{CLIENT_LIFECYCLE_LABELS[key]}</option>)}</select></label>
          {visibleTags.length > 0 && <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">Nhãn</span><select name="tag" defaultValue={filters.tagId ?? ""} className="tf-field"><option value="">Nhãn</option>{visibleTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.label}</option>)}</select></label>}
          <button type="submit" className="tf-button-secondary">Lọc</button>
          {filtered && <Link href={`/crm/clients?view=${view}`} className="text-sm text-zinc-500 hover:text-zinc-900">Xóa bộ lọc</Link>}
        </form>
        {view === "map" && <ClientPortfolioMatrix matrix={data.matrix} selected={{ tier: filters.tier ?? null, lifecycle: filters.lifecycle ?? null }} hrefFor={(tier, lifecycle, active) => hrefWith(active ? { tier: null, lifecycle: null, page: null } : { tier, lifecycle, page: null })} />}
        {view !== "table" && (data.rows.length ? <ClientCards rows={data.rows} extras={extras} now={now} /> : <section className="tf-panel space-y-4 p-8 text-center"><p className="text-sm text-zinc-500">{filtered ? "Không có kết quả phù hợp bộ lọc." : "Chưa có khách hàng"}</p>{filtered && <Link href={`/crm/clients?view=${view}`} className="tf-button-secondary">Xóa bộ lọc</Link>}</section>)}
        {view === "table" && <>
        {data.rows.length ? <section className="tf-panel overflow-hidden" aria-label="Danh sách khách hàng">
          <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead><tr className="border-b border-zinc-200 text-xs text-zinc-500">{["Khách hàng", "Hạng", "PIC", "Việc tiếp theo", "Chạm gần nhất", "Cơ hội mở", "Doanh thu 24 tháng"].map((label, index) => <th key={label} scope="col" className={`px-4 py-3 font-semibold ${index === 6 ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100">{data.rows.map((client) => <tr key={client.id} className="align-top"><td className="px-4 py-4"><Link href={`/crm/clients/${client.id}`} className="font-semibold hover:underline">{client.name}</Link>{labels(client)}<p className="mt-1 text-xs text-zinc-500">{client.buyingUnitCount} đơn vị mua</p>{pendingPic(client)}</td><td className="px-4 py-4"><TierBadge tier={client.tier} /></td><td className="px-4 py-4">{client.picAccount?.name ?? <span className="text-zinc-400">Chưa giao</span>}</td><td className="min-w-40 px-4 py-4">{nextStep(client)}</td><td className="px-4 py-4">{client.lastTouchpoint ? <div className="space-y-1"><p>{touchAge(client.lastTouchpoint.occurredAt)}</p><p className="text-xs text-zinc-500">{formatCrmDate(client.lastTouchpoint.occurredAt, now)}</p><OutcomeDots level={client.lastTouchpoint.outcomeLevel} /></div> : <span className="text-zinc-400">Chưa có</span>}</td><td className="px-4 py-4 tabular-nums">{client.openOpportunityCount}</td><td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">{compactRevenue(client.revenue24m)}</td></tr>)}</tbody>
          </table></div>
          <ul className="divide-y divide-zinc-100 md:hidden">{data.rows.map((client) => <li key={client.id} className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/crm/clients/${client.id}`} className="text-sm font-semibold hover:underline">{client.name}</Link><TierBadge tier={client.tier} /></div>{labels(client)}<p className="text-xs text-zinc-500">PIC: {client.picAccount?.name ?? "Chưa giao"} · Chạm gần nhất: {client.lastTouchpoint ? touchAge(client.lastTouchpoint.occurredAt) : "Chưa có"}</p>{nextStep(client)}{pendingPic(client)}</li>)}</ul>
        </section> : <section className="tf-panel space-y-4 p-8 text-center"><p className="text-sm text-zinc-500">{filtered ? "Không có kết quả phù hợp bộ lọc." : "Chưa có khách hàng"}</p>{filtered && <Link href="/crm/clients?view=table" className="tf-button-secondary">Xóa bộ lọc</Link>}</section>}
        </>}
        {data.hasMore && <div className="text-center"><Link href={hrefWith({ page: String(page + 1) })} scroll={false} className="tf-button-secondary">Tải thêm</Link></div>}
      </div>
    </main>
  </div>;
}
