import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSenderConfigured, senderAddress } from "@/lib/email";
import {
  CAMPAIGN_STATUS_LABELS,
  campaignReadiness,
  fillTemplate,
  formatVietnamDateTime,
  recipientVariables,
  type CampaignStatus,
} from "@/lib/customerMail";
import { isMailImportAiConfigured } from "@/lib/customerMailImport";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import MailComposer from "@/components/mail/MailComposer";
import RecipientWorkspace from "@/components/mail/RecipientWorkspace";
import SendPanel from "@/components/mail/SendPanel";
import DeleteCampaignButton from "@/components/mail/DeleteCampaignButton";

export const maxDuration = 60;

const TABS = [
  { key: "soan", label: "Soạn thư" },
  { key: "danh-sach", label: "Danh sách" },
  { key: "gui", label: "Gửi" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function MailCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const campaign = await prisma.mailCampaign.findUnique({
    where: { id },
    include: {
      sender: true,
      recipients: { orderBy: { createdAt: "asc" } },
      events: {
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { user: { select: { name: true } } },
      },
    },
  });
  if (!campaign) notFound();
  const senders = await prisma.mailSender.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });

  const status = campaign.status as CampaignStatus;
  const defaultTab: Tab = status === "draft" ? (campaign.recipients.length ? "gui" : "soan") : "gui";
  const tab: Tab = TABS.some((item) => item.key === query.tab) ? (query.tab as Tab) : defaultTab;
  const readiness = campaignReadiness(campaign.recipients);
  const editable = status === "draft";

  const recipients = campaign.recipients.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    callName: row.callName,
    salutation: row.salutation,
    group: row.group,
    note: row.note,
    source: row.source,
    confidence: row.confidence,
    reviewed: row.reviewed,
    status: row.status,
    error: row.error,
    sentAt: row.sentAt?.toISOString() ?? null,
  }));

  return (
    <div className="tf-shell">
      <Sidebar user={user} activeSection="mail" />
      <main className="tf-main bg-zinc-50">
        <HubTabs section="mail" role={user.role} isHrManager={user.isHrManager} />
        <div className="tf-page space-y-6">
          <div className="space-y-3">
            <Link href="/mail" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900">
              <ArrowLeft size={15} aria-hidden="true" />
              Thư khách
            </Link>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="tf-page-title break-words">{campaign.name}</h1>
                <p className="tf-page-subtitle">
                  {campaign.sender.name} · {CAMPAIGN_STATUS_LABELS[status]}
                  {status === "scheduled" && campaign.sendAt && ` lúc ${formatVietnamDateTime(campaign.sendAt)}`}
                </p>
              </div>
              {(status === "draft" || status === "done") && <DeleteCampaignButton campaignId={campaign.id} />}
            </div>
          </div>

          <nav className="flex gap-1 rounded-[12px] bg-zinc-100 p-1 sm:w-fit" aria-label="Các bước">
            {TABS.map((item, index) => {
              const active = item.key === tab;
              const badge =
                item.key === "danh-sach"
                  ? readiness.blocked
                    ? <span className="ml-1.5 rounded-full bg-red-100 px-1.5 text-xs text-red-700">{readiness.blocked}</span>
                    : <span className="ml-1.5 text-xs text-zinc-400">{readiness.total}</span>
                  : null;
              return (
                <Link
                  key={item.key}
                  href={`/mail/${campaign.id}?tab=${item.key}`}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-1 items-center justify-center whitespace-nowrap rounded-[9px] px-4 py-2 text-sm transition-colors duration-150 sm:flex-none ${
                    active ? "bg-white font-semibold text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  <span className="mr-1.5 text-zinc-400">{index + 1}</span>
                  {item.label}
                  {badge}
                </Link>
              );
            })}
          </nav>

          {tab === "soan" && (
            <MailComposer
              campaignId={campaign.id}
              editable={editable}
              senders={senders}
              initial={{
                senderId: campaign.senderId,
                subject: campaign.subject,
                title: campaign.title,
                greeting: campaign.greeting,
                body: campaign.body,
                signOff: campaign.signOff,
                signature: campaign.signature,
              }}
              recipients={recipients.slice(0, 300).map((row) => ({ id: row.id, fullName: row.fullName, salutation: row.salutation }))}
            />
          )}
          {tab === "danh-sach" && (
            <RecipientWorkspace
              campaignId={campaign.id}
              editable={editable}
              aiReady={isMailImportAiConfigured()}
              recipients={recipients}
            />
          )}
          {tab === "gui" && (
            <SendPanel
              campaignId={campaign.id}
              status={status}
              sendAt={campaign.sendAt?.toISOString() ?? null}
              readiness={readiness}
              sender={{
                name: campaign.sender.name,
                replyTo: campaign.sender.replyTo,
                address: senderAddress(campaign.sender.smtpRef),
                configured: isSenderConfigured(campaign.sender.smtpRef),
              }}
              subject={
                campaign.recipients[0]
                  ? fillTemplate(campaign.subject, recipientVariables(campaign.recipients[0]))
                  : campaign.subject
              }
              testerEmail={user.email}
              testSent={campaign.events.some((event) => event.action === "test")}
              recipients={recipients}
              events={campaign.events.map((event) => ({
                id: event.id,
                action: event.action,
                detail: event.detail,
                user: event.user?.name ?? null,
                at: formatVietnamDateTime(event.createdAt),
              }))}
            />
          )}
        </div>
      </main>
    </div>
  );
}
