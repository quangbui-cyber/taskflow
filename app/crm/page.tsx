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
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { loadWeeklyReview } from "@/lib/crm/reviewData";
import { loadTouchpointDialogOptions, loadOpenOpportunityDialogOptions } from "@/lib/crm/dialogOptions";
import { getCrmSettings } from "@/lib/crm/settings";
import { draftsOpenFrom, rowActionsFor, reviewWeekProgress } from "@/lib/crm/reviewView";
import { crmCan } from "@/lib/crm/policy";

export default async function CrmReviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  if (!(await crmAllowed(user))) notFound();
  const actor = await loadCrmActor(user);
  const now = new Date();
  const [review, dialogOptions, settings, assignmentOptions] = await Promise.all([
    loadWeeklyReview(prisma, actor, { team: params.team, pic: params.pic }, now),
    loadTouchpointDialogOptions(prisma, actor, {}),
    getCrmSettings(prisma),
    loadOpenOpportunityDialogOptions(prisma, actor, {}),
  ]);
  const progress = reviewWeekProgress(review.groups, review.doneThisWeek, now);
  const [weekTitle, ...weekRange] = review.week.label.split(" · ");
  const teamName = review.teams.find(t => t.id === review.filters.teamId)?.name;
  const actionsByKey = Object.fromEntries(
    Object.values(review.groups).flatMap(rows => rows.map(row => [row.key, rowActionsFor(row.group, row)])),
  );
  const emptyState = <section className="tf-panel tf-empty flex-col gap-4 p-8">
    <h2 className="text-base font-semibold text-zinc-900">Tuần này chưa có khách cần review</h2>
    <p>Thêm sự kiện dự kiến hoặc việc tiếp theo trong hồ sơ khách để khách xuất hiện ở đây.</p>
    <Link href="/crm/clients" className="tf-button-secondary">Mở danh sách khách hàng</Link>
  </section>;

  return <div className="tf-shell">
    <Sidebar user={user} activeSection="crm" />
    <main className="tf-main">
      <HubTabs section="crm" role={user.role} />
      <div className="tf-page space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="tf-page-title"><span className="sr-only">Review tuần · </span>{weekTitle}</h1>
            <p className="tf-page-subtitle">{[...weekRange, `${progress.total} việc chăm sóc`, `đã xong ${progress.counts.done}`, teamName].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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
        <ReviewBoard
          key={review.filters.key}
          groups={review.groups}
          drafts={review.drafts}
          doneThisWeek={review.doneThisWeek}
          upcomingEvents={review.upcomingEvents}
          draftsOpen={draftsOpenFrom(params)}
          actionsByKey={actionsByKey}
          dialogOptions={dialogOptions}
          accounts={assignmentOptions.picAccounts}
          now={now}
          cadenceWeeks={settings.cadenceWeeks}
          showPic={review.filters.pic === "all"}
          unratedCount={review.unrated.length}
          dataToolHref={crmCan(actor, "REVIEW_IMPORT") || crmCan(actor, "MERGE_CLIENT") ? "/admin/crm-data" : null}
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
