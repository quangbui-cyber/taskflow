"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  campaignReadiness,
  defaultCallName,
  isSalutation,
  normalizeEmail,
  parseVietnamDateTime,
  formatVietnamDateTime,
  unknownVariables,
  type Salutation,
} from "@/lib/customerMail";
import { buildCustomerEmail, previewHtml, type MailContent } from "@/lib/customerMailEmail";
import { deliverEmail, isSenderConfigured, normalizeSmtpRef } from "@/lib/email";
import { sendCampaignBatch } from "@/lib/customerMailSend";

export type MailActionState = { error?: string; success?: string };

const oneLine = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
const multiLine = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";

/** Chỉ quản trị viên được tạo chiến dịch, sửa danh sách và bấm gửi. */
async function requireMailAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return null;
  return user;
}
const NO_ACCESS = { error: "Chỉ quản trị viên mới gửi thư cho khách." };

async function logEvent(campaignId: string, userId: string | null, action: string, detail?: string) {
  await prisma.mailCampaignEvent.create({ data: { campaignId, userId, action, detail } });
}

function refresh(campaignId?: string) {
  revalidatePath("/mail");
  if (campaignId) revalidatePath(`/mail/${campaignId}`);
}

async function editableCampaign(campaignId: string) {
  const campaign = await prisma.mailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { error: "Không tìm thấy chiến dịch." } as const;
  if (campaign.status !== "draft") {
    return { error: "Chiến dịch đã hẹn giờ hoặc đang gửi. Huỷ hẹn giờ trước khi sửa." } as const;
  }
  return { campaign } as const;
}

function readContent(input: Partial<Record<keyof MailContent, unknown>>): MailContent | { error: string } {
  const content: MailContent = {
    subject: oneLine(input.subject, 200),
    title: oneLine(input.title, 60),
    greeting: oneLine(input.greeting, 120),
    body: multiLine(input.body, 8000),
    signOff: oneLine(input.signOff, 60),
    signature: oneLine(input.signature, 60),
  };
  if (!content.subject) return { error: "Thư cần có tiêu đề." };
  if (!content.body) return { error: "Thư cần có nội dung." };
  const unknown = unknownVariables(Object.values(content).join("\n"));
  if (unknown.length) return { error: `Biến không đúng: ${unknown.join(", ")}.` };
  return content;
}

// ---------- Thương hiệu gửi ----------

export async function saveSender(_previous: MailActionState, formData: FormData): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const id = oneLine(formData.get("id"), 40);
  const name = oneLine(formData.get("name"), 120);
  const replyTo = normalizeEmail(formData.get("replyTo"));
  const smtpRef = normalizeSmtpRef(formData.get("smtpRef"));
  if (!name) return { error: "Nhập tên người gửi." };
  if (replyTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo)) return { error: "Email nhận hồi âm chưa đúng." };
  const data = { name, replyTo, smtpRef };
  if (id) await prisma.mailSender.update({ where: { id }, data });
  else await prisma.mailSender.create({ data });
  refresh();
  return {
    success: isSenderConfigured(smtpRef) ? "Đã lưu thương hiệu gửi." : `Đã lưu. Còn thiếu SMTP_${smtpRef}_USER / SMTP_${smtpRef}_APP_PASSWORD trên máy chủ.`,
  };
}

// ---------- Chiến dịch ----------

export async function createCampaign(_previous: MailActionState, formData: FormData): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const name = oneLine(formData.get("name"), 160);
  const senderId = oneLine(formData.get("senderId"), 40);
  const templateId = oneLine(formData.get("templateId"), 40);
  if (!name) return { error: "Đặt tên chiến dịch." };
  const sender = await prisma.mailSender.findUnique({ where: { id: senderId } });
  if (!sender) return { error: "Chọn thương hiệu gửi." };
  const template = templateId ? await prisma.mailTemplate.findUnique({ where: { id: templateId } }) : null;
  const campaign = await prisma.mailCampaign.create({
    data: {
      name,
      senderId: sender.id,
      templateId: template?.id ?? null,
      subject: template?.subject ?? `Thư từ ${sender.name}`,
      title: template?.title ?? "Lời cảm ơn",
      greeting: template?.greeting ?? "{{Xung_ho}} {{ten_goi}} thân mến,",
      body: template?.body ?? "",
      signOff: template?.signOff ?? "Thân mến,",
      signature: template?.signature ?? sender.name.split(/[–-]/)[0].trim(),
      createdById: user.id,
    },
  });
  await logEvent(campaign.id, user.id, "created", template ? `Từ mẫu “${template.name}”` : undefined);
  refresh();
  redirect(`/mail/${campaign.id}`);
}

