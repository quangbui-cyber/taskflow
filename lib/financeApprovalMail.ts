import { after } from "next/server";
import { emailAppUrl, emailSenderAddress, isEmailConfigured, sendEmail } from "./email";
import { sendViaGmail } from "./googleGmail";
import { canSendGmail, googleWorkspaceConfigured, GoogleNotConnectedError } from "./googleWorkspace";
import { buildFinanceApprovalEmail, type FinanceEmailEvent } from "./financeApprovalEmail";
import { canViewFinanceSell } from "./financePolicy";
import { prisma } from "./prisma";

// Gửi email duyệt sau khi thao tác đã lưu xong (không làm chậm nút bấm, lỗi email
// không làm hỏng thao tác chính) — giống email nghỉ phép.
// Người bấm đã kết nối Gmail thì thư đi từ hộp thư của họ; chưa kết nối hoặc gửi lỗi
// thì gửi bằng hộp thư chung của app, Reply-To về người bấm.

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
  /** Người bấm gửi / duyệt / từ chối / rút lại. */
  senderId: string;
  messageId?: string;
  inReplyTo?: string | null;
}) {
  if (!isEmailConfigured() && !googleWorkspaceConfigured()) return;
  after(async () => {
    try {
      const ids = [...new Set([...options.toIds, ...options.ccIds, options.senderId])];
      const people = await prisma.user.findMany({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
        select: { id: true, name: true, email: true, role: true, googleToken: true, googleScopes: true },
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
      const sender = byId.get(options.senderId);
      const message = {
        to,
        cc,
        messageId: options.messageId,
        inReplyTo: options.inReplyTo ?? undefined,
        ...content,
      };

      if (sender?.googleToken && canSendGmail(sender.googleScopes) && googleWorkspaceConfigured()) {
        try {
          // Thư từ hộp thư của chính mình: không cần CC lại bản thân hay Reply-To.
          await sendViaGmail(sender.id, {
            ...message,
            fromName: sender.name,
            cc: cc.filter((email) => email !== sender.email),
          });
          return;
        } catch (error) {
          if (!(error instanceof GoogleNotConnectedError)) {
            console.warn("Gmail send failed, falling back to the shared mailbox.");
          }
        }
      }
      if (!isEmailConfigured()) return;
      const result = await sendEmail({ ...message, replyTo: sender?.email });
      if (!result.ok) console.warn("Finance approval email could not be delivered.");
    } catch {
      console.warn("Finance approval email could not be delivered.");
    }
  });
}
