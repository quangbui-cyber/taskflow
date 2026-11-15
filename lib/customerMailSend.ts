import { prisma } from "@/lib/prisma";
import { deliverEmail, type DeliveryResult, type EmailMessage, type SenderOptions } from "@/lib/email";
import {
  MAX_SEND_ATTEMPTS,
  SEND_BATCH_SIZE,
  SEND_GAP_MS,
  STUCK_SENDING_MS,
  isSalutation,
  isValidEmail,
} from "@/lib/customerMail";
import { buildCustomerEmail } from "@/lib/customerMailEmail";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const STUCK_ERROR = "Lượt gửi bị ngắt giữa chừng, chưa rõ thư đã đi hay chưa. Kiểm tra rồi gửi lại nếu cần.";

type Deliver = (message: EmailMessage, sender: SenderOptions) => Promise<DeliveryResult>;

/** Dòng kẹt ở "sending" quá lâu thì đánh lỗi chứ không tự gửi lại, để không ai nhận hai thư. */
export async function releaseStuckRecipients(now = new Date()) {
  return prisma.mailRecipient.updateMany({
    where: { status: "sending", claimedAt: { lt: new Date(now.getTime() - STUCK_SENDING_MS) } },
    data: { status: "failed", error: STUCK_ERROR },
  });
}

/** Chiến dịch đã hẹn đến giờ thì chuyển sang "đang gửi". */
export async function startDueCampaigns(now = new Date()) {
  return prisma.mailCampaign.updateMany({
    where: { status: "scheduled", sendAt: { lte: now } },
    data: { status: "sending", startedAt: now },
  });
}

/** Hết thư chờ thì đóng chiến dịch. */
export async function finishIfComplete(campaignId: string, now = new Date()) {
  const open = await prisma.mailRecipient.count({
    where: { campaignId, status: { in: ["pending", "sending"] } },
  });
  if (open > 0) return false;
  const updated = await prisma.mailCampaign.updateMany({
    where: { id: campaignId, status: "sending" },
    data: { status: "done", finishedAt: now },
  });
  if (updated.count) {
    const [sent, failed] = await Promise.all([
      prisma.mailRecipient.count({ where: { campaignId, status: "sent" } }),
      prisma.mailRecipient.count({ where: { campaignId, status: "failed" } }),
    ]);
    await prisma.mailCampaignEvent.create({
      data: { campaignId, action: "finished", detail: `Đã gửi ${sent} thư${failed ? `, ${failed} thư lỗi` : ""}.` },
    });
  }
  return true;
}

/**
 * Gửi tối đa `limit` thư của một chiến dịch đang gửi. Mỗi dòng được khoá
 * (pending → sending) trước khi gửi; chỉ lượt khoá được mới gửi, nên cron và lượt
 * "Gửi ngay" chạy cùng lúc cũng không gửi trùng.
 */
export async function sendCampaignBatch(
  campaignId: string,
  { limit = SEND_BATCH_SIZE, gapMs = SEND_GAP_MS, deadline = Number.POSITIVE_INFINITY, deliver = deliverEmail as Deliver } = {}
): Promise<{ sent: number; failed: number; attempted: number }> {
  const campaign = await prisma.mailCampaign.findUnique({
    where: { id: campaignId },
    include: { sender: true },
  });
  const outcome = { sent: 0, failed: 0, attempted: 0 };
  if (!campaign || campaign.status !== "sending") return outcome;
  const sender: SenderOptions = {
    fromName: campaign.sender.name,
    replyTo: campaign.sender.replyTo,
    smtpRef: campaign.sender.smtpRef,
  };

  while (outcome.attempted < limit && Date.now() < deadline) {
    const next = await prisma.mailRecipient.findFirst({
      where: { campaignId, status: "pending" },
      orderBy: [{ attempts: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (!next) break;
    const claimed = await prisma.mailRecipient.updateMany({
      where: { id: next.id, status: "pending" },
      data: { status: "sending", claimedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // lượt khác vừa khoá dòng này
    const recipient = await prisma.mailRecipient.findUniqueOrThrow({ where: { id: next.id } });
    outcome.attempted += 1;

    if (!isValidEmail(recipient.email) || !isSalutation(recipient.salutation)) {
      await prisma.mailRecipient.update({
        where: { id: recipient.id },
        data: { status: "failed", error: "Thiếu email hợp lệ hoặc xưng hô." },
      });
      outcome.failed += 1;
      continue;
    }

    let result: DeliveryResult;
    try {
      result = await deliver(buildCustomerEmail(campaign, recipient), sender);
    } catch {
      result = { ok: false, transient: true, error: "Không dựng được thư." };
    }
    if (result.ok) {
      await prisma.mailRecipient.update({
        where: { id: recipient.id },
        data: { status: "sent", sentAt: new Date(), error: null },
      });
      outcome.sent += 1;
    } else {
      const retry = result.transient && recipient.attempts < MAX_SEND_ATTEMPTS;
      await prisma.mailRecipient.update({
        where: { id: recipient.id },
        data: { status: retry ? "pending" : "failed", error: result.error },
      });
      if (!retry) outcome.failed += 1;
      // Lỗi tạm thời: để lượt cron sau thử lại, không dồn dập ngay.
      if (retry) break;
    }
    if (outcome.attempted < limit) await wait(gapMs);
  }

  await finishIfComplete(campaignId);
  return outcome;
}

/** Lượt cron mỗi phút: mở chiến dịch đến giờ, gửi tiếp một phần, đóng chiến dịch đã xong. */
export async function processCustomerMail({ budget = SEND_BATCH_SIZE, timeLimitMs = 45_000 } = {}) {
  const now = new Date();
  const deadline = Date.now() + timeLimitMs;
  await releaseStuckRecipients(now);
  await startDueCampaigns(now);
  const campaigns = await prisma.mailCampaign.findMany({
    where: { status: "sending" },
    orderBy: { startedAt: "asc" },
    select: { id: true },
  });
  let remaining = budget;
  let sent = 0;
  let failed = 0;
  for (const campaign of campaigns) {
    if (remaining <= 0 || Date.now() >= deadline) {
      await finishIfComplete(campaign.id);
      continue;
    }
    const result = await sendCampaignBatch(campaign.id, { limit: remaining, deadline });
    remaining -= result.attempted;
    sent += result.sent;
    failed += result.failed;
  }
  return { campaigns: campaigns.length, sent, failed };
}