export async function deleteCampaign(campaignId: string): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const campaign = await prisma.mailCampaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  if (!campaign) return { error: "Không tìm thấy chiến dịch." };
  if (campaign.status === "sending" || campaign.status === "scheduled") {
    return { error: "Chiến dịch đang hẹn giờ hoặc đang gửi." };
  }
  await prisma.mailCampaign.delete({ where: { id: campaignId } });
  refresh();
  redirect("/mail");
}

export async function saveCampaignContent(
  campaignId: string,
  input: Partial<Record<keyof MailContent | "senderId", unknown>>
): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const found = await editableCampaign(campaignId);
  if ("error" in found) return found;
  const content = readContent(input);
  if ("error" in content) return content;
  const senderId = oneLine(input.senderId, 40);
  const sender = senderId ? await prisma.mailSender.findUnique({ where: { id: senderId }, select: { id: true } }) : null;
  await prisma.mailCampaign.update({
    where: { id: campaignId },
    data: { ...content, ...(sender ? { senderId: sender.id } : {}) },
  });
  refresh(campaignId);
  return { success: "Đã lưu thư." };
}

export async function saveAsTemplate(campaignId: string, name: string): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const campaign = await prisma.mailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { error: "Không tìm thấy chiến dịch." };
  const templateName = oneLine(name, 120) || campaign.name;
  await prisma.mailTemplate.create({
    data: {
      name: templateName,
      senderId: campaign.senderId,
      subject: campaign.subject,
      title: campaign.title,
      greeting: campaign.greeting,
      body: campaign.body,
      signOff: campaign.signOff,
      signature: campaign.signature,
    },
  });
  refresh(campaignId);
  return { success: `Đã lưu mẫu “${templateName}”.` };
}

/** Bản xem trước đúng thư một người sẽ nhận (dùng nội dung đang soạn nếu có). */
export async function previewCampaignEmail(
  campaignId: string,
  recipientId: string | null,
  draft?: Partial<Record<keyof MailContent, unknown>>
): Promise<{ html?: string; subject?: string; to?: string; error?: string }> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const campaign = await prisma.mailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { error: "Không tìm thấy chiến dịch." };
  const content = draft ? readContent(draft) : campaign;
  if ("error" in content) return { error: content.error };
  const recipient = recipientId
    ? await prisma.mailRecipient.findFirst({ where: { id: recipientId, campaignId } })
    : await prisma.mailRecipient.findFirst({ where: { campaignId }, orderBy: { createdAt: "asc" } });
  const sample = recipient ?? { fullName: "Vũ Nguyễn Tuyết Nhung", email: null, callName: "Nhung", salutation: "chi", group: "Nhà Hứng Khởi" };
  const message = buildCustomerEmail(content, sample);
  return { html: previewHtml(message), subject: message.subject, to: sample.email ?? "" };
}

// ---------- Danh sách người nhận ----------

