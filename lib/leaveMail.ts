import { after } from "next/server";
import { emailAppUrl, isEmailConfigured, sendEmail } from "@/lib/email";
import { buildLeaveEmail, type LeaveEmailEvent } from "@/lib/leaveEmail";
import { prisma } from "@/lib/prisma";

export function queueLeaveEmail(
  event: LeaveEmailEvent,
  userIds: (string | null | undefined)[]
) {
  if (!isEmailConfigured()) return;
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;

  // Giữ thông tin của thao tác đã lưu, không đọc lại trạng thái có thể đã đổi.
  after(async () => {
    try {
      const recipients = await prisma.user.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { email: true },
      });
      const emails = [...new Set(recipients.map((person) => person.email))];
      const results = await Promise.all(emails.map((email) =>
        sendEmail(buildLeaveEmail(event, email, emailAppUrl()))
      ));
      if (results.some((result) => !result.ok)) {
        console.warn("Leave email delivery could not be completed.");
      }
    } catch {
      console.warn("Leave email delivery could not be completed.");
    }
  });
}
