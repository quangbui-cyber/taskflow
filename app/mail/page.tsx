import Link from "next/link";
import { Mail } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSenderConfigured } from "@/lib/email";
import {
  CAMPAIGN_STATUS_LABELS,
  formatVietnamDateTime,
  type CampaignStatus,
} from "@/lib/customerMail";
import Sidebar from "@/components/Sidebar";
import HubTabs from "@/components/HubTabs";
import { NewCampaignButton, SenderManager } from "@/components/mail/MailCampaignList";

export const metadata = { title: "Thư khách" };

const STATUS_TONE: Record<CampaignStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  scheduled: "bg-amber-50 text-amber-700",
  sending: "bg-brand-100 text-brand-800",
  done: "bg-brand-50 text-brand-700",
};

export default async function MailPage() {
  const user = await requireAdmin();
  const [campaigns, counts, senders, templates] = await Promise.all([
    prisma.mailCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, name: true, status: true, sendAt: true, finishedAt: true, createdAt: true,
        sender: { select: { name: true } },
      },
    }),
    prisma.mailRecipient.groupBy({ by: ["campaignId", "status"], _count: { _all: true } }),
    prisma.mailSender.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.mailTemplate.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, senderId: true } }),
  ]);

  const tally = new Map<string, { total: number; sent: number; failed: number }>();
  for (const row of counts) {
    const entry = tally.get(row.campaignId) ?? { total: 0, sent: 0, failed: 0 };
    entry.total += row._count._all;
    if (row.status === "sent") entry.sent += row._count._all;
    if (row.status === "failed") entry.failed += row._count._all;
    tally.set(row.campaignId, entry);
  }

  return (
    <div className="tf-shell">
      <Sidebar user={user} activeSection="mail" />
      <main className="tf-main bg-zinc-50">
        <HubTabs section="mail" role={user.role} isHrManager={user.isHrManager} />
        <div className="tf-page space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700">
                <Mail size={20} aria-hidden="true" />
              </span>
              <h1 className="tf-page-title">Thư khách</h1>
            </div>
            <NewCampaignButton
              senders={senders.map((sender) => ({ id: sender.id, name: sender.name }))}
              templates={templates}
            />
          </div>

          {campaigns.length === 0 ? (
            <div className="tf-empty rounded-[16px] border border-dashed border-zinc-200 bg-white">
              Chưa có chiến dịch nào
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-[16px] border border-zinc-200/80 bg-white shadow-sm">
              {campaigns.map((campaign) => {
                const count = tally.get(campaign.id) ?? { total: 0, sent: 0, failed: 0 };
                const status = campaign.status as CampaignStatus;
                const when =
                  status === "scheduled" && campaign.sendAt
                    ? `Gửi lúc ${formatVietnamDateTime(campaign.sendAt)}`
                    : status === "done" && campaign.finishedAt
                      ? `Xong lúc ${formatVietnamDateTime(campaign.finishedAt)}`
                      : `Tạo lúc ${formatVietnamDateTime(campaign.createdAt)}`;
                return (
                  <li key={campaign.id}>
                    <Link
                      href={`/mail/${campaign.id}`}
                      className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 transition-colors duration-150 hover:bg-zinc-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-zinc-900">{campaign.name}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {campaign.sender.name} · {when}
                        </p>
                      </div>
                      <p className="text-sm tabular-nums text-zinc-600">
                        {status === "draft" || status === "scheduled"
                          ? `${count.total} người`
                          : `${count.sent}/${count.total} đã gửi`}
                        {count.failed > 0 && <span className="ml-2 text-red-600">{count.failed} lỗi</span>}
                      </p>
                      <span className={`tf-badge ${STATUS_TONE[status] ?? STATUS_TONE.draft}`}>
                        {CAMPAIGN_STATUS_LABELS[status] ?? campaign.status}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <SenderManager
            senders={senders.map((sender) => ({
              id: sender.id,
              name: sender.name,
              replyTo: sender.replyTo,
              smtpRef: sender.smtpRef,
              configured: isSenderConfigured(sender.smtpRef),
            }))}
          />
        </div>
      </main>
    </div>
  );
}