type RecipientPatch = {
  fullName?: string;
  email?: string;
  callName?: string;
  salutation?: string | null;
  group?: string;
  note?: string;
};

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function addRecipient(campaignId: string, input: RecipientPatch): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const found = await editableCampaign(campaignId);
  if ("error" in found) return found;
  const fullName = oneLine(input.fullName, 160);
  const email = normalizeEmail(input.email);
  if (!fullName && !email) return { error: "Nhập họ tên hoặc email." };
  try {
    await prisma.mailRecipient.create({
      data: {
        campaignId,
        fullName: fullName || email!.split("@")[0],
        email,
        callName: oneLine(input.callName, 60) || defaultCallName(fullName) || null,
        salutation: isSalutation(input.salutation) ? input.salutation : null,
        source: "Nhập tay",
        reviewed: true,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Email này đã có trong danh sách." };
    throw error;
  }
  refresh(campaignId);
  return { success: "Đã thêm người nhận." };
}

export async function updateRecipient(recipientId: string, patch: RecipientPatch): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const recipient = await prisma.mailRecipient.findUnique({
    where: { id: recipientId },
    select: { campaignId: true, status: true },
  });
  if (!recipient) return { error: "Không tìm thấy người nhận." };
  // Thư lỗi vẫn sửa được (vd email gõ sai) để bấm Gửi lại.
  if (recipient.status !== "failed") {
    const found = await editableCampaign(recipient.campaignId);
    if ("error" in found) return found;
  }

  const data: Prisma.MailRecipientUpdateInput = { reviewed: true };
  if (patch.fullName !== undefined) {
    const fullName = oneLine(patch.fullName, 160);
    if (!fullName) return { error: "Họ tên không được để trống." };
    data.fullName = fullName;
  }
  if (patch.email !== undefined) data.email = normalizeEmail(patch.email);
  if (patch.callName !== undefined) data.callName = oneLine(patch.callName, 60) || null;
  if (patch.salutation !== undefined) data.salutation = isSalutation(patch.salutation) ? patch.salutation : null;
  if (patch.group !== undefined) data.group = oneLine(patch.group, 120) || null;
  if (patch.note !== undefined) data.note = oneLine(patch.note, 300) || null;
  try {
    await prisma.mailRecipient.update({ where: { id: recipientId }, data });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Email này đã có ở dòng khác. Xoá một trong hai dòng." };
    throw error;
  }
  refresh(recipient.campaignId);
  return {};
}

async function ownedIds(campaignId: string, ids: string[]) {
  const rows = await prisma.mailRecipient.findMany({
    where: { campaignId, id: { in: ids.slice(0, 2000) } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function deleteRecipients(campaignId: string, ids: string[]): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const found = await editableCampaign(campaignId);
  if ("error" in found) return found;
  const owned = await ownedIds(campaignId, ids);
  await prisma.mailRecipient.deleteMany({ where: { id: { in: owned } } });
  refresh(campaignId);
  return { success: `Đã xoá ${owned.length} người.` };
}

export async function setRecipientsSalutation(
  campaignId: string,
  ids: string[],
  salutation: Salutation
): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  if (!isSalutation(salutation)) return { error: "Xưng hô không hợp lệ." };
  const found = await editableCampaign(campaignId);
  if ("error" in found) return found;
  const owned = await ownedIds(campaignId, ids);
  await prisma.mailRecipient.updateMany({ where: { id: { in: owned } }, data: { salutation } });
  refresh(campaignId);
  return { success: `Đã chọn xưng hô cho ${owned.length} người.` };
}

export async function markRecipientsReviewed(campaignId: string, ids: string[]): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const found = await editableCampaign(campaignId);
  if ("error" in found) return found;
  const owned = await ownedIds(campaignId, ids);
  await prisma.mailRecipient.updateMany({ where: { id: { in: owned } }, data: { reviewed: true } });
  refresh(campaignId);
  return {};
}

// ---------- Gửi ----------

async function readyCampaign(campaignId: string) {
  const campaign = await prisma.mailCampaign.findUnique({
    where: { id: campaignId },
    include: { sender: true, recipients: true },
  });
  if (!campaign) return { error: "Không tìm thấy chiến dịch." } as const;
  if (!campaignReadiness(campaign.recipients).ready) {
    return { error: "Danh sách còn dòng thiếu email, chưa chọn xưng hô hoặc cần xem lại." } as const;
  }
  if (!isSenderConfigured(campaign.sender.smtpRef)) {
    return { error: "Thương hiệu gửi chưa có hộp thư SMTP trên máy chủ." } as const;
  }
  return { campaign } as const;
}

export async function sendTestEmail(campaignId: string, recipientId: string | null): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const campaign = await prisma.mailCampaign.findUnique({ where: { id: campaignId }, include: { sender: true } });
  if (!campaign) return { error: "Không tìm thấy chiến dịch." };
  const recipient = recipientId
    ? await prisma.mailRecipient.findFirst({ where: { id: recipientId, campaignId } })
    : await prisma.mailRecipient.findFirst({ where: { campaignId }, orderBy: { createdAt: "asc" } });
  const sample = recipient ?? { fullName: user.name, email: null, callName: defaultCallName(user.name), salutation: "ban", group: null };
  const message = buildCustomerEmail(campaign, sample);
  const result = await deliverEmail(
    { ...message, to: [user.email], subject: `[Thử] ${message.subject}` },
    { fromName: campaign.sender.name, replyTo: campaign.sender.replyTo, smtpRef: campaign.sender.smtpRef }
  );
  if (!result.ok) return { error: result.error };
  await logEvent(campaignId, user.id, "test", `Thư của ${sample.fullName} → ${user.email}`);
  refresh(campaignId);
  return { success: `Đã gửi thư thử tới ${user.email}.` };
}

export async function sendCampaignNow(campaignId: string): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const found = await readyCampaign(campaignId);
  if ("error" in found) return found;
  const now = new Date();
  const started = await prisma.mailCampaign.updateMany({
    where: { id: campaignId, status: { in: ["draft", "scheduled"] } },
    data: { status: "sending", sendAt: now, startedAt: now },
  });
  if (!started.count) return { error: "Chiến dịch đã được gửi." };
  await logEvent(campaignId, user.id, "send", `Gửi ngay ${found.campaign.recipients.length} thư`);
  // Gửi lượt đầu ngay sau khi trả lời; cron mỗi phút gửi tiếp phần còn lại.
  after(() => sendCampaignBatch(campaignId, { deadline: Date.now() + 50_000 }).catch(() => undefined));
  refresh(campaignId);
  return { success: "Đang gửi thư." };
}

