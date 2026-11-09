import Link from "next/link";
import { notFound } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import TouchpointDialog from "@/components/crm/TouchpointDialog";
import ReviewFilters from "@/components/crm/ReviewFilters";
import ReviewBoard from "@/components/crm/ReviewBoard";
import ReviewUnratedSection from "@/components/crm/ReviewUnratedSection";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crmEnabled } from "@/lib/features";
import { loadCrmActor } from "@/lib/crm/actor";
import { loadWeeklyReview } from "@/lib/crm/reviewData";
import { loadTouchpointDialogOptions, loadOpenOpportunityDialogOptions } from "@/lib/crm/dialogOptions";
import { getCrmSettings } from "@/lib/crm/settings";
import { draftsOpenFrom, rowActionsFor, reviewTiles } from "@/lib/crm/reviewView";

export default async function CrmReviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  if (!crmEnabled()) notFound();
  const actor = await loadCrmActor(user);
  const now = new Date();
  const [review, dialogOptions, settings, assignmentOptions] = await Promise.all([
    loadWeeklyReview(prisma, actor, { team: params.team, pic: params.pic }, now),
    loadTouchpointDialogOptions(prisma, actor, {}),
    getCrmSettings(prisma),
    loadOpenOpportunityDialogOptions(prisma, actor, {}),
  ]);
  const tiles = reviewTiles(review.metrics);
  const actionsByKey = Object.fromEntries(
    Object.values(review.groups).flatMap(rows => rows.map(row => [row.key, rowActionsFor(row.group, row)])),
  );
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else value?.forEach(item => query.append(key, item));
  }
  query.set("drafts", "open");
  const draftHref = `/crm?${query}#crm-drafts`; // drafts=open preserves the current filters.
  const emptyState = <section className="tf-panel tf-empty flex-col gap-4 p-8">
    <h2 className="text-base font-semibold text-zinc-900">Tuần này chưa có khách cần review</h2>
    <p>Thêm sự kiện dự kiến hoặc bước tiếp theo trong hồ sơ khách để khách xuất hiện ở đây.</p>
    <Link href="/crm/clients" className="tf-button-secondary">Mở danh sách khách hàng</Link>
  </section>;

  return <div className="tf-shell">
    <Sidebar user={user} activeSection="crm" />
    <main className="tf-main">
      <HubTabs section="crm" role={user.role} />
      <div className="tf-page space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="tf-page-title">Review tuần</h1>
            <p className="tf-page-subtitle">{review.week.label}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-end gap-4">
            <ReviewFilters
              teams={review.teams}
              pics={review.pics}
              filters={review.filters}
              canUseMine={actor.accountId != null}
            />
            <TouchpointDialog
              options={dialogOptions}
              triggerVariant="primary"
              triggerLabel="Ghi điểm chạm"
            />
          </div>
        </header>
        <div className="tf-metric-strip">
          {tiles.map(tile => <a
            key={tile.anchor}
            className="tf-metric-item hover:bg-zinc-50"
            href={tile.anchor === "crm-drafts" ? draftHref : `#${tile.anchor}`}
          >
            <p className="text-xs font-semibold text-zinc-500">{tile.label}</p>
            <p className={`mt-2 text-xl font-semibold tabular-nums ${tile.warning ? "text-[#b86a08]" : "text-zinc-950"}`}>{tile.count}</p>
          </a>)}
        </div>
        <ReviewBoard
          key={review.filters.key}
          groups={review.groups}
          drafts={review.drafts}
          tiles={tiles}
          draftsOpen={draftsOpenFrom(params)}
          actionsByKey={actionsByKey}
          dialogOptions={dialogOptions}
          accounts={assignmentOptions.picAccounts}
          now={now}
          emptyState={emptyState}
          unrated={<ReviewUnratedSection
            key={review.filters.key}
            rows={review.unrated}
            potentialScale={settings.potentialScale}
            potentialScaleConfigured={review.potentialScaleConfigured}
            isAdmin={actor.role === "ADMIN"}
          />}
        />
      </div>
    </main>
  </div>;
}
