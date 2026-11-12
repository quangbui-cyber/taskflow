import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import CrmImportReview, { CrmTrackerUpload, type ImportReviewRow } from "@/components/crm/CrmImportReview";
import ClientMergeManager from "@/components/crm/ClientMergeManager";
import { IMPORT_STATUSES } from "@/lib/crm/importLabels";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { trackerRawField } from "@/lib/crm/trackerApply";
import { listDuplicateClientPairs } from "@/lib/crm/clientMerge";

const FLOW = ["Tải file tracker", "Chạy thử và ghép khách", "Duyệt từng dòng", "Áp dụng vào CRM"];

/**
 * crm51 (sketch 006 screen 6): Admin → CRM → Dữ liệu. Tracker import and duplicate merge moved here from the CRM
 * tab bar. Only Admin and data stewards (REVIEW_IMPORT / MERGE_CLIENT) reach it; others get 404 as with the flag off.
 * Not behind requireAdmin so non-admin data stewards keep access; the import and merge services are unchanged.
 */
export default async function CrmDataPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) notFound();
  const actor = await loadCrmActor(user);
  const canImport = crmCan(actor, "REVIEW_IMPORT"), canMerge = crmCan(actor, "MERGE_CLIENT");
  if (!canImport && !canMerge) notFound();
  const params = await searchParams;
  const tab = params.tab === "duplicates" && canMerge || !canImport ? "duplicates" : "import";
  const runId = typeof params.run === "string" && params.run.length <= 64 ? params.run : null;
  const status = typeof params.status === "string" && Object.hasOwn(IMPORT_STATUSES, params.status) ? params.status : undefined;
  const page = typeof params.page === "string" && /^\d{1,5}$/.test(params.page) ? Math.max(1, +params.page) : 1;
  const run = tab === "import" && runId ? await prisma.trackerImportRun.findUnique({ where: { id: runId } }) : null;
  if (tab === "import" && runId && !run) notFound();
  const where = { runId: runId ?? "", ...(status ? { status } : {}) };
  const [runs, rows, count, clients, accounts, programs, reasons, pairs] = await Promise.all([
    tab === "import" && !run ? prisma.trackerImportRun.findMany({ take: 50, orderBy: { createdAt: "desc" } }) : [],
    run ? prisma.trackerImportRow.findMany({ where, take: 50, skip: (page - 1) * 50, orderBy: [{ sheet: "asc" }, { rowNumber: "asc" }] }) : [],
    run ? prisma.trackerImportRow.count({ where }) : 0,
    run ? prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    run ? prisma.account.findMany({ where: { OR: [{ userId: null }, { user: { isActive: true, deletedAt: null } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    run ? prisma.programType.findMany({ where: { active: true }, select: { code: true, label: true }, orderBy: { label: "asc" } }) : [],
    run ? prisma.crmReason.findMany({ where: { active: true }, select: { id: true, label: true, group: true }, orderBy: { label: "asc" } }) : [],
    tab === "duplicates" ? listDuplicateClientPairs(prisma) : [],
  ]);
  const reviewRows = rows.map((row) => {
    const p = row.proposed as Record<string, unknown>;
    return { id: row.id, sheet: row.sheet, rowNumber: row.rowNumber, status: row.status, raw: row.raw, proposed: p, legacyOutcome: p.outcome === "LEGACY_UNCLASSIFIED" || p.legacyOutcome ? trackerRawField(row.raw, "outcome") ?? String(p.legacyOutcome ?? "") : null } as ImportReviewRow;
  });
  const href = (nextPage: number) => `/admin/crm-data?${new URLSearchParams({ run: runId!, ...(status ? { status } : {}), page: String(nextPage) })}`;
  const tabs = [...(canImport ? [{ key: "import", label: "Nhập tracker", href: "/admin/crm-data" }] : []), ...(canMerge ? [{ key: "duplicates", label: "Gộp khách trùng", href: "/admin/crm-data?tab=duplicates" }] : [])];
  const isAdmin = user.role === "ADMIN";
  return <div className="tf-shell"><Sidebar user={user} activeSection={isAdmin ? "admin" : "crm"} />
    <main className="tf-main bg-zinc-50"><div className="tf-page space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><nav aria-label="Vị trí" className="text-sm text-zinc-500">{isAdmin ? <><Link href="/admin?tab=crm" className="hover:underline">Cài đặt · CRM</Link> · </> : null}Dữ liệu</nav><h1 className="tf-page-title">Dữ liệu CRM</h1></div>
        {tab === "import" && <CrmTrackerUpload />}
      </header>
      {tabs.length > 1 && <nav aria-label="Mục dữ liệu" className="tf-scroll-tabs flex gap-1 border-b border-zinc-200">{tabs.map((item) => <Link key={item.key} href={item.href} prefetch={false} aria-current={tab === item.key ? "page" : undefined}
        className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${tab === item.key ? "border-brand-500 text-zinc-950" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}>{item.label}</Link>)}</nav>}
      {tab === "duplicates" ? <ClientMergeManager pairs={pairs} /> : run ? <>
        <div className="space-y-2"><Link href="/admin/crm-data" className="text-sm text-zinc-500 hover:underline">Các lượt nhập</Link><h2 className="break-words text-lg font-semibold">{run.fileName}</h2><p className="text-sm text-zinc-500">{run.actorName} · {run.createdAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · {run.mode === "APPLIED" ? "Đã nhập" : "Chạy thử"}</p></div>
        <CrmImportReview key={run.id} runId={run.id} rows={reviewRows} clients={clients} accounts={accounts} programs={programs} reasons={reasons} currentStatus={status ?? ""} legacyLabel="Chưa rõ kết quả" originalLabel="Giá trị gốc" />
        <nav aria-label="Trang dữ liệu nhập" className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{count} dòng · Trang {page}</span><div className="flex gap-3">{page > 1 && <Link href={href(page - 1)} className="tf-button-secondary">Trang trước</Link>}{page * 50 < count && <Link href={href(page + 1)} className="tf-button-secondary">Trang sau</Link>}</div></nav>
      </> : <>
        <ol aria-label="Các bước nhập tracker" className="grid gap-2 sm:grid-cols-4">{FLOW.map((step, index) => <li key={step} className="rounded-[14px] border border-zinc-200 bg-white px-3 py-2.5 text-[13px]"><span className="mr-1.5 font-semibold tabular-nums">{index + 1}</span>{step}</li>)}</ol>
        <section className="tf-panel overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Các lượt nhập tracker</caption><thead><tr>{["Thời điểm", "Người chạy", "File", "Loại", "Số dòng theo trạng thái"].map((label) => <th key={label} scope="col" className="px-4 py-3 text-xs font-semibold text-zinc-500">{label}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">{runs.map((item) => <tr key={item.id}><td className="whitespace-nowrap px-4 py-4">{item.createdAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</td><td className="px-4 py-4">{item.actorName}</td><td className="px-4 py-4"><Link href={`/admin/crm-data?run=${item.id}`} className="font-medium hover:underline">{item.fileName}</Link></td><td className="px-4 py-4">{item.mode === "APPLIED" ? "Đã nhập" : "Chạy thử"}</td><td className="min-w-52 px-4 py-4">{Object.entries((item.summary ?? {}) as Record<string, number>).map(([key, value]) => `${IMPORT_STATUSES[key] ?? (key === "total" ? "Tổng" : key === "applied" ? "Đã nhập" : key)}: ${value}`).join(" · ")}</td></tr>)}</tbody></table>{!runs.length && <p className="p-8 text-center text-sm text-zinc-500">Chưa có lượt nhập</p>}</section>
      </>}
    </div></main></div>;
}