export async function scheduleCampaign(campaignId: string, localDateTime: string): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const sendAt = parseVietnamDateTime(localDateTime);
  if (!sendAt) return { error: "Chọn ngày giờ gửi." };
  if (sendAt.getTime() < Date.now() + 60_000) return { error: "Giờ hẹn phải sau bây giờ ít nhất 1 phút." };
  const found = await readyCampaign(campaignId);
  if ("error" in found) return found;
  const updated = await prisma.mailCampaign.updateMany({
    where: { id: campaignId, status: { in: ["draft", "scheduled"] } },
    data: { status: "scheduled", sendAt },
  });
  if (!updated.count) return { error: "Chiến dịch đã được gửi." };
  await logEvent(campaignId, user.id, "schedule", `Hẹn gửi lúc ${formatVietnamDateTime(sendAt)}`);
  refresh(campaignId);
  return { success: `Đã hẹn gửi lúc ${formatVietnamDateTime(sendAt)}.` };
}

export async function cancelSchedule(campaignId: string): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const updated = await prisma.mailCampaign.updateMany({
    where: { id: campaignId, status: "scheduled" },
    data: { status: "draft", sendAt: null },
  });
  if (!updated.count) return { error: "Đã đến giờ gửi, không huỷ được nữa." };
  await logEvent(campaignId, user.id, "cancel", "Huỷ hẹn giờ");
  refresh(campaignId);
  return { success: "Đã huỷ hẹn giờ." };
}

export async function retryFailed(campaignId: string): Promise<MailActionState> {
  const user = await requireMailAdmin();
  if (!user) return NO_ACCESS;
  const campaign = await prisma.mailCampaign.findUnique({ where: { id: campaignId }, include: { sender: true } });
  if (!campaign || !["sending", "done"].includes(campaign.status)) return { error: "Không có thư lỗi để gửi lại." };
  if (!isSenderConfigured(campaign.sender.smtpRef)) return { error: "Thương hiệu gửi chưa có hộp thư SMTP trên máy chủ." };
  const reset = await prisma.mailRecipient.updateMany({
    where: { campaignId, status: "failed" },
    data: { status: "pending", attempts: 0, error: null },
  });
  if (!reset.count) return { error: "Không có thư lỗi để gửi lại." };
  await prisma.mailCampaign.update({ where: { id: campaignId }, data: { status: "sending", finishedAt: null } });
  await logEvent(campaignId, user.id, "retry", `Gửi lại ${reset.count} thư lỗi`);
  after(() => sendCampaignBatch(campaignId, { deadline: Date.now() + 50_000 }).catch(() => undefined));
  refresh(campaignId);
  return { success: `Đang gửi lại ${reset.count} thư.` };
}
