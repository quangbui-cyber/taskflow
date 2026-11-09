import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import CrmImportReview, { CrmTrackerUpload, type ImportReviewRow } from "@/components/crm/CrmImportReview";
import { IMPORT_STATUSES } from "@/lib/crm/importLabels";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled } from "@/lib/features";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";
import { trackerRawField } from "@/lib/crm/trackerApply";

export default async function CrmImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!crmEnabled()) notFound();
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "REVIEW_IMPORT")) redirect("/crm");
  const params = await searchParams;
  const runId = typeof params.run === "string" && params.run.length <= 64 ? params.run : null;
  const status = typeof params.status === "string" && Object.hasOwn(IMPORT_STATUSES, params.status) ? params.status : undefined;
  const page = typeof params.page === "string" && /^\d{1,5}$/.test(params.page) ? Math.max(1, +params.page) : 1;
  const run = runId ? await prisma.trackerImportRun.findUnique({ where: { id: runId } }) : null;
  if (runId && !run) notFound();
  const where = { runId: runId ?? "", ...(status ? { status } : {}) };
  const [runs, rows, count, clients, accounts, programs, reasons] = await Promise.all([
    prisma.trackerImportRun.findMany({ take: 50, orderBy: { createdAt: "desc" } }),
    run ? prisma.trackerImportRow.findMany({ where, take: 50, skip: (page - 1) * 50, orderBy: [{ sheet: "asc" }, { rowNumber: "asc" }] }) : [],
    run ? prisma.trackerImportRow.count({ where }) : 0,
    run ? prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    run ? prisma.account.findMany({ where: { OR: [{ userId: null }, { user: { isActive: true, deletedAt: null } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    run ? prisma.programType.findMany({ where: { active: true }, select: { code: true, label: true }, orderBy: { label: "asc" } }) : [],
    run ? prisma.crmReason.findMany({ where: { active: true }, select: { id: true, label: true, group: true }, orderBy: { label: "asc" } }) : [],
  ]);
  const reviewRows = rows.map((row) => {
    const p = row.proposed as Record<string, unknown>;
    return { id: row.id, sheet: row.sheet, rowNumber: row.rowNumber, status: row.status, raw: row.raw, proposed: p, legacyOutcome: p.outcome === "LEGACY_UNCLASSIFIED" || p.legacyOutcome ? trackerRawField(row.raw, "outcome") ?? String(p.legacyOutcome ?? "") : null } as ImportReviewRow;
  });
  const href = (nextPage: number) => `/crm/import?${new URLSearchParams({ run: runId!, ...(status ? { status } : {}), page: String(nextPage) })}`;
  return <div className="tf-shell"><Sidebar user={user} activeSection="crmImport" /><main className="tf-main bg-zinc-50"><HubTabs section="crmImport" role={user.role} />
    <div className="tf-page space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><h1 className="tf-page-title">Nhập dữ liệu tracker</h1><CrmTrackerUpload /></header>
      {run ? <>
        <div className="space-y-2"><Link href="/crm/import" className="text-sm text-zinc-500 hover:underline">Các lượt nhập</Link><h2 className="break-words text-lg font-semibold">{run.fileName}</h2><p className="text-sm text-zinc-500">{run.actorName} · {run.createdAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · {run.mode === "APPLIED" ? "Đã nhập" : "Chạy thử"}</p></div>
        <CrmImportReview key={run.id} runId={run.id} rows={reviewRows} clients={clients} accounts={accounts} programs={programs} reasons={reasons} currentStatus={status ?? ""} legacyLabel="Chưa rõ kết quả" originalLabel="Giá trị gốc" />
        <nav aria-label="Trang dữ liệu nhập" className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{count} dòng · Trang {page}</span><div className="flex gap-3">{page > 1 && <Link href={href(page - 1)} className="tf-button-secondary">Trang trước</Link>}{page * 50 < count && <Link href={href(page + 1)} className="tf-button-secondary">Trang sau</Link>}</div></nav>
      </> : <section className="tf-panel overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Các lượt nhập tracker</caption><thead><tr>{["Thời điểm", "Người chạy", "File", "Loại", "Số dòng theo trạng thái"].map((label) => <th key={label} scope="col" className="px-4 py-3 text-xs font-semibold text-zinc-500">{label}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">{runs.map((item) => <tr key={item.id}><td className="whitespace-nowrap px-4 py-4">{item.createdAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</td><td className="px-4 py-4">{item.actorName}</td><td className="px-4 py-4"><Link href={`/crm/import?run=${item.id}`} className="font-medium hover:underline">{item.fileName}</Link></td><td className="px-4 py-4">{item.mode === "APPLIED" ? "Đã nhập" : "Chạy thử"}</td><td className="min-w-52 px-4 py-4">{Object.entries((item.summary ?? {}) as Record<string, number>).map(([key, value]) => `${IMPORT_STATUSES[key] ?? (key === "total" ? "Tổng" : key === "applied" ? "Đã nhập" : key)}: ${value}`).join(" · ")}</td></tr>)}</tbody></table>{!runs.length && <p className="p-8 text-center text-sm text-zinc-500">Chưa có lượt nhập</p>}</section>}
    </div></main></div>;
}
