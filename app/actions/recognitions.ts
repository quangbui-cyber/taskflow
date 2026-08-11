"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import {
  removeSavedRecognitionWebhook,
  saveAndTestRecognitionWebhook,
  sendRecognitionToGoogleChat,
  testSavedRecognitionWebhook,
} from "@/lib/recognitionGoogleChat";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import {
  RECOGNITION_CATEGORIES,
  RECOGNITION_WEEKLY_STAR_LIMIT,
  RECOGNITION_VISIBILITIES,
  recognitionCategoryLabel,
  recognitionWeekRange,
} from "@/lib/recognitions";

export type RecognitionActionState = {
  error?: string;
  success?: string;
  recognitionId?: string;
};

const categoryKeys = new Set<string>(
  RECOGNITION_CATEGORIES.map((category) => category.key)
);
const visibilityKeys = new Set<string>(
  RECOGNITION_VISIBILITIES.map((visibility) => visibility.key)
);

export type RecognitionWebhookState = {
  error?: string;
  success?: string;
};

export async function updateRecognitionWebhook(
  _previousState: RecognitionWebhookState,
  formData: FormData
): Promise<RecognitionWebhookState> {
  await requireAdmin();
  const intent = String(formData.get("intent") ?? "save");

  if (intent === "test") {
    const result = await testSavedRecognitionWebhook();
    return result.ok ? { success: result.message } : { error: result.message };
  }

  if (intent === "remove") {
    await removeSavedRecognitionWebhook();
    revalidatePath("/recognition");
    return { success: "Đã ngắt kết nối webhook Google Chat." };
  }

  const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
  if (!webhookUrl) return { error: "Hãy dán URL webhook Google Chat." };

  const result = await saveAndTestRecognitionWebhook(webhookUrl);
  if (!result.ok) return { error: result.message };
  revalidatePath("/recognition");
  return { success: result.message };
}

export async function createRecognition(
  _previousState: RecognitionActionState,
  formData: FormData
): Promise<RecognitionActionState> {
  const user = await requireUser();
  const recipientId = String(formData.get("recipientId") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const category = String(formData.get("category") ?? "KINDNESS");
  const visibility = String(formData.get("visibility") ?? "COMPANY");

  if (!recipientId) return { error: "Hãy chọn người bạn muốn cảm ơn." };
  if (recipientId === user.id) {
    return { error: "Bạn hãy dành ngôi sao này cho một người khác nhé." };
  }
  if (message.length < 2) {
    return { error: "Lời cảm ơn cần có ít nhất 2 ký tự." };
  }
  if (message.length > 500) {
    return { error: "Lời cảm ơn không được dài quá 500 ký tự." };
  }
  if (!categoryKeys.has(category)) return { error: "Chủ đề không hợp lệ." };
  if (!visibilityKeys.has(visibility)) {
    return { error: "Phạm vi hiển thị không hợp lệ." };
  }

  const currentWeek = recognitionWeekRange();
  const sentThisWeek = await prisma.recognition.count({
    where: {
      senderId: user.id,
      createdAt: { gte: currentWeek.start, lt: currentWeek.end },
    },
  });
  if (sentThisWeek >= RECOGNITION_WEEKLY_STAR_LIMIT) {
    return {
      error: `Bạn đã dùng hết ${RECOGNITION_WEEKLY_STAR_LIMIT} ngôi sao của tuần này. Ví sao sẽ đầy lại vào thứ Hai tuần sau.`,
    };
  }

  const recipient = await prisma.user.findFirst({
    where: { id: recipientId, isActive: true },
    select: { id: true, name: true },
  });
  if (!recipient) return { error: "Không tìm thấy người nhận đang hoạt động." };

  const recognition = await prisma.recognition.create({
    data: {
      senderId: user.id,
      recipientId: recipient.id,
      message,
      category,
      visibility,
    },
    select: { id: true },
  });

  await notify([recipient.id], {
    type: "RECOGNITION_RECEIVED",
    message: `${user.name} đã gửi cho bạn một ngôi sao trong Góc cảm ơn`,
    recognitionId: recognition.id,
  });

  if (visibility === "COMPANY") {
    await sendRecognitionToGoogleChat({
      recognitionId: recognition.id,
      senderName: user.name,
      recipientName: recipient.name,
      message,
      categoryLabel: recognitionCategoryLabel(category),
    });
  }

  revalidatePath("/recognition");
  revalidatePath("/notifications");

  return {
    success: `Đã gửi một ngôi sao đến ${recipient.name}.`,
    recognitionId: recognition.id,
  };
}
