import { after } from "next/server";
import { emailAppUrl, emailSenderAddress, isEmailConfigured, sendEmail } from "./email";
import { buildFinanceApprovalEmail, type FinanceEmailEvent } from "./financeApprovalEmail";
import { canViewFinanceSell } from "./financePolicy";
import { prisma } from "./prisma";

// Gửi email duyệt sau khi thao tác đã lưu xong (không làm chậm nút bấm, lỗi email
// không làm hỏng thao tác chính) — giống email nghỉ phép.

/** Message-ID cho email gửi duyệt, cùng tên miền với hộp thư gửi. */
export function newFinanceMessageId(sheetId: string) {
  const domain = emailSenderAddress()?.split("@")[1] || "mycreative.local";
  return `<ic-${sheetId}-${Date.now().toString(36)}@${domain}>`;
}

export function queueFinanceApprovalEmail(options: {
  event: Omit<FinanceEmailEvent, "sell" | "link"> & {
    sell: NonNullable<FinanceEmailEvent["sell"]>;
  };
  projectId: string;
  toIds: string[];
  ccIds: string[];
  replyToId: string | null;
  messageId?: string;
  inReplyTo?: string | null;
}) {
  if (!isEmailConfigured()) return;
  after(async () => {
    try {
      const ids = [...new Set([...options.toIds, ...options.ccIds, options.replyToId].filter(Boolean))] as string[];
      const people = await prisma.user.findMany({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
        select: { id: true, email: true, role: true },
      });
      const byId = new Map(people.map((person) => [person.id, person]));
      const to = [...new Set(options.toIds.map((id) => byId.get(id)?.email).filter(Boolean))] as string[];
      if (to.length === 0) return;
      const cc = [
        ...new Set(options.ccIds.map((id) => byId.get(id)?.email).filter((email) => email && !to.includes(email))),
      ] as string[];
      // Có người nhận không được xem giá bán thì cả email bỏ giá bán, lợi nhuận, margin.
      const recipients = [...options.toIds, ...options.ccIds]
        .map((id) => byId.get(id))
        .filter((person): person is NonNullable<typeof person> => Boolean(person));
      const everyoneSeesSell = recipients.every((person) => canViewFinanceSell(person.role));
      const appUrl = emailAppUrl();
      const content = buildFinanceApprovalEmail({
        ...options.event,
        sell: everyoneSeesSell ? options.event.sell : null,
        link: appUrl ? `${appUrl}/projects/${options.projectId}?tab=finance` : null,
      });
      const result = await sendEmail({
        to,
        cc,
        replyTo: options.replyToId ? byId.get(options.replyToId)?.email : undefined,
        messageId: options.messageId,
        inReplyTo: options.inReplyTo ?? undefined,
        ...content,
      });
      if (!result.ok) console.warn("Finance approval email could not be delivered.");
    } catch {
      console.warn("Finance approval email could not be delivered.");
    }
  });
}
